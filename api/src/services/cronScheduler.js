import cron from 'node-cron';
import { CleanedData, MerchantAnalysis, ApiResponse } from '../models/MerchantAnalysis.js';
import extractSignals from '../ingestion/analysis/extractSignals.js';
import performKMeansClustering from '../ingestion/analysis/kmeansAnalysis.js';
import performDBSCANClustering from '../ingestion/analysis/dbscanAnalysis.js';
import generateMerchantScore from '../ingestion/analysis/merchantScoring.js';
import generateApiResponse from '../ingestion/controller/generateApiResponse.js';
 
export async function reprocessAllMerchants() {
   const startTime = Date.now();
   
   try { 
      const allMerchants = await CleanedData.find({})
         .select('merchant subscriptionCount userCount aggregatedMetrics subscriptions transactions metadata')
         .lean();
      
      if (allMerchants.length === 0) {
         return {
            success: true,
            message: 'No merchants to process',
            processed: 0
         };
      }
      
      console.log(`   Found ${allMerchants.length} merchants`);
        
      const allSignals = allMerchants.map(merchant => {
         const signals = extractSignals(merchant);
         return {
            merchantId: merchant.merchant.merchant_id,
            merchantName: merchant.merchant.merchant_name,
            cleanData: merchant,
            signals
         };
      });
       
      const kmeansResult = performKMeansClustering(
         allSignals.map(m => m.signals),
         Math.min(3, allSignals.length)  
      );
      
      console.log(`   Clustered into ${kmeansResult.clusters.length} groups`);
      
      console.log('\n[4] Running DBSCAN outlier detection...');
      const dbscanResult = performDBSCANClustering(
         allSignals.map(m => m.signals),
         0.3,
         2
      );
      
      console.log(`   Identified ${dbscanResult.outliers?.length || 0} outliers`);
       
      console.log('\n[5] Updating merchant analyses...');
      let updated = 0;
      let failed = 0;
      
      for (let i = 0; i < allSignals.length; i++) {
         const merchantData = allSignals[i];
         const merchantIndex = i;
         
         try { 
            const merchantKmeansResult = {
               assignedCluster: kmeansResult.merchantAssignments[merchantIndex],
               note: kmeansResult.note || "Batch analysis"
            };
            
            // Calculate trust score
            const merchantScore = generateMerchantScore(
               merchantData.cleanData,
               merchantKmeansResult,
               dbscanResult,
               merchantData.signals,
               merchantIndex
            );
            
            // Generate snapshot
            const snapshot = {
               timestamp: new Date().toISOString(),
               merchant: {
                  id: merchantData.merchantId,
                  name: merchantData.merchantName
               },
               cleanedData: merchantData.cleanData,
               signals: {
                  coreSignals: merchantData.signals.coreSignals,
                  supportingSignals: merchantData.signals.supportingSignals,
                  rawMetrics: merchantData.signals.rawMetrics
               },
               kmeansAnalysis: {
                  assignedCluster: kmeansResult.merchantAssignments[merchantIndex],
                  clusters: kmeansResult.clusters,
                  centroids: kmeansResult.centroids
               },
               dbscanAnalysis: dbscanResult,
               trustScore: merchantScore,
               metadata: {
                  totalUsers: merchantScore.totalUsers,
                  totalSubscriptions: merchantScore.totalSubscriptions,
                  analysisTimestamp: new Date().toISOString(),
                  version: "2.0.0",
                  merchantIndex: merchantIndex
               }
            };
            
            // Generate API response
            const apiResponse = generateApiResponse(snapshot, Date.now() - startTime);
            
            // Update merchant_analysis_data collection
            await MerchantAnalysis.findOneAndUpdate(
               { 'merchant.id': merchantData.merchantId },
               snapshot,
               { upsert: true, new: true }
            );
            
            // Update api_response collection
            await ApiResponse.findOneAndUpdate(
               { merchantId: merchantData.merchantId },
               apiResponse,
               { upsert: true, new: true }
            );
            
            updated++;
            console.log(`   ✓ Updated ${merchantData.merchantName} (${merchantScore.trustScore}/100)`);
            
         } catch (error) {
            failed++;
            console.error(`   ✗ Failed ${merchantData.merchantName}: ${error.message}`);
         }
      }
      
      const totalTime = Date.now() - startTime;
      
      return {
         success: true,
         processed: updated,
         failed,
         total: allMerchants.length,
         duration: totalTime
      };
      
   } catch (error) {
      console.error('❌ Cron job error:', error);
      throw error;
   }
}

/**
 * Initialize cron job scheduler
 * @param {string} schedule - Cron schedule expression (default: every 6 hours)
 */
export function startCronJob(schedule = '0 */6 * * *') {
   // Schedule the job
   const job = cron.schedule(schedule, async () => {
      try {
         await reprocessAllMerchants();
      } catch (error) {
         console.error('Cron job execution failed:', error);
      }
   });
   
   console.log('Cron job started successfully\n');
   
   return job;
}

// For Testing
export async function runImmediateReprocessing() {
   console.log('\n Running immediate reprocessing...');
   return await reprocessAllMerchants();
}

export default { startCronJob, reprocessAllMerchants, runImmediateReprocessing };
