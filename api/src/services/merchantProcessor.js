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
      const merchantAnalysis = await MerchantAnalysis.findOneAndUpdate(
         { merchantId: data.merchant.merchant_id },
         snapshot,
         { upsert: true, new: true }
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


//   TRUST SCORE BANDS 
//   0-20   → CRITICAL
//   21-40  → HIGH_RISK
//   41-65  → NEEDS_ATTENTION
//   66-100 → HEALTHY

function calculateTrustScore(signals, dbscanResult) {
   // Normalized weights (must sum to 1.0)
   const weights = {
      price_volatility: 0.35,        // Most critical indicator
      rename_frequency: 0.30,        // Identity evasion
      stealth_price_changes: 0.20,   // Consumer harm
      retry_aggressiveness: 0.15     // Payment abuse
   };

   // Calculate risk (0-1 scale, higher = worse)
   const risk =
      (signals.price_volatility || 0) * weights.price_volatility +
      (signals.rename_frequency || 0) * weights.rename_frequency +
      (signals.retry_aggressiveness || 0) * weights.retry_aggressiveness +
      (signals.stealth_price_changes || 0) * weights.stealth_price_changes;

   // Convert risk to trust score (100 = best, 0 = worst)
   let trustScore = 100 - (risk * 100);

   // Outlier penalty (up to -5 points)
   if (dbscanResult.is_outlier) {
      trustScore -= dbscanResult.anomaly_score * 5;
   }

   // Clamp to 5-100 range (floor at 5 to avoid false certainty)
   return Math.max(5, Math.min(100, Math.round(trustScore)));
}

/**
 * STEP 9: Pattern Detection (Human-Readable Abuse)
 */
function detectPatterns(cleanData, signals) {
   const patterns = [];
   const metrics = cleanData.aggregated_metrics;

   // PRICE_CREEP
   if (signals.price_volatility > 0.6) {
      patterns.push({
         type: 'PRICE_CREEP',
         severity: signals.price_volatility > 0.8 ? 'HIGH' : 'MEDIUM',
         evidence: `Price increased from $${metrics.min_price_usd} to $${metrics.max_price_usd} without plan change`
      });
   }

   // IDENTITY_EVASION
   if (signals.rename_frequency > 0.6) {
      patterns.push({
         type: 'IDENTITY_EVASION',
         severity: signals.rename_frequency > 0.8 ? 'CRITICAL' : 'HIGH',
         evidence: `${metrics.unique_descriptors} different billing descriptors used`
      });
   }

   // AGGRESSIVE_RETRY
   if (signals.retry_aggressiveness > 0.3) {
      patterns.push({
         type: 'AGGRESSIVE_RETRY',
         severity: signals.retry_aggressiveness > 0.6 ? 'HIGH' : 'MEDIUM',
         evidence: `Failed payment retried within 24 hours`
      });
   }

   return patterns;
}

/**
 * CLUSTER TO RISK LEVEL MAPPING (Documented)
 * ABUSIVE_PATTERN → CRITICAL
 * AGGRESSIVE_PATTERN → HIGH_RISK
 * NORMAL_PATTERN → HEALTHY/NEEDS_ATTENTION
 */

function getRiskLevel(trustScore) {
   if (trustScore >= 66) return 'HEALTHY';           // 66-100
   if (trustScore >= 41) return 'NEEDS_ATTENTION';   // 41-65
   if (trustScore >= 21) return 'HIGH_RISK';         // 21-40
   return 'CRITICAL';                                 // 0-20
}

/**
 * Get headline based on risk level
 */
function getHeadline(riskLevel) {
   const headlines = {
      'CRITICAL': 'High-risk recurring billing behavior detected',
      'HIGH_RISK': 'Concerning recurring billing patterns detected',
      'NEEDS_ATTENTION': 'Monitor this subscription for changes',
      'HEALTHY': 'Subscription billing appears normal'
   };
   return headlines[riskLevel] || 'Subscription analysis complete';
}

/**
 * Get one-line reason
 */
function getOneLineReason(signals, metrics) {
   if (signals.price_volatility > 0.6 && signals.rename_frequency > 0.6) {
      return 'Significant price increases with frequent merchant renaming';
   } else if (signals.price_volatility > 0.6) {
      return `Price increased ${metrics.price_increase_percent}% without notification`;
   } else if (signals.rename_frequency > 0.6) {
      return `${metrics.unique_descriptors} different billing names used`;
   }
   return 'Standard subscription billing pattern';
}

/**
 * Get recommended action based on risk level
 */
function getRecommendedAction(riskLevel) {
   const actions = {
      'CRITICAL': 'Cancel this subscription immediately',
      'HIGH_RISK': 'Review and consider canceling',
      'NEEDS_ATTENTION': 'Monitor future charges',
      'HEALTHY': 'No action needed'
   };
   return actions[riskLevel];
}

/**
 * Get urgency level
 */
function getUrgency(riskLevel) {
   const urgency = {
      'CRITICAL': 'URGENT',
      'HIGH_RISK': 'HIGH',
      'NEEDS_ATTENTION': 'MEDIUM',
      'HEALTHY': 'LOW'
   };
   return urgency[riskLevel];
}

/**
 * Get next steps
 */
function getNextSteps(riskLevel) {
   if (riskLevel === 'CRITICAL') {
      return [
         'Cancel via merchant platform',
         'Contact bank to block future charges',
         'Monitor statements for 90 days'
      ];
   } else if (riskLevel === 'HIGH_RISK') {
      return [
         'Review subscription terms',
         'Check cancellation process',
         'Set price alerts'
      ];
   } else if (riskLevel === 'NEEDS_ATTENTION') {
      return [
         'Monitor next billing cycle',
         'Review price changes'
      ];
   }
   return ['Continue monitoring'];
}

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
