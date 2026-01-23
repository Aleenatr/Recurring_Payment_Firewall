import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Create Redis client
const redisClient = createClient({
   url: process.env.REDIS_URL || 'redis://localhost:6379',
   socket: {
      reconnectStrategy: (retries) => {
         if (retries > 10) {
            console.error('Redis: Too many reconnection attempts');
            return new Error('Too many retries');
         }
         return retries * 100; // Exponential backoff
      }
   }
});

// Error handling
redisClient.on('error', (err) => {
   console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
   console.log('Redis Client Connected');
});

redisClient.on('ready', () => {
   console.log('Redis Client Ready');
});

// Connect to Redis
export const connectRedis = async () => {
   try {
      await redisClient.connect();
      console.log('✅ Redis Connected Successfully');
   } catch (error) {
      console.error('❌ Redis Connection Failed:', error.message);
      console.log('⚠️  Server will continue without Redis caching');
   }
};

// Cache TTL configurations
export const CACHE_TTL = {
   MERCHANT_LIST: 300,        // 5 minutes for merchant list
   MERCHANT_DETAIL: 600,      // 10 minutes for individual merchant
   SEARCH_RESULTS: 180,       // 3 minutes for search results
   STATS: 120                 // 2 minutes for statistics
};

// Cache key generators
export const CACHE_KEYS = {
   merchantList: (page, limit, filters) => {
      const filterStr = filters ? JSON.stringify(filters) : 'all';
      return `merchants:list:${page}:${limit}:${filterStr}`;
   },
   merchantDetail: (merchantId) => `merchant:detail:${merchantId}`,
   merchantStats: () => 'merchants:stats',
   aiAnalysis: (merchantId) => `ai:analysis:${merchantId}`
};

// Cache helper functions
export const cacheHelpers = {
   // Get cached data
   async get(key) {
      try {
         if (!redisClient.isReady) return null;
         const data = await redisClient.get(key);
         return data ? JSON.parse(data) : null;
      } catch (error) {
         console.error(`Redis GET error for key ${key}:`, error);
         return null;
      }
   },

   // Set cache data with TTL
   async set(key, data, ttl = 300) {
      try {
         if (!redisClient.isReady) return false;
         await redisClient.setEx(key, ttl, JSON.stringify(data));
         return true;
      } catch (error) {
         console.error(`Redis SET error for key ${key}:`, error);
         return false;
      }
   },

   // Delete specific cache
   async del(key) {
      try {
         if (!redisClient.isReady) return false;
         await redisClient.del(key);
         return true;
      } catch (error) {
         console.error(`Redis DEL error for key ${key}:`, error);
         return false;
      }
   },

   // Delete cache by pattern
   async delPattern(pattern) {
      try {
         if (!redisClient.isReady) return false;
         const keys = await redisClient.keys(pattern);
         if (keys.length > 0) {
            await redisClient.del(keys);
         }
         return true;
      } catch (error) {
         console.error(`Redis DEL pattern error for ${pattern}:`, error);
         return false;
      }
   },

   // Invalidate all merchant caches
   async invalidateMerchantCache() {
      try {
         if (!redisClient.isReady) return false;
         await this.delPattern('merchants:*');
         await this.delPattern('merchant:*');
         await this.delPattern('ai:*');
         console.log('🗑️  All merchant caches invalidated');
         return true;
      } catch (error) {
         console.error('Redis invalidation error:', error);
         return false;
      }
   }
};

export default redisClient;
