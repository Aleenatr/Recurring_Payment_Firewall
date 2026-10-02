/**
 * STEP 1 — VALIDATE
 *
 * Job: reject anything the pipeline cannot proceed on, and guarantee the shape
 * everything downstream assumes. Nothing else. No cleaning, no computation.
 *
 * THE INVARIANT (this is the whole reason the module exists):
 *   After validate() returns, no downstream module needs a null check on
 *   merchant.merchant_id, merchant.merchant_name, or the four array fields.
 *
 * Throwing is correct here, not a crash: processMerchantsBatch() catches per
 * merchant (merchantProcessor.js:370-377) and records it as failed, so one bad
 * record can never take down a batch.
 */

// The two fields the Mongoose schema marks required:true (models:5-6).
// Missing either means we cannot key the document, so there is nothing to save.
const REQUIRED_MERCHANT_FIELDS = ['merchant_id', 'merchant_name'];

// Collections that downstream modules iterate over unconditionally.
// Absent is fine and becomes []; present-but-not-an-array is a real error.
const ARRAY_FIELDS = ['subscriptions', 'transactions', 'lifecycle_events', 'dispute_events'];

export default function validate(rawData) {
   if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
      throw new Error('validate: expected a merchant object');
   }

   // Deep copy so the pipeline never mutates the caller's input. The stages are
   // chained (merchantProcessor.js:21-27) and each returns a new value, so a
   // shared reference would make a failure halfway through leave the caller
   // holding half-cleaned data.
   const data = JSON.parse(JSON.stringify(rawData));

   if (!data.merchant || typeof data.merchant !== 'object') {
      throw new Error('validate: missing "merchant" object');
   }

   for (const field of REQUIRED_MERCHANT_FIELDS) {
      const value = data.merchant[field];
      if (typeof value !== 'string' || value.trim() === '') {
         throw new Error(`validate: merchant.${field} is required and must be a non-empty string`);
      }
      data.merchant[field] = value.trim();
   }

   for (const field of ARRAY_FIELDS) {
      if (data[field] === undefined || data[field] === null) {
         data[field] = [];
         continue;
      }
      if (!Array.isArray(data[field])) {
         throw new Error(`validate: "${field}" must be an array if present`);
      }
   }

   // A merchant with no transactions is valid input, not an error — a brand-new
   // merchant genuinely has none. It scores as low-signal rather than low-risk;
   // extractSignals returns zeros and the trust score lands at 100. That is a
   // known cold-start weakness, and it is called out in the walkthrough rather
   // than papered over here.

   // processed_at is required:true on cleanedDataSchema (models:3). The raw feed
   // does not supply it — it is a pipeline fact, not a merchant fact — so this
   // is the correct place to stamp it.
   if (!data.processed_at) {
      data.processed_at = new Date().toISOString();
   }

   return data;
}
