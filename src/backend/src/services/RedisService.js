/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const BaseService = require('./BaseService');

/**
 * @class RedisService
 * @extends BaseService
 * @description Service that provides Redis connection and operations with fallback to in-memory storage.
 * This service can be used by other services that need to interact with Redis.
 */
class RedisService extends BaseService {
  /**
   * Initializes the Redis service with configuration and connection
   * @returns {Promise<Redis>} The Redis client instance
   */
  async _construct() {
    const Redis = require('ioredis');
    
    // Get configuration
    const redisConfig = this.config || {};
    
    // Track connection state
    this.isConnected = false;
    this.useMemoryFallback = redisConfig.fallbackToMemory || false;
    
    try {
      // Create Redis client
      this.client = new Redis({
        host: redisConfig.host || 'localhost',
        port: redisConfig.port || 6379,
        password: redisConfig.password || '',
        db: redisConfig.db || 0,
        keyPrefix: redisConfig.keyPrefix || 'puter:',
        connectTimeout: redisConfig.connectTimeout || 10000,
        enableReadyCheck: redisConfig.enableReadyCheck !== false,
        enableOfflineQueue: redisConfig.enableOfflineQueue !== false,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          this.log.info(`Redis connection retry attempt ${times} in ${delay}ms`);
          return delay;
        }
      });
      
      // Handle connection events
      this.client.on('connect', () => {
        this.isConnected = true;
        this.log.info('Connected to Redis');
      });
      
      this.client.on('error', (err) => {
        this.log.error(`Redis error: ${err.message}`);
        if (this.useMemoryFallback && !this.memoryStore) {
          this.log.info('Initializing in-memory fallback store');
          this.memoryStore = new Map();
        }
      });
      
      this.client.on('close', () => {
        this.isConnected = false;
        this.log.warn('Redis connection closed');
      });
      
      // Test connection
      await this.client.ping();
      this.log.info('Redis connection test successful');
      
      // Return the client for direct access if needed
      return this.client;
    } catch (error) {
      this.log.error(`Failed to initialize Redis: ${error.message}`);
      
      if (this.useMemoryFallback) {
        this.log.info('Initializing in-memory fallback store');
        this.memoryStore = new Map();
      } else {
        throw error; // Re-throw if no fallback is configured
      }
    }
  }
  
  /**
   * Get a value from Redis by key
   * @param {string} key - The key to get
   * @returns {Promise<string|null>} The value or null if not found
   */
  async get(key) {
    try {
      if (this.isConnected) {
        return await this.client.get(key);
      } else if (this.memoryStore) {
        return this.memoryStore.get(key);
      }
    } catch (error) {
      this.log.error(`Redis get error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        return this.memoryStore.get(key);
      }
    }
    return null;
  }
  
  /**
   * Set a value in Redis
   * @param {string} key - The key to set
   * @param {string} value - The value to set
   * @param {number|null} ttl - Time to live in milliseconds (optional)
   * @returns {Promise<string|null>} 'OK' if successful, null otherwise
   */
  async set(key, value, ttl = null) {
    try {
      if (this.isConnected) {
        if (ttl) {
          return await this.client.set(key, value, 'PX', ttl);
        }
        return await this.client.set(key, value);
      } else if (this.memoryStore) {
        this.memoryStore.set(key, value);
        if (ttl) {
          setTimeout(() => this.memoryStore.delete(key), ttl);
        }
        return 'OK';
      }
    } catch (error) {
      this.log.error(`Redis set error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        this.memoryStore.set(key, value);
        if (ttl) {
          setTimeout(() => this.memoryStore.delete(key), ttl);
        }
        return 'OK';
      }
    }
    return null;
  }
  
  /**
   * Delete a key from Redis
   * @param {string} key - The key to delete
   * @returns {Promise<number>} Number of keys deleted (0 or 1)
   */
  async del(key) {
    try {
      if (this.isConnected) {
        return await this.client.del(key);
      } else if (this.memoryStore) {
        return this.memoryStore.delete(key) ? 1 : 0;
      }
    } catch (error) {
      this.log.error(`Redis del error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        return this.memoryStore.delete(key) ? 1 : 0;
      }
    }
    return 0;
  }
  
  /**
   * Check if a key exists in Redis
   * @param {string} key - The key to check
   * @returns {Promise<number>} 1 if the key exists, 0 otherwise
   */
  async exists(key) {
    try {
      if (this.isConnected) {
        return await this.client.exists(key);
      } else if (this.memoryStore) {
        return this.memoryStore.has(key) ? 1 : 0;
      }
    } catch (error) {
      this.log.error(`Redis exists error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        return this.memoryStore.has(key) ? 1 : 0;
      }
    }
    return 0;
  }
  
  /**
   * Increment a key in Redis
   * @param {string} key - The key to increment
   * @returns {Promise<number|null>} The new value or null if failed
   */
  async incr(key) {
    try {
      if (this.isConnected) {
        return await this.client.incr(key);
      } else if (this.memoryStore) {
        const value = parseInt(this.memoryStore.get(key) || 0) + 1;
        this.memoryStore.set(key, value.toString());
        return value;
      }
    } catch (error) {
      this.log.error(`Redis incr error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        const value = parseInt(this.memoryStore.get(key) || 0) + 1;
        this.memoryStore.set(key, value.toString());
        return value;
      }
    }
    return null;
  }
  
  /**
   * Set a key expiration time
   * @param {string} key - The key to set expiration for
   * @param {number} ttl - Time to live in milliseconds
   * @returns {Promise<number>} 1 if successful, 0 otherwise
   */
  async expire(key, ttl) {
    try {
      if (this.isConnected) {
        return await this.client.pexpire(key, ttl);
      } else if (this.memoryStore) {
        if (this.memoryStore.has(key)) {
          setTimeout(() => this.memoryStore.delete(key), ttl);
          return 1;
        }
        return 0;
      }
    } catch (error) {
      this.log.error(`Redis expire error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        if (this.memoryStore.has(key)) {
          setTimeout(() => this.memoryStore.delete(key), ttl);
          return 1;
        }
        return 0;
      }
    }
    return 0;
  }
  
  /**
   * Check rate limit and increment counter
   * @param {string} key - The rate limit key
   * @param {number} max - Maximum number of requests allowed
   * @param {number} window - Time window in milliseconds
   * @returns {Promise<boolean>} True if under limit, false if limit exceeded
   */
  async checkRateLimit(key, max, window) {
    try {
      if (this.isConnected) {
        const current = parseInt(await this.client.get(key) || '0');
        if (current >= max) {
          return false;
        }
        
        await this.client.incr(key);
        if (current === 0) {
          await this.client.pexpire(key, window);
        }
        
        return true;
      } else if (this.memoryStore) {
        const current = parseInt(this.memoryStore.get(key) || '0');
        if (current >= max) {
          return false;
        }
        
        this.memoryStore.set(key, (current + 1).toString());
        if (current === 0) {
          setTimeout(() => this.memoryStore.delete(key), window);
        }
        
        return true;
      }
    } catch (error) {
      this.log.error(`Redis rate limit error for key ${key}: ${error.message}`);
      if (this.memoryStore) {
        const current = parseInt(this.memoryStore.get(key) || '0');
        if (current >= max) {
          return false;
        }
        
        this.memoryStore.set(key, (current + 1).toString());
        if (current === 0) {
          setTimeout(() => this.memoryStore.delete(key), window);
        }
        
        return true;
      }
    }
    return true; // Default to allowing if all else fails
  }
  
  /**
   * Check if Redis is healthy and connected
   * @returns {Promise<boolean>} True if healthy, false otherwise
   */
  async isHealthy() {
    try {
      if (this.isConnected) {
        await this.client.ping();
        return true;
      }
      return false;
    } catch (error) {
      this.log.error(`Redis health check failed: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Gracefully shut down the Redis connection
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.client) {
      this.log.info('Shutting down Redis connection');
      await this.client.quit();
      this.isConnected = false;
    }
    this.memoryStore = null;
  }
}

module.exports = { RedisService }; 