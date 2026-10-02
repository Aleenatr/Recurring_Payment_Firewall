/**
 * FIXTURE GENERATOR — writes data/sample_merchants.json
 *
 *   node scripts/generateSampleData.js
 *
 * Produces 15 merchants: the 3 hand-written archetypes from
 * data/archetypes.json, plus 12 procedurally varied background merchants.
 *
 * WHY 15 AND NOT 3:
 * Both clustering algorithms are population-level. With three merchants,
 * k-means with k=3 gives every merchant its own cluster and DBSCAN with
 * minPts=2 marks all three as outliers — mathematically correct and completely
 * uninformative. A realistic population needs a dense mass of ordinary
 * merchants for the abusive ones to stand out FROM. That density is the whole
 * mechanism DBSCAN relies on.
 *
 * WHY IT IS DETERMINISTIC:
 * No Math.random(). A seeded linear congruential generator instead, so the
 * fixture is byte-identical on every run and on every machine. A demo that
 * scores differently each time it is regenerated is not a demo.
 */

import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

// --- Seeded pseudo-random number generator (LCG, glibc constants) -----------
// Same seed -> same sequence, always.
let seed = 20260814;
function random() {
   seed = (seed * 1103515245 + 12345) % 2147483648;
   return seed / 2147483648;
}
const randInt = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(random() * arr.length)];

const BASE_NAMES = [
   'PixelVault', 'MealBox', 'FitTrack', 'LingoLab', 'PodStream',
   'DocSafe', 'GameChest', 'NoteNest', 'RidePass', 'PetCare',
   'SkyDrive', 'TuneRoom'
];

const CATEGORIES = ['SAAS', 'DIGITAL_MEDIA', 'FITNESS', 'EDUCATION', 'FOOD_DELIVERY'];

const monthsAgo = (n) => {
   // Anchored to a fixed date so the fixture never drifts with the wall clock.
   const anchor = new Date('2026-08-01T00:00:00Z');
   const d = new Date(anchor);
   d.setUTCMonth(d.getUTCMonth() - n);
   return d.toISOString();
};

/**
 * Build one merchant at a given abuse level.
 * @param {number} index
 * @param {'clean'|'mild'|'moderate'} profile
 */
