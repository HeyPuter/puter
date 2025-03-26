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
 * a token-based verification system.
 */
class CaptchaService extends BaseService {
    /**
     * Initializes the captcha service with configuration and storage
     */
    async _construct() {
        // Load dependencies
        this.crypto = require('crypto');
        this.svgCaptcha = require('svg-captcha');
        
        // In-memory token storage with expiration
        this.captchaTokens = new Map();
        
        // Extra debug logging
        console.log('CAPTCHA DEBUG: config is', JSON.stringify(this.config));
        console.log('CAPTCHA DEBUG: config.enabled type is', typeof this.config.enabled);
        console.log('CAPTCHA DEBUG: config.enabled value is', this.config.enabled);
        console.log('CAPTCHA DEBUG: config.enabled === true is', this.config.enabled === true);
        
        // Configuration (from service registration)
        this.enabled = this.config.enabled === true; // Only enable if explicitly true
        console.log('CAPTCHA DIAGNOSTIC: CaptchaService initialized with enabled =', this.enabled, 'from config.enabled =', this.config.enabled);
        
        this.expirationTime = this.config.expirationTime || (10 * 60 * 1000); // 10 minutes default
        this.difficulty = this.config.difficulty || 'medium';
        
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

        // Set up periodic cleanup
        setInterval(() => this.cleanupExpiredTokens(), 15 * 60 * 1000);
        
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
            app.get('/api/captcha/generate', (req, res) => {
                try {
                    const captcha = this.generateCaptcha();
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
            app.post('/api/captcha/verify', (req, res) => {
                try {
                    const { token, answer } = req.body;
                    
                    if (!token || !answer) {
                        return res.status(400).json({ 
                            valid: false, 
                            error: 'Missing token or answer' 
                        });
                    }
                    
                    const isValid = this.verifyCaptcha(token, answer);
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
                app.post('/api/captcha/create-test-token', (req, res) => {
                    try {
                        const { token, answer } = req.body;
                        
                        if (!token || !answer) {
                            return res.status(400).json({ 
                                error: 'Missing token or answer' 
                            });
                        }
                        
                        // Store the test token with the provided answer
                        this.captchaTokens.set(token, {
                            text: answer.toLowerCase(),
                            expiresAt: Date.now() + this.expirationTime
                        });
                        
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
     * Generates a new captcha with a unique token
     * @returns {Object} Object containing token and SVG image
     */
    generateCaptcha() {
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
        this.captchaTokens.set(token, {
            text: captcha.text.toLowerCase(),
            expiresAt: Date.now() + this.expirationTime
        });
        
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
     * @returns {boolean} Whether the answer is valid
     */
    verifyCaptcha(token, userAnswer) {
        if (!this.enabled) {
            this.log.warn('Captcha verification attempted while service is disabled');
            throw new Error('Captcha service is disabled');
        }

        // Get captcha data for token
        const captchaData = this.captchaTokens.get(token);
        
        // Invalid token or expired
        if (!captchaData || captchaData.expiresAt < Date.now()) {
            this.log.debug(`Invalid or expired captcha token: ${token}`);
            return false;
        }
        
        // Normalize and compare answers
        const normalizedUserAnswer = userAnswer.toLowerCase().trim();
        const isValid = captchaData.text === normalizedUserAnswer;
        
        // Remove token after verification (one-time use)
        this.captchaTokens.delete(token);
        
        this.log.debug(`Verified captcha token: ${token}, valid: ${isValid}`);
        return isValid;
    }

    /**
     * Removes expired captcha tokens from memory
     */
    cleanupExpiredTokens() {
        const now = Date.now();
        let expiredCount = 0;
        
        for (const [token, data] of this.captchaTokens.entries()) {
            if (data.expiresAt < now) {
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
     * @returns {boolean} Whether the service is properly configured and functioning
     */
    verifySelfTest() {
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
            
            this.log.info('Captcha service self-test passed: service is enabled and functioning');
            return true;
        } catch (error) {
            this.log.error(`Captcha service self-test failed with error: ${error.message}`);
            return false;
        }
    }
}

module.exports = { CaptchaService }; 