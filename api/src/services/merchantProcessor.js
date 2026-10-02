import validate from '../ingestion/cleaning/validate.js';
import normalize from '../ingestion/cleaning/normalize.js';
import deduplicate from '../ingestion/cleaning/deduplicate.js';
import enrich from '../ingestion/cleaning/enrich.js';
import extractSignals from '../ingestion/analysis/extractSignals.js';
import runKMeans from '../ingestion/analysis/kmeansAnalysis.js';
import runDBSCAN from '../ingestion/analysis/dbscanAnalysis.js';
import generateMerchantScore from '../ingestion/analysis/merchantScoring.js';
import generateApiResponse from '../ingestion/controller/generateApiResponse.js';
import { CleanedData, MerchantAnalysis, ApiResponse } from '../models/MerchantAnalysis.js';

/**
 * Process a single merchant's raw data
 * @param {Object} rawData - Raw merchant data
 * @returns {Object} - Processing result with database IDs
 */
export async function processMerchantData(rawData) {
   const startTime = Date.now();

   try {
      let data = validate(rawData);

      data = normalize(data);

      data = deduplicate(data);

      data = enrich(data);

      const signalData = extractSignals(data);

      const dbscanResult = runDBSCAN(signalData);

      const kmeansResult = runKMeans(signalData, dbscanResult);

      const scoringResult = generateMerchantScore(data, signalData, dbscanResult, kmeansResult);


      // Calculate analysis window
      const timestamps = data.transactions.map(t => new Date(t.timestamp));
      const analysisFrom = timestamps.length > 0
         ? new Date(Math.min(...timestamps)).toISOString().split('T')[0]
         : new Date().toISOString().split('T')[0];
      const analysisTo = timestamps.length > 0
         ? new Date(Math.max(...timestamps)).toISOString().split('T')[0]
         : new Date().toISOString().split('T')[0];
      const monthsDiff = timestamps.length > 0
         ? Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24 * 30))
         : 0;

      const snapshot = {
         merchantId: data.merchant.merchant_id,
         merchantName: data.merchant.merchant_name,
         analysis_window: {
            from: analysisFrom,
            to: analysisTo,
            months: monthsDiff
         },
         signals: {
            core: signalData.core
         },
         derived_indicators: scoringResult.derived_indicators,
         anomaly_analysis: scoringResult.anomaly_analysis,
         cluster_assignment: scoringResult.cluster_assignment,
         trust_score: scoringResult.trust_score,
         // score_breakdown and recommended_action are declared in the schema
         // (models:170-182, :207-214) and were previously never written by any
         // code — the fields existed but were always empty. Now populated.
         score_breakdown: scoringResult.score_breakdown,
         recommended_action: scoringResult.recommended_action,
         patterns: scoringResult.patterns,
         metadata: {
            total_users: data.aggregated_metrics.total_users,
            total_subscriptions: data.aggregated_metrics.total_subscriptions,
            analysis_timestamp: new Date().toISOString(),
            pipeline_version: "2.0.0"
         }
      };

      // Generate API response using the proper controller
      console.log('[API] Generating public API response...');
      const apiResponse = generateApiResponse({
         cleanData: data,
         signals: signalData,
         scoring: scoringResult
      });


      // Save to CleanedData collection
      await CleanedData.findOneAndUpdate(
         { 'merchant.merchant_id': data.merchant.merchant_id },
         data,
         { upsert: true, new: true, runValidators: true }
      );

      // Save to MerchantAnalysis collection (use snapshot structure)
      // runValidators was missing here while the other two writes had it
      // (:87, :103). That meant the enums on risk_level and pattern type, and
      // the 0-1 bounds on the six signals, were NOT enforced on the one write
      // that matters most. Now enforced — the ingestion modules clamp every
      // value, so this should never fire, and if it does that is a real bug
      // surfacing rather than bad data being stored silently.
      const merchantAnalysis = await MerchantAnalysis.findOneAndUpdate(
         { merchantId: data.merchant.merchant_id },
         snapshot,
         { upsert: true, new: true, runValidators: true }
      );

      // Save to ApiResponse collection
      console.log('[DB] Saving API response...');
      try {
         const savedApiResponse = await ApiResponse.findOneAndUpdate(
            { merchantId: data.merchant.merchant_id },
            apiResponse,
            { upsert: true, new: true, runValidators: true }
         );
         console.log('[DB] API response saved successfully:', savedApiResponse ? 'Yes' : 'No');
      } catch (apiError) {
         console.error('[DB] Error saving API response:', apiError.message);
         if (apiError.errors) {
            Object.keys(apiError.errors).forEach(key => {
               console.error(`   - ${key}: ${apiError.errors[key].message}`);
            });
         }
         throw apiError;
      }

      return {
         success: true,
         merchantId: data.merchant.merchant_id,
         merchantName: data.merchant.merchant_name,
         databaseId: merchantAnalysis._id,
         trustScore: scoringResult.trust_score.score,
         riskClassification: scoringResult.trust_score.risk_level,
         processingTime: Date.now() - startTime
      };

   } catch (error) {
      console.error(`Error processing merchant: ${error.message}`);
      throw error;
   }
}


