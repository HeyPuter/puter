#!/usr/bin/env node

/**
 * Simple test script for CaptchaService Redis integration
 * 
 * This script directly tests the CaptchaService with Redis
 * without using the application's Kernel.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Redis = require('ioredis');
const { CaptchaService } = require('./src/backend/src/modules/captcha/services/CaptchaService');
const crypto = require('crypto');

async function testCaptcha() {
    console.log('Starting CaptchaService Redis integration test...');

    // Initialize Redis
    const redis = new Redis();
    try {
        // Test Redis connection
        await redis.ping();
        console.log('Redis connection successful');

        // Create logging service
        const createLogger = (serviceName) => ({
            info: (...args) => console.log(`[${serviceName}]`, ...args),
            warn: (...args) => console.warn(`[${serviceName}]`, ...args),
            error: (...args) => console.error(`[${serviceName}]`, ...args),
            debug: (...args) => console.debug(`[${serviceName}]`, ...args),
        });

        // Mock service resources required by BaseService
        const service_resources = {
            services: {
                get: (name) => {
                    if (name === 'redis') {
                        return {
                            get: redis.get.bind(redis),
                            set: redis.set.bind(redis),
                            del: redis.del.bind(redis),
                            exists: redis.exists.bind(redis),
                            expire: redis.expire.bind(redis),
                        };
                    }
                    if (name === 'log-service') {
                        return {
                            create: createLogger,
                        };
                    }
                    if (name === 'error-service') {
                        return {
                            create: (log) => ({
                                throw: (error) => {
                                    log.error(error);
                                    throw error;
                                },
                            }),
                        };
                    }
                    throw new Error(`Service ${name} not found`);
                },
            },
            config: {}, // Global config
            my_config: {
                redis_prefix: 'test_captcha:', // Prefix for Redis keys
                rate_limit: 5, // Requests per minute
                block_duration: 60, // Block duration in seconds
            },
            name: 'CaptchaService',
            args: [],
            context: {
                get: (name) => {
                    if (name === 'log') {
                        return createLogger('CaptchaService');
                    }
                    if (name === 'useapi') {
                        return {
                            use: (value) => value, // Simple pass-through for now
                        };
                    }
                    throw new Error(`Context ${name} not found`);
                },
            },
        };

        // Initialize CaptchaService
        const captchaService = new CaptchaService(service_resources);
        await captchaService.init(); // Initialize first to set up logging
        await captchaService.construct();

        // Test 1: Generate and verify captcha
        console.log('\nTest 1: Generate and verify captcha');
        const ip = '127.0.0.1';
        const { captcha_id, captcha_text } = await captchaService.generate_captcha(ip);
        console.log('Generated captcha:', { captcha_id, captcha_text });

        const isValid = await captchaService.verify_captcha(ip, captcha_id, captcha_text);
        console.log('Captcha verification result:', isValid);

        // Test 2: Rate limiting
        console.log('\nTest 2: Rate limiting');
        for (let i = 0; i < 6; i++) {
            try {
                await captchaService.generate_captcha(ip);
                console.log(`Request ${i + 1}: Success`);
            } catch (error) {
                console.log(`Request ${i + 1}: ${error.message}`);
            }
        }

        // Test 3: IP blocking
        console.log('\nTest 3: IP blocking');
        const blocked_ip = '192.168.1.1';
        await redis.set(`${service_resources.my_config.redis_prefix}blocked:${blocked_ip}`, '1');
        await redis.expire(`${service_resources.my_config.redis_prefix}blocked:${blocked_ip}`, 60);

        try {
            await captchaService.generate_captcha(blocked_ip);
        } catch (error) {
            console.log('IP blocking test result:', error.message);
        }

        console.log('\nAll tests completed');

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        // Cleanup
        await redis.quit();
    }
}

testCaptcha().catch(console.error); 