import express from 'express';
import { ApiResponse } from '../models/MerchantAnalysis.js';
import Groq from 'groq-sdk';
import { cacheHelpers, CACHE_KEYS, CACHE_TTL } from '../config/redis.js';

const router = express.Router();

/**
 * Groq client, created LAZILY on first use.
 *
 * It used to be constructed at module load. groq-sdk throws in its constructor
 * when GROQ_API_KEY is absent, and this module is imported by server.js before
 * app.listen() — so a missing LLM key stopped the ENTIRE API from booting.
 *
 * That is the wrong failure mode: the LLM is an optional narration feature on
 * one endpoint out of five. Every other route reads MongoDB and Redis and does
 * not need it. Now the key is only required by the endpoint that actually calls
 * out, and its absence degrades that one route to a clean 503 instead of taking
 * the server down.
 */
let groqClient = null;
function getGroqClient() {
   if (!process.env.GROQ_API_KEY) return null;
   if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
   return groqClient;
}

router.get('/merchants', async (req, res) => {
   try {
      const { 
         page = 1, 
         limit = 20,
         minTrustScore,
         maxTrustScore,
         riskLevel
      } = req.query;
       
      const filters = { minTrustScore, maxTrustScore, riskLevel };
      const cacheKey = CACHE_KEYS.merchantList(page, limit, filters);
       
      const cachedData = await cacheHelpers.get(cacheKey);
      if (cachedData) {
         console.log('Cache HIT for merchant list');
         return res.status(200).json(cachedData);
      }
      
      console.log('Cache MISS for merchant list - fetching from DB');
      
      const query = {};
      
      // Filter by trust score range
      if (minTrustScore || maxTrustScore) {
         query['riskAssessment.trustScore'] = {};
         if (minTrustScore) query['riskAssessment.trustScore'].$gte = parseFloat(minTrustScore);
         if (maxTrustScore) query['riskAssessment.trustScore'].$lte = parseFloat(maxTrustScore);
      }
      
      // Filter by risk level
      if (riskLevel) {
         query['riskAssessment.riskLevel'] = riskLevel.toUpperCase();
      }
      
      const merchants = await ApiResponse.find(query)
         .sort({ 'riskAssessment.trustScore': -1 })
         .skip((page - 1) * limit)
         .limit(parseInt(limit))
         .lean();
      
      const total = await ApiResponse.countDocuments(query);
      
      // Strip MongoDB internals from all merchants
      const cleanMerchants = merchants.map(m => {
         const { _id, __v, createdAt, updatedAt, ...clean } = m;
         return clean;
      });
      
      const responseData = {
         success: true,
         data: cleanMerchants,
         pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / limit)
         }
      };
      
      // Cache the response
      await cacheHelpers.set(cacheKey, responseData, CACHE_TTL.MERCHANT_LIST);
      console.log('💾 Cached merchant list');
      
      return res.status(200).json(responseData);
      
   } catch (error) {
      console.error('Public API error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to fetch merchants',
         error: error.message
      });
   }
});

/**
 * GET /api/public/merchants/:merchantId
 * Get specific merchant's public API response
 */
router.get('/merchants/:merchantId', async (req, res) => {
   try {
      const { merchantId } = req.params;
      
      // Try cache first
      const cacheKey = CACHE_KEYS.merchantDetail(merchantId);
      const cachedData = await cacheHelpers.get(cacheKey);
      
      if (cachedData) {
         console.log(`Cache HIT for merchant ${merchantId}`);
         return res.status(200).json(cachedData);
      }
      
      console.log(`Cache MISS for merchant ${merchantId} - fetching from DB`);
      
      const merchant = await ApiResponse.findOne({ merchantId }).lean();
      
      if (!merchant) {
         return res.status(404).json({
            success: false,
            message: 'Merchant not found'
         });
      }
      
      // Strip MongoDB internals (_id, __v) - public API must be storage-agnostic
      const { _id, __v, createdAt, updatedAt, ...cleanMerchant } = merchant;
      
      const responseData = {
         success: true,
         data: cleanMerchant
      };
      
      // Cache the response
      await cacheHelpers.set(cacheKey, responseData, CACHE_TTL.MERCHANT_DETAIL);
      console.log(`💾 Cached merchant ${merchantId}`);
      
      return res.status(200).json(responseData);
      
   } catch (error) {
      console.error('Public API error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to fetch merchant',
         error: error.message
      });
   }
});

/**
 * GET /api/public/search
 * Search merchants by name
 */
router.get('/search', async (req, res) => {
   try {
      const { q, limit = 10 } = req.query;
      
      if (!q || q.trim().length < 2) {
         return res.status(400).json({
            success: false,
            message: 'Search query must be at least 2 characters'
         });
      }
      
      const query = {
         merchantName: { $regex: q, $options: 'i' }
      };
      
      const merchants = await ApiResponse.find(query).limit(parseInt(limit)).lean();
      
      // Strip MongoDB internals from search results
      const cleanMerchants = merchants.map(m => {
         const { _id, __v, createdAt, updatedAt, ...clean } = m;
         return clean;
      });
      
      return res.status(200).json({
         success: true,
         data: cleanMerchants
      });
      
   } catch (error) {
      console.error('Search error:', error);
      return res.status(500).json({
         success: false,
         message: 'Search failed',
         error: error.message
      });
   }
});

/**
 * GET /api/public/stats
 * Get public statistics
 */
