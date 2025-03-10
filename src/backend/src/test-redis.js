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

/**
 * Test script for verifying Redis service functionality
 * 
 * This script tests the basic operations of the RedisService directly:
 * - Setting a value
 * - Getting a value
 * - Checking if a key exists
 * - Incrementing a value
 * - Deleting a value
 * - Rate limiting functionality
 */

// Import the RedisService
const { RedisService } = require('./services/RedisService');

// Create a test function
async function testRedisService() {
  console.log('Starting Redis Service Test...');
  
  try {
    // Create a mock log object
    const mockLog = {
      info: (msg) => console.log(`[INFO] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      debug: (msg) => console.debug(`[DEBUG] ${msg}`)
    };
    
    // Create a mock service resources object
    const serviceResources = {
      services: {
        get: (name) => {
          if (name === 'log-service') {
            return {
              create: () => mockLog
            };
          }
          return null;
        }
      },
      config: {},
      my_config: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'puter:test:',
        fallbackToMemory: true // Enable fallback to memory if Redis fails
      },
      name: 'redis',
      args: [],
      context: {}
    };
    
    // Create the Redis service instance
    const redisService = new RedisService(serviceResources);
    
    // Set the log property directly
    redisService.log = mockLog;
    
    // Initialize the service
    console.log('Initializing Redis service...');
    await redisService._construct();
    console.log('Redis service initialized successfully');
    
    // Test connection health
    const isHealthy = await redisService.isHealthy();
    console.log(`Redis connection health: ${isHealthy ? 'Healthy' : 'Unhealthy'}`);
    
    // Test basic operations
    const testKey = 'service:key';
    const testValue = 'Hello Redis Service!';
    
    // Set value
    console.log(`Setting key "${testKey}" to "${testValue}"...`);
    const setResult = await redisService.set(testKey, testValue);
    console.log(`Set result: ${setResult}`);
    
    // Get value
    console.log(`Getting key "${testKey}"...`);
    const getValue = await redisService.get(testKey);
    console.log(`Get result: ${getValue}`);
    
    // Check if key exists
    console.log(`Checking if key "${testKey}" exists...`);
    const existsResult = await redisService.exists(testKey);
    console.log(`Exists result: ${existsResult}`);
    
    // Test increment
    const counterKey = 'service:counter';
    console.log(`Setting counter key "${counterKey}" to 0...`);
    await redisService.set(counterKey, '0');
    
    console.log(`Incrementing counter key "${counterKey}"...`);
    const incrResult1 = await redisService.incr(counterKey);
    console.log(`First increment result: ${incrResult1}`);
    
    console.log(`Incrementing counter key "${counterKey}" again...`);
    const incrResult2 = await redisService.incr(counterKey);
    console.log(`Second increment result: ${incrResult2}`);
    
    // Test expiration
    const expiringKey = 'service:expiring';
    console.log(`Setting expiring key "${expiringKey}" with 2 second TTL...`);
    await redisService.set(expiringKey, 'This will expire', 2000);
    
    console.log(`Checking if expiring key exists immediately...`);
    const expiringExists1 = await redisService.exists(expiringKey);
    console.log(`Expiring key exists (before expiration): ${expiringExists1}`);
    
    console.log('Waiting 3 seconds for key to expire...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`Checking if expiring key exists after TTL...`);
    const expiringExists2 = await redisService.exists(expiringKey);
    console.log(`Expiring key exists (after expiration): ${expiringExists2}`);
    
    // Test rate limiting
    const rateLimitKey = 'service:ratelimit';
    console.log(`Testing rate limiting with key "${rateLimitKey}"...`);
    
    console.log('Checking rate limit (1st attempt)...');
    const rateLimit1 = await redisService.checkRateLimit(rateLimitKey, 3, 5000);
    console.log(`Rate limit result (1/3): ${JSON.stringify(rateLimit1)}`);
    
    console.log('Checking rate limit (2nd attempt)...');
    const rateLimit2 = await redisService.checkRateLimit(rateLimitKey, 3, 5000);
    console.log(`Rate limit result (2/3): ${JSON.stringify(rateLimit2)}`);
    
    console.log('Checking rate limit (3rd attempt)...');
    const rateLimit3 = await redisService.checkRateLimit(rateLimitKey, 3, 5000);
    console.log(`Rate limit result (3/3): ${JSON.stringify(rateLimit3)}`);
    
    console.log('Checking rate limit (4th attempt - should be limited)...');
    const rateLimit4 = await redisService.checkRateLimit(rateLimitKey, 3, 5000);
    console.log(`Rate limit result (4/3 - should be limited): ${JSON.stringify(rateLimit4)}`);
    
    // Clean up test keys
    console.log('Cleaning up test keys...');
    await redisService.del(testKey);
    await redisService.del(counterKey);
    await redisService.del(rateLimitKey);
    
    console.log('Redis service test completed successfully!');
    
    // Shutdown Redis connection
    console.log('Shutting down Redis connection...');
    await redisService.shutdown();
    
  } catch (error) {
    console.error('Error during Redis service test:', error);
  }
}

// Run the test
testRedisService().catch(console.error); 