// METADATA // {"ai-commented":{"service":"claude"}}
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

const BaseService = require('../../../services/BaseService');

/**
 * @class CaptchaService
 * @extends BaseService
 * @description Service that provides captcha generation and verification functionality
 * to protect against automated abuse. Uses svg-captcha for generation and maintains
 * a token-based verification system with Redis for storage and rate limiting.
 */
class CaptchaService extends BaseService {
    /**
     * Initializes the captcha service with configuration and storage
     */
    async _construct() {
        // Load dependencies
        this.crypto = require('crypto');
        this.svgCaptcha = require('svg-captcha');
        
        // Get Redis service
        try {
            this.redis = this.services.get('redis');
            this.log.info('Redis service connected for captcha storage');
            this.useRedis = true;
        } catch (error) {
            this.log.warn(`Redis service not available, falling back to in-memory storage: ${error.message}`);
            // Fallback to in-memory storage if Redis is not available
            this.captchaTokens = new Map();
            this.useRedis = false;
        }
        
        // Configuration (from service registration)
        this.enabled = this.config.enabled !== undefined ? this.config.enabled : true;
        this.expirationTime = this.config.expirationTime || (10 * 60 * 1000); // 10 minutes default
        this.difficulty = this.config.difficulty || 'medium';
        
        // Rate limiting configuration
        this.rateLimit = this.config.rateLimit || {
            maxAttempts: 5,
            window: 60 * 1000, // 1 minute
            blockDuration: 10 * 60 * 1000 // 10 minutes
        };
        
        // Flag to track if endpoints are registered
        this.endpointsRegistered = false;
    }

    /**
     * Sets up API endpoints and cleanup tasks
     */
    async _init() {
        if (!this.enabled) {
            this.log.info('Captcha service is disabled');
            return;
        }

        // Set up periodic cleanup (only needed for in-memory storage)
        if (!this.useRedis) {
            setInterval(() => this.cleanupExpiredTokens(), 15 * 60 * 1000);
        }
        
        // Run a self-test to verify the service is working
        this.verifySelfTest();
        
        // Try to register endpoints immediately
        this.registerEndpoints();
        
        // If endpoints couldn't be registered, set up a listener for the web-service
        if (!this.endpointsRegistered) {
            try {
                const eventService = this.services.get('event');
                if (eventService) {
                    this.log.info('Setting up listener for web-service availability');
                    
                    // Listen for service-ready events
                    eventService.on('service-ready', (serviceName) => {
                        if (serviceName === 'web-service' || serviceName === 'web-server') {
                            this.log.info(`Web service '${serviceName}' is now available, registering captcha endpoints`);
                            this.registerEndpoints();
                        }
                    });
                    
                    // Also try again after a delay to catch services that were already initialized
                    setTimeout(() => {
                        if (!this.endpointsRegistered) {
                            this.log.info('Retrying endpoint registration after delay');
                            this.registerEndpoints();
                        }
                    }, 5000);
                }
            } catch (error) {
                this.log.warn(`Could not set up event listener: ${error.message}`);
            }
        }
    }
    
