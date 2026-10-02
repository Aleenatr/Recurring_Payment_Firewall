import express from 'express';
import { processMerchantData, processMerchantsBatch } from '../services/merchantProcessor.js';
import { CleanedData, MerchantAnalysis, ApiResponse } from '../models/MerchantAnalysis.js';

const router = express.Router();

/**
 * POST /api/admin/ingest
 * Upload raw merchant data for processing
 * Supports single merchant or batch
 */
router.post('/ingest', async (req, res) => {
   try {
      const rawData = req.body;
      
      // Check if single merchant or batch
      const isBatch = Array.isArray(rawData);
      
      if (isBatch) {
         // Process batch
         const results = await processMerchantsBatch(rawData);
         
         return res.status(200).json({
            success: true,
            message: `Batch processing complete: ${results.processed}/${results.total} merchants processed`,
            results
         });
      } else {
         // Process single merchant
         const result = await processMerchantData(rawData);
         
         return res.status(200).json({
            success: true,
            message: 'Merchant processed successfully',
            result
         });
      }
      
   } catch (error) {
      console.error('Admin ingest error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to process merchant data',
         error: error.message
      });
   }
});

/**
 * GET /api/admin/merchants
 * Get all merchant analyses from database
 */
router.get('/merchants', async (req, res) => {
   try {
      const { 
         page = 1, 
         limit = 10, 
         riskLevel,
         sortBy = 'updatedAt',
         order = 'desc'
      } = req.query;
      
      const query = {};
      if (riskLevel) {
         // Was 'trustScore.riskClassification.level' — not a schema path, so with
         // strictQuery:false it matched nothing and this filter always returned
         // zero rows. The real path is trust_score.risk_level (models:164).
         query['trust_score.risk_level'] = riskLevel.toUpperCase();
      }
      
      const merchants = await MerchantAnalysis.find(query)
         .select('-score_breakdown') // the per-penalty detail is noise in a list view
         .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
         .skip((page - 1) * limit)
         .limit(parseInt(limit));
      
      const total = await MerchantAnalysis.countDocuments(query);
      
      return res.status(200).json({
         success: true,
         data: merchants,
         pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / limit)
         }
      });
      
   } catch (error) {
      console.error('Admin get merchants error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to fetch merchants',
         error: error.message
      });
   }
});

/**
 * GET /api/admin/merchants/:merchantId
 * Get detailed analysis for specific merchant
 */
router.get('/merchants/:merchantId', async (req, res) => {
   try {
      const { merchantId } = req.params;
      
      // Was {'merchant.id': ...} — not a schema path, so this 404'd for every
      // document the pipeline writes. The key is merchantId (models:126).
      const merchant = await MerchantAnalysis.findOne({ merchantId });
      
      if (!merchant) {
         return res.status(404).json({
            success: false,
            message: 'Merchant not found'
         });
      }
      
      return res.status(200).json({
         success: true,
         data: merchant
      });
      
   } catch (error) {
      console.error('Admin get merchant error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to fetch merchant',
         error: error.message
      });
   }
});

/**
 * DELETE /api/admin/merchants/:merchantId
 * Delete merchant analysis
 */
router.delete('/merchants/:merchantId', async (req, res) => {
   try {
      const { merchantId } = req.params;
      
      // Delete from all three collections
      await Promise.all([
         CleanedData.findOneAndDelete({ 'merchant.merchant_id': merchantId }),
         // THE WORST BUG IN THE REPO, now fixed. 'merchant.id' is not a schema
         // path, so this delete matched nothing — DELETE reported success while
         // silently leaving the analysis snapshot behind. Re-ingesting the same
         // merchant then resurrected the old verdict.
         MerchantAnalysis.findOneAndDelete({ merchantId }),
         ApiResponse.findOneAndDelete({ merchantId })
      ]);
      
      return res.status(200).json({
         success: true,
         message: 'Merchant deleted successfully from all collections'
      });
      
   } catch (error) {
      console.error('Admin delete merchant error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to delete merchant',
         error: error.message
      });
   }
});

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
router.get('/stats', async (req, res) => {
   try {
      const total = await MerchantAnalysis.countDocuments();
      
      const riskDistribution = await MerchantAnalysis.aggregate([
         {
            $group: {
               _id: '$trust_score.risk_level',
               count: { $sum: 1 }
            }
         }
      ]);
      
      const avgTrustScore = await MerchantAnalysis.aggregate([
         {
            $group: {
               _id: null,
               avgScore: { $avg: '$trust_score.score' }
            }
         }
      ]);
      
      const outliers = await MerchantAnalysis.countDocuments({ 'anomaly_analysis.is_outlier': true });
      
      return res.status(200).json({
         success: true,
         stats: {
            totalMerchants: total,
            riskDistribution: riskDistribution.reduce((acc, item) => {
               acc[item._id] = item.count;
               return acc;
            }, {}),
            averageTrustScore: Math.round((avgTrustScore[0]?.avgScore || 0) * 100) / 100,
            outlierCount: outliers
         }
      });
      
   } catch (error) {
      console.error('Admin stats error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to fetch statistics',
         error: error.message
      });
   }
});

export default router;
