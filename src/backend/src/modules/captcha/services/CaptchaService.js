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
const { Endpoint } = require('../../../util/expressutil');
const { checkCaptcha } = require('../middleware/captcha-middleware');

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
        
        // Service instance diagnostic tracking
        this.serviceId = Math.random().toString(36).substring(2, 10);
        this.requestCounter = 0;
        
        // Get configuration from service config
        this.enabled = this.config.enabled === true;
        this.expirationTime = this.config.expirationTime || (10 * 60 * 1000); // 10 minutes default
        this.difficulty = this.config.difficulty || 'medium';
        this.testMode = this.config.testMode === true;
        
        // Add a static test token for diagnostic purposes
        this.captchaTokens.set('test-static-token', {
            text: 'testanswer',
            expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
        });
        
        // Flag to track if endpoints are registered
        this.endpointsRegistered = false;
    }

    async ['__on_install.middlewares.context-aware'] (_, { app }) {
        // Add express middleware
        app.use(checkCaptcha({ svc_captcha: this }));
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
        this.cleanupInterval = setInterval(() => this.cleanupExpiredTokens(), 15 * 60 * 1000);
        
        // Register endpoints if not already done
        if (!this.endpointsRegistered) {
            this.registerEndpoints();
            this.endpointsRegistered = true;
        }
    }

    /**
     * Cleanup method called when service is being destroyed
     */
    async _destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.captchaTokens.clear();
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
            
            const api = this.require('express').Router();
            app.use('/api/captcha', api);
            
            // Generate captcha endpoint
            Endpoint({
                route: '/generate',
                methods: ['GET'],
                handler: async (req, res) => {
                    const captcha = this.generateCaptcha();
                    res.json({
                        token: captcha.token,
                        image: captcha.data
                    });
                },
            }).attach(api);

            // Verify captcha endpoint
            Endpoint({
                route: '/verify',
                methods: ['POST'],
                handler: (req, res) => {
                    const { token, answer } = req.body;
                    
                    if (!token || !answer) {
                        return res.status(400).json({ 
                            valid: false, 
                            error: 'Missing token or answer' 
                        });
                    }
                    
                    const isValid = this.verifyCaptcha(token, answer);
                    res.json({ valid: isValid });
                },
            }).attach(api);
            
            // Special endpoint for automated testing
            // This should be disabled in production
            if (this.testMode) {
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

            // Diagnostic endpoint - should be used carefully and only during debugging
            app.get('/api/captcha/diagnostic', (req, res) => {
                try {
                    // Get information about the current state
                    const diagnosticInfo = {
                        serviceEnabled: this.enabled,
                        difficulty: this.difficulty,
                        expirationTime: this.expirationTime,
                        testMode: this.testMode,
                        activeTokenCount: this.captchaTokens.size,
                        serviceId: this.serviceId,
                        processId: process.pid,
                        requestCounter: this.requestCounter,
                        hasStaticTestToken: this.captchaTokens.has('test-static-token'),
                        tokensState: Array.from(this.captchaTokens).map(([token, data]) => ({
                            tokenPrefix: token.substring(0, 8) + '...',
                            expiresAt: new Date(data.expiresAt).toISOString(),
                            expired: data.expiresAt < Date.now(),
                            expectedAnswer: data.text
                        }))
                    };
                    
                    res.json(diagnosticInfo);
                } catch (error) {
                    this.log.error(`Error in diagnostic endpoint: ${error.message}`);
                    res.status(500).json({ error: 'Diagnostic error' });
                }
            });

            // Advanced token debugging endpoint - allows testing
            app.get('/api/captcha/debug-tokens', (req, res) => {
                try {
                    // Check if we're the same service instance
                    const currentTimestamp = Date.now();
                    const currentTokens = Array.from(this.captchaTokens.keys()).map(t => t.substring(0, 8));
                    
                    // Create a test token that won't expire soon
                    const debugToken = 'debug-' + this.crypto.randomBytes(8).toString('hex');
                    const debugAnswer = 'test123';
                    
                    this.captchaTokens.set(debugToken, {
                        text: debugAnswer,
                        expiresAt: currentTimestamp + (60 * 60 * 1000) // 1 hour
                    });
                    
                    // Information about the current service instance
                    const serviceInfo = {
                        message: 'Debug token created - use for testing captcha validation',
                        serviceId: this.serviceId,
                        debugToken: debugToken,
                        debugAnswer: debugAnswer,
                        tokensBefore: currentTokens,
                        tokensAfter: Array.from(this.captchaTokens.keys()).map(t => t.substring(0, 8)),
                        currentTokenCount: this.captchaTokens.size,
                        timestamp: currentTimestamp,
                        processId: process.pid
                    };
                    
                    res.json(serviceInfo);
                } catch (error) {
                    this.log.error(`Error in debug-tokens endpoint: ${error.message}`);
                    res.status(500).json({ error: 'Debug token creation error' });
                }
            });

            // Configuration verification endpoint
            app.get('/api/captcha/config-status', (req, res) => {
                try {
                    // Information about configuration states
                    const configInfo = {
                        serviceEnabled: this.enabled,
                        serviceDifficulty: this.difficulty,
                        configSource: 'Service configuration',
                        centralConfig: {
                            enabled: this.enabled,
                            difficulty: this.difficulty,
                            expirationTime: this.expirationTime,
                            testMode: this.testMode
                        },
                        usingCentralizedConfig: true,
                        configConsistency: this.enabled === (this.enabled === true),
                        serviceId: this.serviceId,
                        processId: process.pid
                    };
                    
                    res.json(configInfo);
                } catch (error) {
                    this.log.error(`Error in config-status endpoint: ${error.message}`);
                    res.status(500).json({ error: 'Configuration status error' });
                }
            });

            // Test endpoint to validate token lifecycle
            app.get('/api/captcha/test-lifecycle', (req, res) => {
                try {
                    // Create a test captcha
                    const testText = 'test123';
                    const testToken = 'lifecycle-' + this.crypto.randomBytes(16).toString('hex');
                    
                    // Store the test token
                    this.captchaTokens.set(testToken, {
                        text: testText,
                        expiresAt: Date.now() + this.expirationTime
                    });
                    
                    // Verify the token exists
                    const tokenExists = this.captchaTokens.has(testToken);
                    // Try to verify with correct answer
                    const correctVerification = this.verifyCaptcha(testToken, testText);
                    // Check if token was deleted after verification
                    const tokenAfterVerification = this.captchaTokens.has(testToken);
                    
                    // Create another test token
                    const testToken2 = 'lifecycle2-' + this.crypto.randomBytes(16).toString('hex');
                    
                    // Store the test token
                    this.captchaTokens.set(testToken2, {
                        text: testText,
                        expiresAt: Date.now() + this.expirationTime
                    });
                    
                    res.json({
                        message: 'Token lifecycle test completed',
                        serviceId: this.serviceId,
                        initialTokens: this.captchaTokens.size - 2, // minus the two we added
                        tokenCreated: true,
                        tokenExisted: tokenExists,
                        verificationResult: correctVerification,
                        tokenRemovedAfterVerification: !tokenAfterVerification,
                        secondTokenCreated: this.captchaTokens.has(testToken2),
                        processId: process.pid
                    });
                } catch (error) {
                    console.error('TOKENS_TRACKING: Error in test-lifecycle endpoint:', error);
                    res.status(500).json({ error: 'Test lifecycle error' });
                }
            });

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
        console.log('====== CAPTCHA GENERATION DIAGNOSTIC ======');
        console.log('TOKENS_TRACKING: generateCaptcha called. Service ID:', this.serviceId);
        console.log('TOKENS_TRACKING: Token map size before generation:', this.captchaTokens.size);
        console.log('TOKENS_TRACKING: Static test token exists:', this.captchaTokens.has('test-static-token'));
        
        // Increment request counter for diagnostics
        this.requestCounter++;
        console.log('TOKENS_TRACKING: Request counter value:', this.requestCounter);
        
        console.log('generateCaptcha called, service enabled:', this.enabled);
        
        if (!this.enabled) {
            console.log('Generation SKIPPED: Captcha service is disabled');
            throw new Error('Captcha service is disabled');
        }

        // Configure captcha options based on difficulty
        const options = this._getCaptchaOptions();
        console.log('Using captcha options for difficulty:', this.difficulty);
        
        // Generate the captcha
        const captcha = this.svgCaptcha.create(options);
        console.log('Captcha created with text:', captcha.text);
        
        // Generate a unique token
        const token = this.crypto.randomBytes(32).toString('hex');
        console.log('Generated token:', token.substring(0, 8) + '...');
        
        // Store token with captcha text and expiration
        const expirationTime = Date.now() + this.expirationTime;
        console.log('Token will expire at:', new Date(expirationTime));
        
        console.log('TOKENS_TRACKING: Token map size before storing new token:', this.captchaTokens.size);
        
        this.captchaTokens.set(token, {
            text: captcha.text.toLowerCase(),
            expiresAt: expirationTime
        });
        
        console.log('TOKENS_TRACKING: Token map size after storing new token:', this.captchaTokens.size);
        console.log('Token stored in captchaTokens. Current token count:', this.captchaTokens.size);
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
        console.log('====== CAPTCHA SERVICE VERIFICATION DIAGNOSTIC ======');
        console.log('TOKENS_TRACKING: verifyCaptcha called. Service ID:', this.serviceId);
        console.log('TOKENS_TRACKING: Request counter during verification:', this.requestCounter);
        console.log('TOKENS_TRACKING: Static test token exists:', this.captchaTokens.has('test-static-token'));
        console.log('TOKENS_TRACKING: Trying to verify token:', token ? token.substring(0, 8) + '...' : 'undefined');
        
        console.log('verifyCaptcha called with token:', token ? token.substring(0, 8) + '...' : 'undefined');
        console.log('userAnswer:', userAnswer);
        console.log('Service enabled:', this.enabled);
        console.log('Number of tokens in captchaTokens:', this.captchaTokens.size);
        
        // Service health check
        this._checkServiceHealth();
        
        if (!this.enabled) {
            console.log('Verification SKIPPED: Captcha service is disabled');
            this.log.warn('Captcha verification attempted while service is disabled');
            throw new Error('Captcha service is disabled');
        }

        // Get captcha data for token
        const captchaData = this.captchaTokens.get(token);
        console.log('Captcha data found for token:', !!captchaData);
        
        // Invalid token or expired
        if (!captchaData) {
            console.log('Verification FAILED: No data found for this token');
            console.log('TOKENS_TRACKING: Available tokens (first 8 chars):', 
                Array.from(this.captchaTokens.keys()).map(t => t.substring(0, 8)));
            this.log.debug(`Invalid captcha token: ${token}`);
            return false;
        }
        
        if (captchaData.expiresAt < Date.now()) {
            console.log('Verification FAILED: Token expired at:', new Date(captchaData.expiresAt));
            this.log.debug(`Expired captcha token: ${token}`);
            return false;
        }
        
        // Normalize and compare answers
        const normalizedUserAnswer = userAnswer.toLowerCase().trim();
        console.log('Expected answer:', captchaData.text);
        console.log('User answer (normalized):', normalizedUserAnswer);
        const isValid = captchaData.text === normalizedUserAnswer;
        console.log('Answer comparison result:', isValid);
        
        // Remove token after verification (one-time use)
        this.captchaTokens.delete(token);
        console.log('Token removed after verification (one-time use)');
        console.log('TOKENS_TRACKING: Token map size after removing used token:', this.captchaTokens.size);
        
        this.log.debug(`Verified captcha token: ${token}, valid: ${isValid}`);
        return isValid;
    }
    
    /**
     * Simple diagnostic method to check service health
     * @private
     */
    _checkServiceHealth() {
        console.log('TOKENS_TRACKING: Service health check. ID:', this.serviceId, 'Token count:', this.captchaTokens.size);
        return true;
    }

    /**
     * Removes expired captcha tokens from memory
     */
    cleanupExpiredTokens() {
        console.log('TOKENS_TRACKING: Running token cleanup. Service ID:', this.serviceId);
        console.log('TOKENS_TRACKING: Token map size before cleanup:', this.captchaTokens.size);
        
        const now = Date.now();
        let expiredCount = 0;
        let validCount = 0;
        
        // Log all tokens before cleanup
        console.log('TOKENS_TRACKING: Current tokens before cleanup:');
        for (const [token, data] of this.captchaTokens.entries()) {
            const isExpired = data.expiresAt < now;
            console.log(`TOKENS_TRACKING: Token ${token.substring(0, 8)}... expires: ${new Date(data.expiresAt).toISOString()}, expired: ${isExpired}`);
            
            if (isExpired) {
                expiredCount++;
            } else {
                validCount++;
            }
        }
        
        // Only do the actual cleanup if we found expired tokens
        if (expiredCount > 0) {
            console.log(`TOKENS_TRACKING: Found ${expiredCount} expired tokens to remove and ${validCount} valid tokens to keep`);
            
            // Clean up expired tokens
            for (const [token, data] of this.captchaTokens.entries()) {
                if (data.expiresAt < now) {
                    this.captchaTokens.delete(token);
                    console.log(`TOKENS_TRACKING: Deleted expired token: ${token.substring(0, 8)}...`);
                }
            }
        } else {
            console.log('TOKENS_TRACKING: No expired tokens found, skipping cleanup');
        }
        
        // Skip cleanup for the static test token
        if (this.captchaTokens.has('test-static-token')) {
            console.log('TOKENS_TRACKING: Static test token still exists after cleanup');
        } else {
            console.log('TOKENS_TRACKING: WARNING - Static test token was removed during cleanup');
            
            // Restore the static test token for diagnostic purposes
            this.captchaTokens.set('test-static-token', {
                text: 'testanswer',
                expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
            });
            console.log('TOKENS_TRACKING: Restored static test token');
        }
        
        console.log('TOKENS_TRACKING: Token map size after cleanup:', this.captchaTokens.size);
        
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
            // Ensure required dependencies are available
            if (!this.svgCaptcha) {
                this.log.error('Captcha service self-test failed: svg-captcha module not available');
                return false;
            }
            
            if (!this.enabled) {
                this.log.warn('Captcha service self-test failed: service is disabled');
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
            
            // Store the test captcha
            this.captchaTokens.set(testToken, {
                text: testText,
                expiresAt: Date.now() + this.expirationTime
            });
            
            // Verify the test captcha
            const correctVerification = this.verifyCaptcha(testToken, testText);
            
            // Check if verification worked and token was removed
            if (!correctVerification || this.captchaTokens.has(testToken)) {
                this.log.error('Captcha service self-test failed: verification test failed');
                return false;
            }
            
            this.log.debug('Captcha service self-test passed');
            return true;
        } catch (error) {
            this.log.error(`Captcha service self-test failed with error: ${error.message}`);
            return false;
        }
    }

    /**
     * Returns the service's diagnostic information
     * @returns {Object} Diagnostic information about the service
     */
    getDiagnosticInfo() {
        return {
            serviceId: this.serviceId,
            enabled: this.enabled,
            tokenCount: this.captchaTokens.size,
            requestCounter: this.requestCounter,
            config: {
                enabled: this.enabled,
                difficulty: this.difficulty,
                expirationTime: this.expirationTime,
                testMode: this.testMode
            },
            processId: process.pid,
            testTokenExists: this.captchaTokens.has('test-static-token')
        };
    }
}

// Export both as a named export and as a default export for compatibility
module.exports = CaptchaService;
module.exports.CaptchaService = CaptchaService; 