    /**
     * Registers the captcha API endpoints with the web service
     * @private
     */
    registerEndpoints() {
        if (this.endpointsRegistered) {
            return;
        }
        
        try {
            // Try to get the web service
            let webService = null;
            try {
                webService = this.services.get('web-service');
            } catch (error) {
                // Web service not available, try web-server
                try {
                    webService = this.services.get('web-server');
                } catch (innerError) {
                    this.log.warn('Neither web-service nor web-server are available yet');
                    return;
                }
            }
            
            if (!webService || !webService.app) {
                this.log.warn('Web service found but app is not available');
                return;
            }

            const app = webService.app;
            
            // Generate captcha endpoint
            app.get('/api/captcha/generate', async (req, res) => {
                try {
                    const ip = req.ip || req.connection.remoteAddress || 'unknown';
                    
                    // Check rate limit before generating
                    try {
                        await this.checkRateLimit(`generate:${ip}`);
                    } catch (error) {
                        return res.status(429).json({ 
                            error: 'Rate limit exceeded for captcha generation' 
                        });
                    }
                    
                    const captcha = await this.generateCaptcha(ip);
                    res.json({
                        token: captcha.token,
                        image: captcha.data
                    });
                } catch (error) {
                    this.log.error(`Error generating captcha: ${error.message}`);
                    res.status(500).json({ error: 'Failed to generate captcha' });
                }
            });

            // Verify captcha endpoint
            app.post('/api/captcha/verify', async (req, res) => {
                try {
                    const { token, answer } = req.body;
                    const ip = req.ip || req.connection.remoteAddress || 'unknown';
                    
                    if (!token || !answer) {
                        return res.status(400).json({ 
                            valid: false, 
                            error: 'Missing token or answer' 
                        });
                    }
                    
                    // Check rate limit before verifying
                    try {
                        await this.checkRateLimit(`verify:${ip}`);
                    } catch (error) {
                        return res.status(429).json({ 
                            valid: false,
                            error: 'Rate limit exceeded for captcha verification' 
                        });
                    }
                    
                    const isValid = await this.verifyCaptcha(token, answer, ip);
                    res.json({ valid: isValid });
                } catch (error) {
                    this.log.error(`Error verifying captcha: ${error.message}`);
                    res.status(500).json({ 
                        valid: false, 
                        error: 'Failed to verify captcha' 
                    });
                }
            });
            
            // Special endpoint for automated testing
            // This should be disabled in production
            if (process.env.NODE_ENV !== 'production') {
                app.post('/api/captcha/create-test-token', async (req, res) => {
                    try {
                        const { token, answer } = req.body;
                        
                        if (!token || !answer) {
                            return res.status(400).json({ 
                                error: 'Missing token or answer' 
                            });
                        }
                        
                        // Store the test token with the provided answer
                        if (this.useRedis) {
                            const captchaKey = `captcha:token:${token}`;
                            await this.redis.set(captchaKey, answer.toLowerCase(), this.expirationTime);
                        } else {
                            this.captchaTokens.set(token, {
                                text: answer.toLowerCase(),
                                expiresAt: Date.now() + this.expirationTime
                            });
                        }
                        
                        this.log.debug(`Created test token: ${token} with answer: ${answer}`);
                        res.json({ success: true });
                    } catch (error) {
                        this.log.error(`Error creating test token: ${error.message}`);
                        res.status(500).json({ error: 'Failed to create test token' });
                    }
                });
            }

            this.endpointsRegistered = true;
            this.log.info('Captcha service endpoints registered successfully');
            
            // Emit an event that captcha service is ready
            try {
                const eventService = this.services.get('event');
                if (eventService) {
                    eventService.emit('service-ready', 'captcha');
                }
            } catch (error) {
                // Ignore errors with event service
            }
        } catch (error) {
            this.log.warn(`Could not register captcha endpoints: ${error.message}`);
        }
    }

    /**
     * Checks if an operation is within rate limits
     * @param {string} operation - The operation identifier (e.g., 'generate:127.0.0.1')
     * @returns {Promise<boolean>} - True if within limits, throws error if exceeded
     */
    async checkRateLimit(operation) {
        const key = `captcha:ratelimit:${operation}`;
        
        if (this.useRedis) {
            try {
                // Get current count
                const count = await this.redis.incr(key);
                
                // Set expiration if this is the first increment
                if (count === 1) {
                    await this.redis.expire(key, Math.floor(this.rateLimit.window / 1000));
                }
                
                // Check if limit exceeded
                if (count > this.rateLimit.maxAttempts) {
                    // Set a block if needed
                    const ip = operation.split(':')[1];
                    if (ip) {
                        const blockKey = `captcha:blocked:${ip}`;
                        await this.redis.set(blockKey, '1', this.rateLimit.blockDuration);
                    }
                    throw new Error('Rate limit exceeded');
                }
                
                return true;
            } catch (error) {
                if (error.message === 'Rate limit exceeded') {
                    throw error;
                }
                this.log.error(`Redis rate limit error: ${error.message}`);
                // Fallback to allowing the operation if Redis fails
                return true;
            }
        } else {
            // Simple in-memory rate limiting (not persistent across restarts)
            // In a real implementation, you'd want to use a more sophisticated approach
            const now = Date.now();
            const rateLimitKey = `${operation}:${Math.floor(now / this.rateLimit.window)}`;
            
            // Initialize counter if needed
            if (!this.captchaTokens.has(rateLimitKey)) {
                this.captchaTokens.set(rateLimitKey, { count: 0, expires: now + this.rateLimit.window });
            }
            
            const limitData = this.captchaTokens.get(rateLimitKey);
            
            // Check if expired
            if (limitData.expires < now) {
                this.captchaTokens.delete(rateLimitKey);
                this.captchaTokens.set(rateLimitKey, { count: 1, expires: now + this.rateLimit.window });
                return true;
            }
            
            // Increment and check
            limitData.count++;
            if (limitData.count > this.rateLimit.maxAttempts) {
                throw new Error('Rate limit exceeded');
            }
            
            return true;
        }
    }

