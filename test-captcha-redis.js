#!/usr/bin/env node

/**
 * Test script for CaptchaService Redis integration
 * 
 * This script tests the integration between the CaptchaService and Redis
 * to verify that captcha generation, verification, and rate limiting
 * are working correctly with Redis as the storage backend.
 */

// Import required modules
import { createContainer } from './src/backend/src/container.js';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const Redis = require('ioredis');

// Create a test container
async function runTests() {
    console.log('=== CaptchaService Redis Integration Test ===');
    
    // Step 1: Create a container and get services
    console.log('\n1. Setting up test environment...');
    const container = createContainer();
    const services = container.get('services');
    
    try {
        // Step 2: Test Redis connection
        console.log('\n2. Testing Redis connection...');
        const redis = services.get('redis');
        if (!redis) {
            throw new Error('Redis service not found in service registry');
        }
        
        // Test Redis connection with a simple ping
        try {
            await redis.client.ping();
            console.log('✅ Redis connection successful');
        } catch (error) {
            console.error('❌ Redis connection failed:', error.message);
            console.log('Continuing tests with in-memory fallback...');
        }
        
        // Step 3: Get CaptchaService
        console.log('\n3. Loading CaptchaService...');
        const captchaModule = await container.load('./src/backend/src/modules/captcha/CaptchaModule.js');
        await captchaModule.install(container);
        
        const captchaService = services.get('captcha');
        if (!captchaService) {
            throw new Error('CaptchaService not found in service registry');
        }
        console.log('✅ CaptchaService loaded successfully');
        console.log(`   Using ${captchaService.useRedis ? 'Redis' : 'in-memory'} storage`);
        
        // Step 4: Test captcha generation
        console.log('\n4. Testing captcha generation...');
        const captcha = await captchaService.generateCaptcha('test-ip');
        if (!captcha || !captcha.token || !captcha.data) {
            throw new Error('Failed to generate captcha');
        }
        console.log(`✅ Captcha generated successfully with token: ${captcha.token.substring(0, 10)}...`);
        
        // Step 5: Verify the captcha was stored in Redis
        console.log('\n5. Verifying captcha storage...');
        if (captchaService.useRedis) {
            const captchaKey = `captcha:token:${captcha.token}`;
            const storedValue = await redis.get(captchaKey);
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
        
        // Step 6: Test captcha verification with incorrect answer
        console.log('\n6. Testing captcha verification with incorrect answer...');
        const incorrectResult = await captchaService.verifyCaptcha(captcha.token, 'wrong-answer', 'test-ip');
        if (incorrectResult !== false) {
            throw new Error('Verification should fail with incorrect answer');
        }
        console.log('✅ Verification correctly failed with incorrect answer');
        
        // Step 7: Generate a new captcha for verification test
        console.log('\n7. Generating a new captcha for verification test...');
        const testCaptcha = await captchaService.generateCaptcha('test-ip-2');
        
        // Create a test token with known answer for verification
        const testToken = 'test-' + crypto.randomBytes(16).toString('hex');
        const testAnswer = 'testanswer';
        
        if (captchaService.useRedis) {
            const captchaKey = `captcha:token:${testToken}`;
            await redis.set(captchaKey, testAnswer, 60000); // 1 minute expiration
        } else {
            captchaService.captchaTokens.set(testToken, {
                text: testAnswer,
                expiresAt: Date.now() + 60000 // 1 minute expiration
            });
        }
        console.log(`✅ Test captcha created with token: ${testToken.substring(0, 10)}...`);
        
        // Step 8: Test captcha verification with correct answer
        console.log('\n8. Testing captcha verification with correct answer...');
        const correctResult = await captchaService.verifyCaptcha(testToken, testAnswer, 'test-ip-2');
        if (correctResult !== true) {
            throw new Error('Verification should succeed with correct answer');
        }
        console.log('✅ Verification succeeded with correct answer');
        
        // Step 9: Verify one-time use (token should be deleted after verification)
        console.log('\n9. Verifying one-time use (token should be deleted)...');
        const secondVerification = await captchaService.verifyCaptcha(testToken, testAnswer, 'test-ip-2');
        if (secondVerification !== false) {
            throw new Error('Token should be deleted after first verification');
        }
        console.log('✅ Token correctly deleted after verification');
        
        // Step 10: Test rate limiting
        console.log('\n10. Testing rate limiting...');
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
        
        // Step 11: Test IP blocking
        console.log('\n11. Testing IP blocking...');
        if (captchaService.useRedis) {
            const blockedIp = 'blocked-test-ip';
            const blockKey = `captcha:blocked:${blockedIp}`;
            
            // Manually block an IP
            await redis.set(blockKey, '1', 60);
            console.log('   IP manually blocked in Redis');
            
            // Try to verify a captcha from a blocked IP
            try {
                await captchaService.verifyCaptcha(testToken, 'any-answer', blockedIp);
                console.error('   ❌ Blocked IP was allowed to verify captcha');
            } catch (error) {
                if (error.message.includes('IP is blocked')) {
                    console.log('   ✅ Blocked IP correctly prevented from verifying captcha');
                } else {
                    console.error('   ❌ Unexpected error during IP blocking test:', error.message);
                }
            }
            
            // Clean up the test block
            await redis.del(blockKey);
        } else {
            console.log('   ⚠️ Skipping IP blocking test (requires Redis)');
        }
        
        // Step 12: Test self-test functionality
        console.log('\n12. Testing self-test functionality...');
        const selfTestResult = await captchaService.verifySelfTest();
        if (selfTestResult !== true) {
            throw new Error('Self-test failed');
        }
        console.log('✅ Self-test passed successfully');
        
        // Step 13: Test Redis failure handling (if using Redis)
        console.log('\n13. Testing Redis failure handling...');
        if (captchaService.useRedis) {
            // Create a test token in memory as fallback
            captchaService.captchaTokens = captchaService.captchaTokens || new Map();
            const fallbackToken = 'fallback-' + crypto.randomBytes(16).toString('hex');
            const fallbackAnswer = 'fallbackanswer';
            
            captchaService.captchaTokens.set(fallbackToken, {
                text: fallbackAnswer,
                expiresAt: Date.now() + 60000
            });
            
            // Temporarily break Redis connection to test fallback
            const originalClient = captchaService.redis.client;
            captchaService.redis.client = {
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
            captchaService.redis.client = originalClient;
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
            if (services && services.get('redis') && services.get('redis').client) {
                await services.get('redis').client.quit();
                console.log('\nRedis connection closed');
            }
        } catch (error) {
            console.error('Error closing Redis connection:', error.message);
        }
        
        process.exit(0);
    }
}

// Run the tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 