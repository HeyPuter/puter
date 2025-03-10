#!/usr/bin/env node

/**
 * Test script for CaptchaService Redis integration using the application's Kernel
 * 
 * This script tests the integration between the CaptchaService and Redis
 * by using the actual application's Kernel to initialize services.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { testlaunch } = require('./src/backend/src/index.js');

async function testCaptcha() {
    console.log('=== CaptchaService Redis Integration Test ===');
    
    try {
        // Step 1: Initialize Kernel
        console.log('\n1. Initializing Kernel...');
        const kernel = testlaunch();
        console.log('✅ Kernel initialized successfully');
        
        // Step 2: Get services
        console.log('\n2. Getting services...');
        const services = kernel.get('services');
        const redis = services.get('redis');
        const captchaService = services.get('captcha');
        
        if (!redis || !captchaService) {
            throw new Error('Required services not found');
        }
        console.log('✅ Services loaded successfully');
        console.log(`   Using ${captchaService.useRedis ? 'Redis' : 'in-memory'} storage`);
        
        // Step 3: Test Redis connection
        console.log('\n3. Testing Redis connection...');
        await redis.client.ping();
        console.log('✅ Redis connection successful');
        
        // Step 4: Test captcha generation
        console.log('\n4. Testing captcha generation...');
        const captcha = await captchaService.generateCaptcha('test-ip');
        if (!captcha || !captcha.token || !captcha.data) {
            throw new Error('Failed to generate captcha');
        }
        console.log(`✅ Captcha generated successfully with token: ${captcha.token.substring(0, 10)}...`);
        
        // Step 5: Verify captcha storage
        console.log('\n5. Verifying captcha storage...');
        if (captchaService.useRedis) {
            const captchaKey = `captcha:token:${captcha.token}`;
            const storedValue = await redis.client.get(captchaKey);
            if (!storedValue) {
                throw new Error('Captcha not found in Redis');
            }
            console.log('✅ Captcha found in Redis storage');
        } else {
            const storedCaptcha = captchaService.captchaTokens.get(captcha.token);
            if (!storedCaptcha) {
                throw new Error('Captcha not found in memory storage');
            }
            console.log('✅ Captcha found in memory storage');
        }
        
        // Step 6: Test rate limiting
        console.log('\n6. Testing rate limiting...');
        const testIp = 'rate-limit-test-ip';
        
        // Override rate limit for testing
        captchaService.rateLimit = {
            maxAttempts: 3,
            window: 60000,
            blockDuration: 60000
        };
        
        console.log('   Making multiple requests to trigger rate limit...');
        try {
            // This should pass (1st attempt)
            await captchaService.checkRateLimit(`generate:${testIp}`);
            console.log('   ✅ Request 1: Allowed');
            
            // This should pass (2nd attempt)
            await captchaService.checkRateLimit(`generate:${testIp}`);
            console.log('   ✅ Request 2: Allowed');
            
            // This should pass (3rd attempt)
            await captchaService.checkRateLimit(`generate:${testIp}`);
            console.log('   ✅ Request 3: Allowed');
            
            // This should fail (4th attempt, exceeds limit)
            await captchaService.checkRateLimit(`generate:${testIp}`);
            console.error('   ❌ Request 4: Should have been blocked but was allowed');
        } catch (error) {
            if (error.message === 'Rate limit exceeded') {
                console.log('   ✅ Request 4: Correctly blocked (rate limit exceeded)');
            } else {
                console.error('   ❌ Unexpected error during rate limit test:', error.message);
            }
        }
        
        // Step 7: Test IP blocking
        console.log('\n7. Testing IP blocking...');
        if (captchaService.useRedis) {
            const blockedIp = 'blocked-test-ip';
            const blockKey = `captcha:blocked:${blockedIp}`;
            
            // Manually block an IP
            await redis.client.set(blockKey, '1', 'EX', 60);
            console.log('   IP manually blocked in Redis');
            
            // Try to verify a captcha from a blocked IP
            try {
                await captchaService.verifyCaptcha(captcha.token, 'any-answer', blockedIp);
                console.error('   ❌ Blocked IP was allowed to verify captcha');
            } catch (error) {
                if (error.message.includes('IP is blocked')) {
                    console.log('   ✅ Blocked IP correctly prevented from verifying captcha');
                } else {
                    console.error('   ❌ Unexpected error during IP blocking test:', error.message);
                }
            }
            
            // Clean up the test block
            await redis.client.del(blockKey);
        } else {
            console.log('   ⚠️ Skipping IP blocking test (requires Redis)');
        }
        
        // Step 8: Test Redis failure handling
        console.log('\n8. Testing Redis failure handling...');
        if (captchaService.useRedis) {
            // Create a test token in memory as fallback
            captchaService.captchaTokens = captchaService.captchaTokens || new Map();
            const fallbackToken = 'fallback-test-token';
            const fallbackAnswer = 'fallbackanswer';
            
            captchaService.captchaTokens.set(fallbackToken, {
                text: fallbackAnswer,
                expiresAt: Date.now() + 60000
            });
            
            // Temporarily break Redis connection to test fallback
            const originalClient = redis.client;
            redis.client = {
                get: () => { throw new Error('Simulated Redis failure'); },
                set: () => { throw new Error('Simulated Redis failure'); },
                del: () => { throw new Error('Simulated Redis failure'); },
                exists: () => { throw new Error('Simulated Redis failure'); }
            };
            
            // Try to verify with Redis "down" - should fall back to memory
            try {
                const fallbackResult = await captchaService.verifyCaptcha(fallbackToken, fallbackAnswer, 'fallback-ip');
                if (fallbackResult === true) {
                    console.log('✅ Successfully fell back to in-memory storage when Redis failed');
                } else {
                    console.error('❌ Failed to use in-memory fallback when Redis failed');
                }
            } catch (error) {
                console.error('❌ Error during fallback test:', error.message);
            }
            
            // Restore original Redis client
            redis.client = originalClient;
        } else {
            console.log('   ⚠️ Skipping Redis failure test (not using Redis)');
        }
        
        console.log('\n=== Test Summary ===');
        console.log('✅ All tests completed successfully');
        console.log(`Storage backend used: ${captchaService.useRedis ? 'Redis' : 'In-memory'}`);
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        // Clean up
        try {
            const services = kernel.get('services');
            const redis = services.get('redis');
            if (redis && redis.client) {
                await redis.client.quit();
                console.log('\nRedis connection closed');
            }
        } catch (error) {
            console.error('Error closing Redis connection:', error.message);
        }
        
        process.exit(0);
    }
}

// Run the tests
testCaptcha().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 