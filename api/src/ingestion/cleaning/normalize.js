/**
 * STEP 2 — NORMALIZE
 *
 * Job: put values into canonical form so that later comparisons mean something.
 *
 * THE INVARIANT:
 *   Two things that are the same thing compare equal after this runs.
 *
 * Why it matters more than it looks: rename_frequency counts DISTINCT billing
 * descriptors. Without normalisation, "NFLX*PREMIUM", "nflx premium" and
 * "NFLX  PREMIUM." are three descriptors, and a perfectly honest merchant scores
 * as identity evasion. Normalisation is what stops formatting noise from being
 * read as abuse.
 */

// Corporate suffixes carry no identity information — "Acme Ltd" and "Acme" are
// the same merchant. Stripped so they cannot inflate the distinct-name count.
const LEGAL_SUFFIXES = [
   'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc',
   'pvt', 'private', 'corp', 'corporation', 'co', 'company', 'gmbh', 'bv', 'sa'
];

// Transaction statuses arrive spelled several ways depending on the payment
// processor. enrich() counts successes and failures, so they are collapsed to
// exactly two canonical words here (plus whatever else passes through unchanged).
const SUCCESS_ALIASES = ['success', 'successful', 'succeeded', 'captured', 'settled', 'paid'];
const FAILURE_ALIASES = ['failed', 'failure', 'declined', 'decline', 'error', 'rejected'];

/**
 * Lowercase, strip punctuation, collapse whitespace, drop legal suffixes.
 * "NFLX*PREMIUM Ltd." -> "nflx premium"
 */
export function normalizeText(value) {
   if (typeof value !== 'string') return '';

   const cleaned = value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')   // punctuation and separators -> space
      .replace(/\s+/g, ' ')            // collapse runs of whitespace
      .trim();

   if (cleaned === '') return '';

   const words = cleaned.split(' ').filter(word => !LEGAL_SUFFIXES.includes(word));

   // If the name was ENTIRELY legal suffixes, keep the original cleaned form
   // rather than returning an empty string that would collapse every such
   // merchant onto the same key.
   return words.length > 0 ? words.join(' ') : cleaned;
}

function normalizeStatus(status) {
   const lowered = typeof status === 'string' ? status.toLowerCase().trim() : '';
   if (SUCCESS_ALIASES.includes(lowered)) return 'success';
   if (FAILURE_ALIASES.includes(lowered)) return 'failed';
   return lowered;
}

function toNumber(value, fallback) {
   const parsed = Number(value);
   return Number.isFinite(parsed) ? parsed : fallback;
}

export default function normalize(data) {
   // ---- Merchant identity -------------------------------------------------
   data.merchant.normalized_name = normalizeText(data.merchant.merchant_name);

   // ---- Transactions ------------------------------------------------------
   data.transactions = data.transactions.map(txn => ({
      ...txn,
      amount_usd: toNumber(txn.amount_usd, 0),
      // attempt 1 = the original charge, 2+ = retries. Absent means original.
      attempt: toNumber(txn.attempt, 1),
      status: normalizeStatus(txn.status),
      descriptor: typeof txn.descriptor === 'string' ? txn.descriptor.trim() : ''
   }));

   // ---- Descriptor variants ----------------------------------------------
   // descriptor_variants keeps what the customer actually saw on their
   // statement (models:12) — needed for the evidence strings shown in the UI.
   // normalized_descriptors (models:13) is what rename_frequency counts.
   const rawDescriptors = data.transactions
      .map(txn => txn.descriptor)
      .filter(Boolean);

   data.merchant.descriptor_variants = [...new Set(rawDescriptors)];
   data.merchant.normalized_descriptors = [...new Set(
      rawDescriptors.map(normalizeText).filter(Boolean)
   )];

   // ---- Lifecycle events --------------------------------------------------
   data.lifecycle_events = data.lifecycle_events.map(event => ({
      ...event,
      event_type: typeof event.event_type === 'string' ? event.event_type.toLowerCase().trim() : '',
      old_amount: event.old_amount === undefined || event.old_amount === null
         ? null
         : toNumber(event.old_amount, null),
      new_amount: event.new_amount === undefined || event.new_amount === null
         ? null
         : toNumber(event.new_amount, null),
      // Absent notification_sent is treated as NOT notified. That is the
      // conservative reading for a consumer-protection product: silence is not
      // evidence of compliance.
      notification_sent: event.notification_sent === true
   }));

   // NOTE ON TIMESTAMPS — deliberate, not an oversight.
   // Every timestamp in cleanedDataSchema is typed String (models:3, 10, 34, 48),
   // and merchantProcessor.js:39 does `new Date(t.timestamp)` at read time.
   // Converting to Date here would be silently stripped on write, because the
   // schema is strict. The correct fix is a schema change, which would break the
   // existing indexes — so it is logged as a known wart, not fixed in passing.

   return data;
}