// NOTE: the scoring, banding, pattern-detection and copy helpers that used to
// live here (calculateTrustScore, detectPatterns, getRiskLevel, getHeadline,
// getOneLineReason, getRecommendedAction, getUrgency, getNextSteps) have moved
// into the modules that own them:
//   ingestion/analysis/merchantScoring.js      - scoring, bands, patterns, action
//   ingestion/controller/generateApiResponse.js - headline, one-line reason
// They were all dead code here: defined, never called, never exported. Keeping
// a second copy of the scoring rules next to the live one is how the two drift.

/**
 * Process multiple merchants (batch processing)
 * Only processes new/updated merchants to reduce server load
 * @param {Array} rawDataArray - Array of raw merchant data
 * @returns {Object} - Batch processing results
 */
export async function processMerchantsBatch(rawDataArray) {
   const startTime = Date.now();
   const results = {
      total: rawDataArray.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      details: []
   };

   console.log(`\n📦 Starting batch processing of ${rawDataArray.length} merchants...`);

   // Extract merchant IDs from raw data
   const merchantIds = rawDataArray.map(raw => raw.merchant?.merchant_id).filter(Boolean);

   // Check which merchants already exist in database (check cleaned_data collection)
   const existingMerchants = await CleanedData.find({
      'merchant.merchant_id': { $in: merchantIds }
   }).select('merchant.merchant_id');

   const existingMerchantIds = new Set(existingMerchants.map(m => m.merchant.merchant_id));

   console.log(`\n📊 Analysis:`);
   console.log(`   Total merchants: ${merchantIds.length}`);
   console.log(`   Already in DB: ${existingMerchantIds.size}`);
   console.log(`   New merchants: ${merchantIds.length - existingMerchantIds.size}`);

   // Process each merchant
   for (const rawData of rawDataArray) {
      const merchantId = rawData.merchant?.merchant_id;

      if (!merchantId) {
         results.failed++;
         results.details.push({
            merchantId: 'unknown',
            status: 'failed',
            error: 'Missing merchant_id'
         });
         continue;
      }

      // Skip merchants that already exist in database
      if (existingMerchantIds.has(merchantId)) {
         results.skipped++;
         results.details.push({
            merchantId: merchantId,
            merchantName: rawData.merchant?.merchant_name || 'Unknown',
            status: 'skipped',
            reason: 'Already exists in database'
         });
         continue;
      }

      try {
         // Process new merchant
         const result = await processMerchantData(rawData);

         results.processed++;
         results.details.push({
            merchantId: result.merchantId,
            merchantName: result.merchantName,
            status: 'success',
            trustScore: result.trustScore,
            riskClassification: result.riskClassification,
            processingTime: result.processingTime,
            isNew: true
         });

      } catch (error) {
         results.failed++;
         results.details.push({
            merchantId: merchantId,
            status: 'failed',
            error: error.message
         });
      }
   }

   const totalTime = Date.now() - startTime;

   console.log(`\n✅ Batch processing complete in ${totalTime}ms`);
   console.log(`   Processed: ${results.processed}/${results.total}`);
   console.log(`   Skipped: ${results.skipped}/${results.total}`);
   console.log(`   Failed: ${results.failed}/${results.total}`);
   if (results.processed > 0) {
      console.log(`   Avg time per merchant: ${Math.round(totalTime / results.processed)}ms`);
   }

   return results;
}

export default { processMerchantData, processMerchantsBatch };
