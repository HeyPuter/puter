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
 * Simple test script for verifying Redis functionality
 * 
 * This script directly tests Redis using the ioredis library without relying on the service structure.
 */

// Import Redis client
const Redis = require('ioredis');

// Create a test function
async function testRedis() {
  console.log('Starting Redis Test...');
  
  // Create Redis client with default configuration
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    password: '',
    db: 0,
    keyPrefix: 'puter:test:',
  });
  
  try {
    // Test connection
    console.log('Testing Redis connection...');
    const pingResult = await redis.ping();
    console.log(`Ping result: ${pingResult}`);
    
    // Test basic operations
    const testKey = 'simple:key';
    const testValue = 'Hello Redis!';
    
    // Set value
    console.log(`Setting key "${testKey}" to "${testValue}"...`);
    const setResult = await redis.set(testKey, testValue);
    console.log(`Set result: ${setResult}`);
    
    // Get value
    console.log(`Getting key "${testKey}"...`);
    const getValue = await redis.get(testKey);
    console.log(`Get result: ${getValue}`);
    
    // Check if key exists
    console.log(`Checking if key "${testKey}" exists...`);
    const existsResult = await redis.exists(testKey);
    console.log(`Exists result: ${existsResult}`);
    
    // Test increment
    const counterKey = 'simple:counter';
    console.log(`Setting counter key "${counterKey}" to 0...`);
    await redis.set(counterKey, '0');
    
    console.log(`Incrementing counter key "${counterKey}"...`);
    const incrResult1 = await redis.incr(counterKey);
    console.log(`First increment result: ${incrResult1}`);
    
    console.log(`Incrementing counter key "${counterKey}" again...`);
    const incrResult2 = await redis.incr(counterKey);
    console.log(`Second increment result: ${incrResult2}`);
    
    // Test expiration
    const expiringKey = 'simple:expiring';
    console.log(`Setting expiring key "${expiringKey}" with 2 second TTL...`);
    await redis.set(expiringKey, 'This will expire', 'PX', 2000);
    
    console.log(`Checking if expiring key exists immediately...`);
    const expiringExists1 = await redis.exists(expiringKey);
    console.log(`Expiring key exists (before expiration): ${expiringExists1}`);
    
    console.log('Waiting 3 seconds for key to expire...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`Checking if expiring key exists after TTL...`);
    const expiringExists2 = await redis.exists(expiringKey);
    console.log(`Expiring key exists (after expiration): ${expiringExists2}`);
    
    // Clean up test keys
    console.log('Cleaning up test keys...');
    await redis.del(testKey);
    await redis.del(counterKey);
    
    console.log('Redis test completed successfully!');
    
  } catch (error) {
    console.error('Error during Redis test:', error);
  } finally {
    // Close Redis connection
    console.log('Closing Redis connection...');
    redis.quit();
  }
}

// Run the test
testRedis().catch(console.error); 