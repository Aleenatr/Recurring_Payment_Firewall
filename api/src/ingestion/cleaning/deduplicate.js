/**
 * STEP 3 — DEDUPLICATE
 *
 * Job: remove records that are literally the same record delivered twice.
 *
 * THE INVARIANT:
 *   Every remaining record has a unique identity. Counts downstream are counts
 *   of real events, not of delivery artefacts.
 *
 * ============================ THE TRAP =================================
 * A RETRY IS NOT A DUPLICATE.
 *
 * When a card is declined, the merchant charges it again. That is a NEW
 * transaction: same subscription_id, same amount, same user, DIFFERENT
 * transaction_id, and attempt incremented (models:47).
 *
 * If you dedupe on (subscription_id + amount) — which looks reasonable — you
 * collapse every retry into one row. retry_aggressiveness then reads 0 for
 * exactly the merchants it exists to catch. The abusive case becomes invisible
 * and the pipeline reports them as clean.
 *
 * So: transactions dedupe on transaction_id ALONE.
 * =======================================================================
 */

/**
 * Keep the first occurrence of each key; drop later ones.
 * Records with no usable key are kept — dropping them would lose real data on
 * the basis of a missing field, which is the wrong trade for a fraud product.
 */
function dedupeByKey(records, keyFn) {
   const seen = new Set();
   const kept = [];

   for (const record of records) {
      const key = keyFn(record);

      if (key === null || key === undefined || key === '') {
         kept.push(record);
         continue;
      }
      if (seen.has(key)) continue;

      seen.add(key);
      kept.push(record);
   }

   return kept;
}

export default function deduplicate(data) {
   // Unique on transaction_id only. See THE TRAP above.
   data.transactions = dedupeByKey(data.transactions, txn => txn.transaction_id);

   data.subscriptions = dedupeByKey(data.subscriptions, sub => sub.subscription_id);

   data.dispute_events = dedupeByKey(data.dispute_events, dispute => dispute.dispute_id);

   // lifecycle_events have no id field in the schema (models:31-40), so identity
   // is the composite of what happened, to which subscription, when. Two genuine
   // events cannot share all three; a redelivery shares all three.
   data.lifecycle_events = dedupeByKey(
      data.lifecycle_events,
      event => `${event.subscription_id}|${event.event_type}|${event.timestamp}`
   );

   return data;
}