    /**
     * Generates a new captcha with a unique token
     * @param {string} ip - The IP address of the requester (for rate limiting)
     * @returns {Promise<Object>} Object containing token and SVG image
     */
    async generateCaptcha(ip = 'unknown') {
        if (!this.enabled) {
            throw new Error('Captcha service is disabled');
        }

        // Configure captcha options based on difficulty
        const options = this._getCaptchaOptions();
        
        // Generate the captcha
        const captcha = this.svgCaptcha.create(options);
        
        // Generate a unique token
        const token = this.crypto.randomBytes(32).toString('hex');
        
        // Store token with captcha text and expiration
        if (this.useRedis) {
            try {
                const captchaKey = `captcha:token:${token}`;
                await this.redis.set(captchaKey, captcha.text.toLowerCase(), this.expirationTime);
            } catch (error) {
                this.log.error(`Redis error storing captcha: ${error.message}`);
                // Fallback to in-memory if Redis fails
                this.captchaTokens.set(token, {
                    text: captcha.text.toLowerCase(),
                    expiresAt: Date.now() + this.expirationTime
                });
            }
        } else {
            this.captchaTokens.set(token, {
                text: captcha.text.toLowerCase(),
                expiresAt: Date.now() + this.expirationTime
            });
        }
        
        this.log.debug(`Generated captcha with token: ${token}`);
        
        return {
            token: token,
            data: captcha.data
        };
    }

    /**
     * Verifies a captcha answer against a stored token
     * @param {string} token - The captcha token
     * @param {string} userAnswer - The user's answer to verify
     * @param {string} ip - The IP address of the requester (for rate limiting)
     * @returns {Promise<boolean>} Whether the answer is valid
     */
    async verifyCaptcha(token, userAnswer, ip = 'unknown') {
        if (!this.enabled) {
            this.log.warn('Captcha verification attempted while service is disabled');
            throw new Error('Captcha service is disabled');
        }

        // Check if IP is blocked
        if (this.useRedis) {
            try {
                const blockKey = `captcha:blocked:${ip}`;
                const isBlocked = await this.redis.exists(blockKey);
                if (isBlocked) {
                    this.log.warn(`Blocked IP ${ip} attempted captcha verification`);
                    throw new Error('IP is blocked due to too many failed attempts');
                }
            } catch (error) {suc
                if (error.message === 'IP is blocked due to too many failed attempts') {
                    throw error;
                }
                // If Redis fails, continue with verification
                this.log.error(`Redis error checking blocked status: ${error.message}`);
            }
        }

        let captchaText = null;
        let isValid = false;
        
        // Get captcha data for token
        if (this.useRedis) {
            try {
                const captchaKey = `captcha:token:${token}`;
                captchaText = await this.redis.get(captchaKey);
                
                // Delete the token (one-time use)
                if (captchaText) {
                    await this.redis.del(captchaKey);
                }
            } catch (error) {
                this.log.error(`Redis error retrieving captcha: ${error.message}`);
                // Fallback to in-memory if Redis fails
                const captchaData = this.captchaTokens.get(token);
                if (captchaData && captchaData.expiresAt >= Date.now()) {
                    captchaText = captchaData.text;
                    this.captchaTokens.delete(token);
                }
            }
        } else {
            const captchaData = this.captchaTokens.get(token);
            if (captchaData && captchaData.expiresAt >= Date.now()) {
                captchaText = captchaData.text;
                this.captchaTokens.delete(token);
            }
        }
        
        // Invalid token or expired
        if (!captchaText) {
            this.log.debug(`Invalid or expired captcha token: ${token}`);
            return false;
        }
        
        // Normalize and compare answers
        const normalizedUserAnswer = userAnswer.toLowerCase().trim();
        isValid = captchaText === normalizedUserAnswer;
        
        // Track failed verification attempts
        if (!isValid && this.useRedis) {
            try {
                const failKey = `captcha:failed:${ip}`;
                await this.redis.incr(failKey);
                await this.redis.expire(failKey, Math.floor(this.rateLimit.window / 1000));
                
                // Check if we should block this IP
                const failCount = await this.redis.get(failKey);
                if (failCount && parseInt(failCount) >= this.rateLimit.maxAttempts) {
                    const blockKey = `captcha:blocked:${ip}`;
                    await this.redis.set(blockKey, '1', this.rateLimit.blockDuration);
                    this.log.warn(`IP ${ip} blocked due to too many failed captcha attempts`);
                }
            } catch (error) {
                this.log.error(`Redis error tracking failed attempts: ${error.message}`);
            }
        }
        
        this.log.debug(`Verified captcha token: ${token}, valid: ${isValid}`);
        return isValid;
    }

