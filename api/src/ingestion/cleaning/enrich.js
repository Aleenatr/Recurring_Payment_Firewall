/**
 * STEP 4 — ENRICH
 *
 * Job: compute aggregated_metrics (models:77-107). This is the last cleaning
 * stage and the heaviest — everything downstream reads from here rather than
 * walking the transaction array again.
 *
 * THE INVARIANT:
 *   aggregated_metrics is fully populated with finite numbers. No NaN, no
 *   undefined, no division-by-zero leaking through.
 *
 * That invariant is not decoration. Mongoose does NOT reject NaN for a Number
 * field, and runValidators is off on the snapshot write (merchantProcessor.js:94),
 * so a NaN computed here reaches MongoDB, survives, and then renders as "NaN"
 * in the dashboard. Every ratio below has an explicit zero-denominator answer.
 */

// A "recent" window for chargeback/dispute/refund counts. The schema names the
// fields *_90d (models:90-92).
const RECENT_WINDOW_DAYS = 90;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Divide, but state what zero-denominator means instead of returning NaN. */
function ratio(numerator, denominator, whenNoDenominator = 0) {
   if (!denominator) return whenNoDenominator;
   const result = numerator / denominator;
   return Number.isFinite(result) ? result : whenNoDenominator;
}

function parseTime(value) {
   const time = new Date(value).getTime();
   return Number.isFinite(time) ? time : null;
}