function buildMerchant(index, profile) {
   const id = `MRC_1${String(index).padStart(2, '0')}`;
   const name = BASE_NAMES[index % BASE_NAMES.length];

   // Profile drives how much abuse gets baked in. The point of the background
   // population is that MOST merchants are ordinary — that is what makes an
   // outlier an outlier.
   const config = {
      clean:    { descriptors: 1, priceSteps: 0, stealthRate: 0,   retriesPerFail: 1, cancelStuck: 0,   chargebacks: 0 },
      mild:     { descriptors: 1, priceSteps: 1, stealthRate: 0,   retriesPerFail: 1, cancelStuck: 0,   chargebacks: 0 },
      moderate: { descriptors: 2, priceSteps: 1, stealthRate: 0.5, retriesPerFail: 2, cancelStuck: 0.5, chargebacks: 0 },
      // The mid-band case: doing several things wrong, none of them egregious.
      // Included deliberately so the population is not just "clean or abusive" —
      // a scoring model that only separates the extremes has not been tested.
      aggressive: { descriptors: 3, priceSteps: 2, stealthRate: 1, retriesPerFail: 3, cancelStuck: 1, chargebacks: 0 }
   }[profile];

   const monthCount = randInt(8, 12);
   const basePrice = Number((randInt(300, 1500) / 100).toFixed(2));
   const priceLadder = [basePrice];
   for (let s = 0; s < config.priceSteps; s++) {
      priceLadder.push(Number((priceLadder[priceLadder.length - 1] * 1.2).toFixed(2)));
   }

   const descriptorForms = [
      name.toUpperCase(),
      `${name.toUpperCase()} INC`,
      `${name.substring(0, 4).toUpperCase()}*SUB`
   ].slice(0, config.descriptors);

   const userCount = randInt(2, 4);
   const subscriptions = [];
   const transactions = [];
   const lifecycle_events = [];
   const dispute_events = [];

   for (let u = 0; u < userCount; u++) {
      const subId = `${id}_SUB_${u}`;
      const userHash = `u_${id.toLowerCase()}_${u}`;
      subscriptions.push({
         subscription_id: subId,
         user_hash: userHash,
         billing_interval: 'monthly',
         trial_days: pick([0, 7, 14]),
         start_date: monthsAgo(monthCount).split('T')[0]
      });

      for (let m = monthCount; m > 0; m -= 2) {
         // Walk up the price ladder as the months pass.
         const ladderIndex = Math.min(
            priceLadder.length - 1,
            Math.floor(((monthCount - m) / monthCount) * priceLadder.length)
         );
         const amount = priceLadder[ladderIndex];
         const descriptor = descriptorForms[ladderIndex % descriptorForms.length];
         const txnId = `${id}_TXN_${u}_${m}`;

         // Occasional genuine failure, then a retry. Normal processor behaviour.
         const fails = random() < 0.12;

         if (fails) {
            transactions.push({
               transaction_id: `${txnId}_F`,
               subscription_id: subId,
               user_hash: userHash,
               amount_usd: amount,
               status: 'failed',
               attempt: 1,
               timestamp: monthsAgo(m),
               descriptor,
               failure_reason: 'insufficient_funds',
               payment_method_type: 'card',
               card_bin: '424242',
               risk_signals: { cvv_match: true, avs_match: 'FULL', ip_country: 'US', card_country: 'US' }
            });

            for (let r = 0; r < config.retriesPerFail; r++) {
               transactions.push({
                  transaction_id: `${txnId}_R${r}`,
                  subscription_id: subId,
                  user_hash: userHash,
                  amount_usd: amount,
                  status: r === config.retriesPerFail - 1 ? 'success' : 'failed',
                  attempt: r + 2,
                  // Retries spaced days apart, not hours — the non-abusive pattern.
                  timestamp: new Date(new Date(monthsAgo(m)).getTime() + (r + 1) * 3 * 86400000).toISOString(),
                  descriptor,
                  payment_method_type: 'card',
                  card_bin: '424242',
                  risk_signals: { cvv_match: true, avs_match: 'FULL', ip_country: 'US', card_country: 'US' }
               });
            }
         } else {
            transactions.push({
               transaction_id: txnId,
               subscription_id: subId,
               user_hash: userHash,
               amount_usd: amount,
               status: 'success',
               attempt: 1,
               timestamp: monthsAgo(m),
               descriptor,
               payment_method_type: 'card',
               card_bin: '424242',
               risk_signals: { cvv_match: true, avs_match: 'FULL', ip_country: 'US', card_country: 'US' }
            });
         }
      }
   }

   // Price-change events matching the ladder.
   for (let s = 0; s < config.priceSteps; s++) {
      lifecycle_events.push({
         subscription_id: subscriptions[0].subscription_id,
         event_type: 'price_change',
         timestamp: monthsAgo(Math.floor(monthCount / 2)),
         old_amount: priceLadder[s],
         new_amount: priceLadder[s + 1],
         notification_sent: random() >= config.stealthRate,
         notification_method: 'email',
         advance_notice_days: 30
      });
   }

   // Cancellations: requested, and usually completed.
   if (subscriptions.length > 1) {
      const subId = subscriptions[1].subscription_id;
      lifecycle_events.push({ subscription_id: subId, event_type: 'cancellation_requested', timestamp: monthsAgo(2) });
      if (random() >= config.cancelStuck) {
         lifecycle_events.push({ subscription_id: subId, event_type: 'cancellation_completed', timestamp: monthsAgo(2) });
      }
   }

   return {
      merchant: {
         merchant_id: id,
         merchant_name: name,
         legal_name: `${name} Limited`,
         country: pick(['US', 'IN', 'GB']),
         category_code: pick(CATEGORIES),
         first_seen_at: monthsAgo(monthCount),
         website_url: `https://example-${name.toLowerCase()}.test`,
         customer_support_channels: ['email', 'chat']
      },
      subscriptions,
      lifecycle_events,
      transactions,
      dispute_events
   };
}

// The three hand-written archetypes carry the interesting cases; the generated
// merchants are the ordinary population they stand out from.
const archetypes = JSON.parse(readFileSync(join(dataDir, 'archetypes.json'), 'utf8'));

// Mostly clean, a few mild, a couple moderate — roughly the shape of a real
// merchant population, where outright abuse is rare.
const profiles = [
   'clean', 'clean', 'clean', 'clean',
   'mild', 'mild', 'mild',
   'moderate', 'moderate', 'moderate',
   'aggressive', 'aggressive'
];

const generated = profiles.map((profile, i) => buildMerchant(i, profile));
const all = [...archetypes, ...generated];

writeFileSync(
   join(dataDir, 'sample_merchants.json'),
   JSON.stringify(all, null, 2) + '\n'
);

console.log(`Wrote ${all.length} merchants to data/sample_merchants.json`);
console.log(`  ${archetypes.length} hand-written archetypes`);
const counts = profiles.reduce((acc, p) => ({ ...acc, [p]: (acc[p] || 0) + 1 }), {});
console.log(`  ${generated.length} generated (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`);
