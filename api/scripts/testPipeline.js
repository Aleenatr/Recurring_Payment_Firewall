/**
 * PIPELINE TEST HARNESS — runs the whole ingestion pipeline IN MEMORY.
 *
 * No MongoDB. No Redis. No network. Just the nine ingestion modules against
 * data/sample_merchants.json, printing what each stage produced.
 *
 *   node scripts/testPipeline.js
 *
 * Two reasons this exists:
 *   1. It is the fastest way to see whether a change to a signal or a weight
 *      did what you expected — no database round trip in the loop.
 *   2. It is the demo that cannot fail on someone else's laptop. If Mongo is
 *      not up, this still runs and still shows the scoring working.
 *
 * It also runs the POPULATION path (k-means + DBSCAN over all three merchants),
 * which the single-merchant ingest path deliberately cannot do.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import validate from '../src/ingestion/cleaning/validate.js';
import normalize from '../src/ingestion/cleaning/normalize.js';
import deduplicate from '../src/ingestion/cleaning/deduplicate.js';
import enrich from '../src/ingestion/cleaning/enrich.js';
import extractSignals from '../src/ingestion/analysis/extractSignals.js';
import runDBSCAN, { performDBSCANClustering } from '../src/ingestion/analysis/dbscanAnalysis.js';
import runKMeans, { performKMeansClustering } from '../src/ingestion/analysis/kmeansAnalysis.js';
import generateMerchantScore from '../src/ingestion/analysis/merchantScoring.js';
import generateApiResponse from '../src/ingestion/controller/generateApiResponse.js';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = join(here, '..', 'data', 'sample_merchants.json');
const rawMerchants = JSON.parse(readFileSync(samplePath, 'utf8'));

const line = (char = '-') => console.log(char.repeat(78));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ============================================================================
// PASS 1 — the single-merchant ingest path, exactly as merchantProcessor runs it
// ============================================================================
console.log('\n');
line('=');
console.log('PASS 1 — SINGLE-MERCHANT INGEST PATH  (what POST /api/admin/ingest does)');
line('=');

const processed = [];

for (const raw of rawMerchants) {
   let data = validate(raw);
   data = normalize(data);
   data = deduplicate(data);
   data = enrich(data);

   const signals = extractSignals(data);
   const dbscan = runDBSCAN(signals);
   const kmeans = runKMeans(signals, dbscan);
   const scoring = generateMerchantScore(data, signals, dbscan, kmeans);
   const apiResponse = generateApiResponse({ cleanData: data, signals, scoring });

   processed.push({ data, signals, scoring, apiResponse });

   const m = data.aggregated_metrics;

   console.log(`\n${data.merchant.merchant_name}  [${data.merchant.merchant_id}]`);
   line();

   console.log('  CLEANED:');
   console.log(`    ${m.total_transactions} transactions (${m.successful_transactions} ok, ${m.failed_transactions} failed), ${m.total_users} users`);
   console.log(`    price $${m.min_price_usd} -> $${m.max_price_usd}  (+${m.price_increase_percent}%)`);
   console.log(`    descriptors: ${data.merchant.normalized_descriptors.length} distinct  ${JSON.stringify(data.merchant.normalized_descriptors)}`);
   console.log(`    price changes: ${m.total_price_changes} (${m.stealth_price_changes} unannounced), compliance ${pct(m.notification_compliance_rate)}`);
   console.log(`    chargeback rate ${pct(m.chargeback_rate)}, dispute rate ${pct(m.dispute_rate)}`);

   console.log('  SIGNALS (0..1, higher = worse):');
   for (const [name, value] of Object.entries(signals.core)) {
      const bar = '#'.repeat(Math.round(value * 30)).padEnd(30, '.');
      console.log(`    ${name.padEnd(24)} ${value.toFixed(3)}  ${bar}`);
   }

   console.log('  SCORE BREAKDOWN (points removed from 100):');
   for (const [name, value] of Object.entries(scoring.score_breakdown)) {
      if (name === 'base_score' || value === 0) continue;
      console.log(`    -${String(value).padEnd(6)} ${name}`);
   }

   console.log(`  TRUST SCORE: ${scoring.trust_score.score}/100  ->  ${scoring.trust_score.risk_level}`);
   console.log(`  CLUSTER:     ${scoring.cluster_assignment.cluster} (confidence ${scoring.cluster_assignment.confidence})`);

   if (scoring.patterns.length === 0) {
      console.log('  PATTERNS:    none');
   } else {
      console.log('  PATTERNS:');
      for (const p of scoring.patterns) {
         console.log(`    [${p.severity}] ${p.type}`);
         console.log(`        ${p.evidence}`);
      }
   }

   console.log(`  PUBLIC SUMMARY: "${apiResponse.summary.headline}"`);
   console.log(`                  ${apiResponse.summary.oneLineReason}`);
   console.log(`  ACTION:         ${apiResponse.recommendedAction.primary} (${apiResponse.recommendedAction.urgency})`);
}

// ============================================================================
// PASS 2 — the population path, as the six-hourly cron runs it
// ============================================================================
console.log('\n');
line('=');
console.log('PASS 2 — POPULATION PATH  (what the six-hourly cron does)');
line('=');
console.log('The single-merchant path above returned placeholder cluster and outlier');
console.log('results, because neither is defined for one merchant. Here they are real.\n');

const allSignals = processed.map(p => p.signals);

const kmeansPopulation = performKMeansClustering(allSignals, Math.min(3, allSignals.length));
const dbscanPopulation = performDBSCANClustering(allSignals, 0.3, 2);

console.log(`K-MEANS: ${kmeansPopulation.note}`);
for (const cluster of kmeansPopulation.clusters) {
   console.log(`  cluster ${cluster.id}  ${cluster.label.padEnd(20)} size ${cluster.size}`);
}

console.log(`\nDBSCAN:  ${dbscanPopulation.outliers.length} outlier(s) at eps=0.3, minPts=2`);
console.log(`         labels: ${JSON.stringify(dbscanPopulation.labels)}   (-1 = noise/outlier)\n`);

console.log('RE-SCORED WITH REAL POPULATION CONTEXT:');
line();
for (let i = 0; i < processed.length; i++) {
   const { data, signals } = processed[i];
   const rescored = generateMerchantScore(
      data,
      signals,
      dbscanPopulation.perMerchant[i],
      kmeansPopulation.merchantAssignments[i]
   );

   const before = processed[i].scoring.trust_score;
   const after = rescored.trust_score;
   const delta = after.score - before.score;
   const arrow = delta === 0 ? '=' : (delta > 0 ? `+${delta}` : `${delta}`);

   console.log(
      `  ${data.merchant.merchant_name.padEnd(22)} ` +
      `${String(before.score).padStart(3)} -> ${String(after.score).padStart(3)} (${arrow})  ` +
      `${after.risk_level.padEnd(16)} ${rescored.cluster_assignment.cluster}` +
      `${dbscanPopulation.perMerchant[i].is_outlier ? '  [OUTLIER]' : ''}`
   );
}

console.log('\n');
line('=');
console.log('Pipeline ran end to end. No database was involved.');
line('=');
console.log('');