export default function enrich(data) {
   const txns = data.transactions;
   const events = data.lifecycle_events;

   // ---- Transaction counts ------------------------------------------------
   const successful = txns.filter(t => t.status === 'success');
   const failed = txns.filter(t => t.status === 'failed');

   // ---- People and subscriptions -----------------------------------------
   // user_hash appears on both subscriptions and transactions (models:26, 44).
   // Count the union: a user who transacted but whose subscription record is
   // missing is still a user.
   const userHashes = new Set([
      ...data.subscriptions.map(s => s.user_hash),
      ...txns.map(t => t.user_hash)
   ].filter(Boolean));

   const subscriptionIds = new Set([
      ...data.subscriptions.map(s => s.subscription_id),
      ...txns.map(t => t.subscription_id)
   ].filter(Boolean));

   // ---- Prices ------------------------------------------------------------
   // Successful charges only. A declined attempt is not a price the customer
   // was charged, and including failures would let a single bad attempt at an
   // odd amount masquerade as price volatility.
   const amounts = successful.map(t => t.amount_usd).filter(a => Number.isFinite(a) && a > 0);
   const maxPrice = amounts.length ? Math.max(...amounts) : 0;
   const minPrice = amounts.length ? Math.min(...amounts) : 0;

   // ---- Retries -----------------------------------------------------------
   // attempt > 1 means "this charge is a re-run of an earlier failed one".
   const retryTxns = txns.filter(t => t.attempt > 1);

   // ---- Recency window ----------------------------------------------------
   // Anchored to the LATEST timestamp in the data, not to Date.now().
   // Reason: this is historical batch data. Against a wall clock, a dataset
   // exported six months ago would report zero chargebacks in every window and
   // every merchant in it would score clean. Anchoring to the data means the
   // window is "the last 90 days OF THIS MERCHANT'S HISTORY", which is stable
   // and reproducible — the same input always scores the same.
   const allTimes = txns.map(t => parseTime(t.timestamp)).filter(t => t !== null);
   const latestTime = allTimes.length ? Math.max(...allTimes) : Date.now();
   const windowStart = latestTime - RECENT_WINDOW_DAYS * MS_PER_DAY;

   const isRecent = (timestamp) => {
      const time = parseTime(timestamp);
      return time !== null && time >= windowStart;
   };

   const chargebacks90d = txns.filter(t => t.chargeback_filed_at && isRecent(t.chargeback_filed_at)).length;

   // Disputes come from two places: the flag on a transaction (models:50) and
   // the standalone dispute_events collection (models:68-76). Counted together
   // and deduped by transaction_id so a dispute recorded in both is not double
   // counted — which would inflate dispute_rate and fire a false pattern.
   const disputedTxnIds = new Set([
      ...txns.filter(t => t.dispute_filed_at && isRecent(t.dispute_filed_at)).map(t => t.transaction_id),
      ...data.dispute_events.filter(d => isRecent(d.filed_at)).map(d => d.transaction_id)
   ].filter(Boolean));
   const disputes90d = disputedTxnIds.size;

   const refunds90d = txns.filter(t =>
      (t.status === 'refunded' || t.chargeback_status === 'refunded') && isRecent(t.timestamp)
   ).length;

   // ---- Price changes and notification compliance -------------------------
   // Detected from the AMOUNTS, not from event_type. Processors spell the event
   // half a dozen ways ("price_change", "plan_updated", "amount_changed");
   // old_amount !== new_amount is unambiguous and needs no vocabulary list.
   const priceChanges = events.filter(e =>
      e.old_amount !== null && e.new_amount !== null && e.old_amount !== e.new_amount
   );

   // "Stealth" = the price moved and the customer was not told. This is the
   // definition the signal name promises, written down before it was coded.
   const stealthChanges = priceChanges.filter(e => e.notification_sent !== true);

   // When there were no price changes at all, compliance is 1 — there was
   // nothing to comply with. Returning 0 would penalise a merchant who never
   // changed their price, which is the opposite of the intent.
   const notificationComplianceRate = ratio(
      priceChanges.length - stealthChanges.length,
      priceChanges.length,
      1
   );

   // ---- Risk-signal quality ----------------------------------------------
   // How much of the fraud telemetry is actually present (models:98-103).
   // This measures OUR data quality, not the merchant's behaviour — it is
   // reported so a low score can be read as "thin evidence" rather than "clean".
   const withRiskSignals = txns.filter(t => t.risk_signals && typeof t.risk_signals === 'object');
   const cvvMatches = withRiskSignals.filter(t => t.risk_signals.cvv_match === true).length;
   const avsFullMatches = withRiskSignals.filter(t =>
      typeof t.risk_signals.avs_match === 'string' && t.risk_signals.avs_match.toUpperCase() === 'FULL'
   ).length;
   const geoMismatches = withRiskSignals.filter(t =>
      t.risk_signals.ip_country &&
      t.risk_signals.card_country &&
      t.risk_signals.ip_country !== t.risk_signals.card_country
   ).length;

   data.aggregated_metrics = {
      total_users: userHashes.size,
      total_subscriptions: subscriptionIds.size,
      total_transactions: txns.length,
      successful_transactions: successful.length,
      failed_transactions: failed.length,

      max_price_usd: maxPrice,
      min_price_usd: minPrice,
      // Percentage growth from cheapest to dearest charge. 0 when there are no
      // successful charges to compare.
      price_increase_percent: Math.round(ratio(maxPrice - minPrice, minPrice) * 100),

      unique_descriptors: data.merchant.normalized_descriptors.length,

      // Both names exist in the schema (models:87-88) and mean the same thing.
      // Kept in sync deliberately rather than picking one, because public.js and
      // the dashboard were written against different ones.
      retry_attempts: retryTxns.length,
      total_retry_attempts: retryTxns.length,
      // Retries per failed charge. Zero failures means nothing to retry, so 0.
      avg_retry_rate: ratio(retryTxns.length, failed.length),

      chargebacks_90d: chargebacks90d,
      disputes_90d: disputes90d,
      refunds_90d: refunds90d,
      chargeback_rate: ratio(chargebacks90d, txns.length),
      dispute_rate: ratio(disputes90d, txns.length),

      stealth_price_changes: stealthChanges.length,
      total_price_changes: priceChanges.length,
      notification_compliance_rate: notificationComplianceRate,

      risk_signal_quality: {
         coverage: ratio(withRiskSignals.length, txns.length),
         cvv_match_rate: ratio(cvvMatches, withRiskSignals.length),
         avs_full_match_rate: ratio(avsFullMatches, withRiskSignals.length),
         geographic_mismatches: geoMismatches
      },

      // Z-SCORES ARE DELIBERATELY ZERO.
      // A z-score is (value - population_mean) / population_std_dev. At this
      // point in the pipeline we are holding exactly one merchant, so there is
      // no population and no mean. Inventing a number here would be a fabricated
      // statistic in a fraud product. They are left at 0 and the population-level
      // comparison is done where it is actually definable — in the clustering,
      // which is why the six-hourly cron exists at all.
      chargeback_zscore: 0,
      retry_zscore: 0,
      price_volatility_zscore: 0
   };

   return data;
}
