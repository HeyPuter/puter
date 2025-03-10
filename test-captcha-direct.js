#!/usr/bin/env node

/**
 * Direct test for CaptchaService with Redis
 * 
 * This script directly instantiates the CaptchaService and tests its functionality
 * with Redis as the storage backend.
 */

import Redis from 'ioredis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import CaptchaService using require since it's a CommonJS module
const { CaptchaService } = require('./src/backend/src/modules/captcha/services/CaptchaService');
const crypto = require('crypto');

// Create log service
const createLogger = (name) => ({
  info: (...args) => console.log(`[${name}] INFO:`, ...args),
  warn: (...args) => console.warn(`[${name}] WARN:`, ...args),
  error: (...args) => console.error(`[${name}] ERROR:`, ...args),
  debug: (...args) => console.debug(`[${name}] DEBUG:`, ...args),
});

// Mock Context for dependency injection
class Context {
  static _instance = new Context();
  
  static get() {
    return Context._instance;
  }
  
  get(name) {
    if (name === 'log') {
      return createLogger('Context');
    }
    if (name === 'useapi') {
      return { use: (val) => val };
    }
    return null;
  }
}

async function testCaptcha() {
  console.log('=== Direct CaptchaService Redis Test ===');
  
  // Initialize Redis
  const redis = new Redis();
  const redisService = {
    client: redis,
    get: async (key) => redis.get(key),
    set: async (key, value, expiration) => {
      if (typeof expiration === 'number') {
        // Convert milliseconds to seconds for Redis
        return redis.set(key, value, 'PX', expiration);
      }
      return redis.set(key, value);
    },
    del: async (key) => redis.del(key),
    exists: async (key) => redis.exists(key),
    expire: async (key, seconds) => redis.expire(key, seconds),
    incr: async (key) => redis.incr(key),
  };
  
  try {
    // Step 1: Test Redis connection
    console.log('\n1. Testing Redis connection...');
    await redis.ping();
    console.log('✅ Redis connection successful');
    
    // Step 2: Set up services registry
    console.log('\n2. Setting up mock services registry...');
    const mockServices = {
      get: (name) => {
        if (name === 'redis') return redisService;
        if (name === 'log-service') {
          return {
            create: (serviceName) => createLogger(serviceName)
          };
        }
        if (name === 'error-service') {
          return {
            create: (log) => ({
              throw: (error) => {
                log.error(error);
                throw error;
              }
            })
          };
        }
        throw new Error(`Service '${name}' not found`);
      }
    };
    
    // Step 3: Initialize CaptchaService
    console.log('\n3. Initializing CaptchaService...');
    const captchaService = new CaptchaService({
      context: Context.get(),
      services: mockServices,
      config: {},
      my_config: {
        enabled: true,
        redis_prefix: 'test:captcha:',
        expirationTime: 5 * 60 * 1000, // 5 minutes
        rateLimit: {
          maxAttempts: 5,
          window: 60 * 1000, // 1 minute
          blockDuration: 5 * 60 * 1000 // 5 minutes
        }
      },
      name: 'captcha'
    });
    
    // Make log and services available before _construct
    captchaService.log = createLogger('CaptchaService');
    
    // Initialize the service
    await captchaService._construct();
    await captchaService.init();
    
    console.log('✅ CaptchaService initialized');
    console.log(`Using ${captchaService.useRedis ? 'Redis' : 'in-memory'} storage`);
    
    // Step 4: Test captcha generation
    console.log('\n4. Testing captcha generation...');
    
    // Check what methods are available on the CaptchaService
    console.log('Available methods:', Object.getOwnPropertyNames(CaptchaService.prototype));
    
    // Try to generate a captcha
    const testIp = '127.0.0.1';
    const captcha = await captchaService.generateCaptcha(testIp);
    console.log('Generated captcha:', captcha);
    
    // Step 5: Verify the captcha
    console.log('\n5. Testing captcha verification...');
    
    // Create a test token with known answer for verification
    const testToken = 'test-' + crypto.randomBytes(16).toString('hex');
    const testAnswer = 'testanswer';
    
    // Store the test captcha in Redis or memory
    if (captchaService.useRedis) {
      const captchaKey = `captcha:token:${testToken}`;
      await redis.set(captchaKey, testAnswer.toLowerCase(), 'PX', 60000); // 1 minute expiration
    } else {
      captchaService.captchaTokens.set(testToken, {
        text: testAnswer.toLowerCase(),
        expiresAt: Date.now() + 60000 // 1 minute expiration
      });
    }
    
    // Verify the test captcha
    const verificationResult = await captchaService.verifyCaptcha(
      testToken, 
      testAnswer,  // Use the test answer
      testIp
    );
    console.log('Verification result:', verificationResult);
    
    // Step 6: Test rate limiting
    console.log('\n6. Testing rate limiting...');
    // Override rate limit for testing
    captchaService.rateLimit = {
      maxAttempts: 3,
      window: 60 * 1000,
      blockDuration: 60 * 1000
    };
    
    for (let i = 0; i < 5; i++) {
      try {
        await captchaService.generateCaptcha(testIp);
        console.log(`Request ${i + 1}: Success`);
      } catch (error) {
        console.log(`Request ${i + 1}: ${error.message}`);
      }
    }
    
    console.log('\n=== Test Summary ===');
    console.log('✅ Tests completed');
    console.log(`Storage backend used: ${captchaService.useRedis ? 'Redis' : 'In-memory'}`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    // Cleanup
    try {
      await redis.quit();
      console.log('\nRedis connection closed');
    } catch (error) {
      console.error('Error closing Redis connection:', error.message);
    }
  }
}

// Run the test
testCaptcha().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 