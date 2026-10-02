# Autopay Shield

Batch risk-scoring for recurring-payment merchants.

Subscription merchants abuse customers in ways a single transaction never
reveals: the price creeps up over months, the billing descriptor changes so the
charge is unrecognisable on a statement, declined cards get retried
aggressively, cancellation requests go unanswered. None of that is visible in
one transaction — only across a merchant's whole history.

This service ingests a merchant's subscriptions, transactions and lifecycle
events, derives six normalised behavioural signals, clusters the whole merchant
population, and produces a **trust score from 0 to 100 where higher is safer**,
bucketed into four bands: `HEALTHY` / `NEEDS_ATTENTION` / `HIGH_RISK` /
`CRITICAL`.

---

## Run it

**No MongoDB or Redis installation required.**

```bash
cd api
npm install
npm run demo
```

That starts an in-memory MongoDB, ingests 15 sample merchants through the real
pipeline, runs the population clustering pass, and serves the API on
**port 5050**.

```bash
curl http://localhost:5050/api/public/stats
curl http://localhost:5050/api/public/merchants/MRC_001
```

Dashboard:

```bash
cd website
npm install
npm run dev          # http://localhost:5173
```

> Port **5050**, not 5000: on macOS the AirPlay Receiver in Control Centre binds
> 5000 and answers every request with `403`.

### Without the database at all

```bash
cd api
npm run pipeline
```

Runs all nine ingestion modules in memory against the sample data and prints
every stage — cleaned metrics, the six signals, the score breakdown, patterns,
and then the population clustering pass. No database, no network.

---

## Architecture

```
  Browser (React 19 + Vite + TS + Tailwind v4, :5173)
      │  GET /api/public/merchants
      ▼
  Node / Express 5 API (:5050)  ── the only thing that talks to the databases
      │                    │
      │ cache-aside        │ Mongoose
      ▼                    ▼
  Redis (:6379)        MongoDB — 3 collections
  fails open           cleaned_data → merchant_analysis_snapshots
                                    → api_responses
      ▲
      └── node-cron, every 6h: recompute clustering across ALL merchants
```

### The three collections

| Collection | What | Written by |
|---|---|---|
| `cleaned_data` | Every transaction, dispute and lifecycle event, validated and normalised | ingest |
| `merchant_analysis_snapshots` | The full internal analysis: signals, score breakdown, clusters, patterns | ingest + cron |
| `api_responses` | The flat, precomputed public read model the dashboard fetches | ingest + cron |

Reads and writes want opposite shapes. The dashboard needs one small flat
document per merchant, 100 at a time; an analyst needs the derivation. Storing
both in one document would drag a merchant's entire transaction history over
the wire on every dashboard load. So the pipeline **precomputes the read model**.

`api_responses` is a **sibling** of the snapshot, not derived from it — both are
built from the same in-memory objects. You cannot regenerate one from the other.

### The pipeline — `api/src/ingestion/`

```
cleaning/    validate → normalize → deduplicate → enrich
analysis/    extractSignals → dbscanAnalysis → kmeansAnalysis → merchantScoring
controller/  generateApiResponse
```

Six signals, all `0..1`, all **higher = worse**:
`price_volatility`, `price_change_frequency`, `stealth_price_changes`,
`rename_frequency`, `cancellation_friction`, `retry_aggressiveness`.

The inversion to "higher is safer" happens exactly once, in `merchantScoring.js`:
`score = 100 − (ten named penalties)`. The penalty weights sum to **95**, so the
floor is 5 by construction rather than by clamping — a score of 5 means every
measured factor is at its worst, and the remaining 5 points encode "we could
still be wrong about you".

### Why there is a cron job

**Clustering is population-level and scoring is relative.** k-means partitions
*all* merchants into k groups; DBSCAN calls a merchant an outlier relative to
the density of its *neighbours*. Neither is defined for one merchant in
isolation — so the single-merchant ingest path returns explicit deferred
placeholders rather than fabricating a number, and the six-hourly job is where
those become real.

---

## Known limitations

Stated deliberately rather than discovered in review.

- **No authentication.** `jsonwebtoken` is in `package.json` and never imported.
  Anyone who can reach the API can `DELETE` any merchant. The admin/public split
  is a real boundary for data shape and cache policy, but it is *not* an auth
  boundary. One `requireAuth` middleware would make it one.
- **The cron runs in-process** on the same event loop as the API, with no
  distributed lock and no overlap guard. Two replicas would both fire at 06:00
  and race. Clustering is the only CPU-bound work in the system, so a large run
  blocks HTTP. A separate worker is the correct fix.
- **No transactions on the three-collection write.** A crash between writes
  leaves the snapshot and the public response disagreeing. MongoDB does support
  multi-document transactions on a replica set; this simply does not use them.
- **`cleaned_data` embeds the full transaction history, uncapped.** The 16 MB
  BSON document limit is a real ceiling. The fix is the bucket pattern — one
  document per merchant per month.
- **Timestamps are stored as `String`, not `Date`**, so range queries need a
  schema change.
- **The signal thresholds are judgement calls, not learned parameters.** There
  are no labels, so there is nothing to train against. Every threshold is stated
  as an explicit rule in the source comments.
- **The LLM makes no decisions.** The score, band, patterns and recommended
  action are all computed deterministically and written to MongoDB *before* the
  LLM is called. The AI endpoint reads the finished document and asks Groq to
  paraphrase it. It also has no audit trail — generated text lives in Redis for
  600s and is never persisted.

---

## Layout

```
api/
  src/ingestion/     the pipeline — cleaning, analysis, response generation
  src/services/      orchestration (single-merchant ingest, six-hourly cron)
  src/routes/        public (read, cached) and admin (write, uncached)
  src/models/        Mongoose schemas for the three collections
  src/config/        database and redis connections
  scripts/           demo.js, testPipeline.js, generateSampleData.js
  data/              archetypes.json (hand-written), sample_merchants.json (generated)
website/
  src/pages/         Home, Dashboard
```