router.get('/stats', async (req, res) => {
   try {
      const total = await ApiResponse.countDocuments();
      
      const riskDistribution = await ApiResponse.aggregate([
         {
            $group: {
               _id: '$riskAssessment.riskLevel',
               count: { $sum: 1 }
            }
         }
      ]);
      
      const avgTrustScore = await ApiResponse.aggregate([
         {
            $group: {
               _id: null,
               avgScore: { $avg: '$riskAssessment.trustScore' },
               minScore: { $min: '$riskAssessment.trustScore' },
               maxScore: { $max: '$riskAssessment.trustScore' }
            }
         }
      ]);
      
      return res.status(200).json({
         success: true,
         stats: {
            totalMerchants: total,
            riskDistribution: riskDistribution.reduce((acc, item) => {
               acc[item._id] = item.count;
               return acc;
            }, {}),
            trustScoreStats: {
               average: Math.round((avgTrustScore[0]?.avgScore || 0) * 100) / 100,
               min: avgTrustScore[0]?.minScore || 0,
               max: avgTrustScore[0]?.maxScore || 100
            }
         }
      });
      
   } catch (error) {
      console.error('Stats error:', error);
      return res.status(500).json({
         success: false,
         message: 'Failed to fetch statistics',
         error: error.message
      });
   }
});

/**
 * POST /api/public/merchants/:merchantId/ai-analysis
 * Generate AI-powered analysis explanation for a merchant
 */
router.post('/merchants/:merchantId/ai-analysis', async (req, res) => {
   try {
      const { merchantId } = req.params;
      console.log('AI Analysis requested for:', merchantId);
      
      // Try cache first for AI analysis
      const cacheKey = CACHE_KEYS.aiAnalysis(merchantId);
      const cachedAnalysis = await cacheHelpers.get(cacheKey);
      
      if (cachedAnalysis) {
         console.log(`✅ Cache HIT for AI analysis ${merchantId}`);
         return res.status(200).json(cachedAnalysis);
      }
      
      console.log(`❌ Cache MISS for AI analysis ${merchantId} - generating...`);
      
      // Fetch merchant data
      const merchant = await ApiResponse.findOne({ merchantId }).lean();
      
      if (!merchant) {
         console.log('Merchant not found:', merchantId);
         return res.status(404).json({
            success: false,
            message: 'Merchant not found'
         });
      }

      console.log('Merchant found:', merchant.merchantName);
      console.log('Calling Groq API...');

      // Prepare context for AI - using actual database structure
      const patternsText = merchant.patternsDetected && merchant.patternsDetected.length > 0
         ? merchant.patternsDetected.map(p => `- ${p.type.replace(/_/g, ' ')}: ${p.evidence} (${(p.confidence * 100).toFixed(0)}% confidence, ${p.severity} severity)`).join('\n')
         : 'No suspicious patterns detected';

      const nextStepsText = merchant.recommendedAction?.nextSteps 
         ? '\nNext Steps:\n' + merchant.recommendedAction.nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')
         : '';

      const context = `
You are a friendly financial advisor helping users understand their subscription safety.

Merchant: ${merchant.merchantName}
Category: ${merchant.category}
Trust Score: ${merchant.riskAssessment.trustScore}/100
Risk Level: ${merchant.riskAssessment.riskLevel}

Analysis Summary: ${merchant.summary.headline}
Key Issue: ${merchant.summary.oneLineReason}

Patterns Detected:
${patternsText}

Supporting Data:
- Price Change Frequency: ${merchant.supportingData?.price_change_frequency || 'N/A'}
- Notification Compliance: ${merchant.supportingData?.notification_compliance || 'N/A'}
- Descriptor Stability: ${merchant.supportingData?.descriptor_stability || 'N/A'}
- Chargeback Rate: ${merchant.supportingData?.chargeback_rate || 0}

Recommendation: ${merchant.recommendedAction.primary}
Urgency: ${merchant.recommendedAction.urgency}${nextStepsText}

Please explain this subscription analysis in a friendly, easy-to-understand way. Include:
1. What the trust score means for this merchant
2. The key concerns or positive aspects based on the patterns detected
3. Clear, actionable advice on what the user should do
4. Keep it conversational and reassuring, but honest about risks

Respond in 3-4 short paragraphs. Be direct and actionable. Use simple language.
`;

      // Call Groq API
      const groq = getGroqClient();
      if (!groq) {
         return res.status(503).json({
            success: false,
            message: 'AI explanation is unavailable: GROQ_API_KEY is not configured. The risk assessment itself is unaffected — it is computed deterministically and is already in the response from GET /api/public/merchants/:merchantId.'
         });
      }

      const completion = await groq.chat.completions.create({
         messages: [
            {
               role: 'system',
               content: 'You are a helpful financial advisor explaining subscription safety to everyday users. Be friendly, clear, and actionable. Avoid jargon.'
            },
            {
               role: 'user',
               content: context
            }
         ],
         model: 'llama-3.3-70b-versatile',
         temperature: 0.7,
         max_tokens: 500
      });

      const aiAnalysis = completion.choices[0]?.message?.content || 'Unable to generate analysis.';
      console.log('AI Analysis generated successfully');

      const responseData = {
         success: true,
         data: {
            merchantId: merchant.merchantId,
            merchantName: merchant.merchantName,
            analysis: aiAnalysis,
            generatedAt: new Date().toISOString()
         }
      };
      
      // Cache the AI analysis for 10 minutes
      await cacheHelpers.set(cacheKey, responseData, CACHE_TTL.MERCHANT_DETAIL);
      console.log(`💾 Cached AI analysis for ${merchantId}`);

      return res.status(200).json(responseData);

   } catch (error) {
      console.error('AI Analysis error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
         success: false,
         message: 'Failed to generate AI analysis',
         error: error.message
      });
   }
});

export default router;