    /**
     * Removes expired captcha tokens from memory
     * Only used for in-memory storage, Redis handles expiration automatically
     */
    cleanupExpiredTokens() {
        if (this.useRedis) {
            return; // Redis handles expiration automatically
        }
        
        const now = Date.now();
        let expiredCount = 0;
        
        for (const [token, data] of this.captchaTokens.entries()) {
            if (data.expiresAt && data.expiresAt < now) {
                this.captchaTokens.delete(token);
                expiredCount++;
            }
        }
        
        if (expiredCount > 0) {
            this.log.debug(`Cleaned up ${expiredCount} expired captcha tokens`);
        }
    }

    /**
     * Gets captcha options based on the configured difficulty
     * @private
     * @returns {Object} Captcha configuration options
     */
    _getCaptchaOptions() {
        const baseOptions = {
            size: 6, // Default captcha length
            ignoreChars: '0o1ilI', // Characters to avoid (confusing)
            noise: 2, // Lines to add as noise
            color: true,
            background: '#f0f0f0'
        };
        
        switch (this.difficulty) {
            case 'easy':
                return {
                    ...baseOptions,
                    size: 4,
                    width: 150,
                    height: 50,
                    noise: 1
                };
            case 'hard':
                return {
                    ...baseOptions,
                    size: 7,
                    width: 200,
                    height: 60,
                    noise: 3
                };
            case 'medium':
            default:
                return {
                    ...baseOptions,
                    width: 180,
                    height: 50
                };
        }
    }

    /**
     * Verifies that the captcha service is properly configured and working
     * This is used during initialization and can be called to check system status
     * @returns {Promise<boolean>} Whether the service is properly configured and functioning
     */
    async verifySelfTest() {
        try {
            if (!this.enabled) {
                this.log.warn('Captcha service self-test failed: service is disabled');
                return false;
            }
            
            // Ensure required dependencies are available
            if (!this.svgCaptcha) {
                this.log.error('Captcha service self-test failed: svg-captcha module not available');
                return false;
            }
            
            // Validate configuration
            if (!this.expirationTime || typeof this.expirationTime !== 'number') {
                this.log.error('Captcha service self-test failed: invalid expiration time configuration');
                return false;
            }
            
            // Basic functionality test - generate a test captcha and verify storage
            const testToken = 'test-' + this.crypto.randomBytes(8).toString('hex');
            const testText = 'testcaptcha';
            
            // Store a test token
            if (this.useRedis) {
                try {
                    const captchaKey = `captcha:token:${testToken}`;
                    await this.redis.set(captchaKey, testText, this.expirationTime);
                    
                    // Verify test token exists in storage
                    const storedText = await this.redis.get(captchaKey);
                    if (!storedText || storedText !== testText) {
                        this.log.error('Captcha service self-test failed: Redis token storage test failed');
                        return false;
                    }
                    
                    // Clean up the test token
                    await this.redis.del(captchaKey);
                } catch (error) {
                    this.log.error(`Captcha service self-test failed with Redis error: ${error.message}`);
                    this.log.warn('Falling back to in-memory storage for self-test');
                    
                    // Fallback to in-memory test
                    this.captchaTokens.set(testToken, {
                        text: testText,
                        expiresAt: Date.now() + this.expirationTime
                    });
                    
                    // Verify test token exists in storage
                    const storedToken = this.captchaTokens.get(testToken);
                    if (!storedToken || storedToken.text !== testText) {
                        this.log.error('Captcha service self-test failed: in-memory token storage test failed');
                        return false;
                    }
                    
                    // Clean up the test token
                    this.captchaTokens.delete(testToken);
                }
            } else {
                // In-memory storage test
                this.captchaTokens.set(testToken, {
                    text: testText,
                    expiresAt: Date.now() + this.expirationTime
                });
                
                // Verify test token exists in storage
                const storedToken = this.captchaTokens.get(testToken);
                if (!storedToken || storedToken.text !== testText) {
                    this.log.error('Captcha service self-test failed: token storage test failed');
                    return false;
                }
                
                // Clean up the test token
                this.captchaTokens.delete(testToken);
            }
            
            this.log.info(`Captcha service self-test passed: service is enabled and functioning with ${this.useRedis ? 'Redis' : 'in-memory'} storage`);
            return true;
        } catch (error) {
            this.log.error(`Captcha service self-test failed with error: ${error.message}`);
            return false;
        }
    }
}

module.exports = { CaptchaService }; 