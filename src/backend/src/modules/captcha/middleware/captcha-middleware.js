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

const APIError = require("../../../api/APIError");
const { Context } = require("../../../util/context");

/**
 * Middleware that requires captcha verification
 * Can be used in two modes: always require or conditionally require
 * 
 * @param {Object} options - Configuration options
 * @param {boolean} [options.always=false] - Always require captcha regardless of rate limits
 * @param {boolean} [options.strictMode=true] - If true, fails closed on errors (more secure)
 * @returns {Function} Express middleware function
 */
const requireCaptcha = (options = {}) => async (req, res, next) => {
    // Default to strict mode for security
    const strictMode = options.strictMode !== false;
    
    try {
        // Get services from the Context instead of req.app
        const services = Context.get('services');
        
        // Fail closed if services aren't available (in strict mode)
        if (!services) {
            console.warn('Captcha middleware: services not available in Context');
            if (strictMode) {
                // Use next(error) instead of throwing directly
                return next(APIError.create('internal_error', null, {
                    message: 'Captcha service unavailable',
                    status: 500
                }));
            }
            return next();
        }
        
        let captchaService;
        try {
            captchaService = services.get('captcha');
        } catch (error) {
            console.warn('Captcha middleware: captcha service not available', error);
            if (strictMode) {
                return next(APIError.create('internal_error', null, {
                    message: 'Captcha service unavailable',
                    status: 500
                }));
            }
            return next();
        }
        
        // Check if captcha service is explicitly disabled (this is different from errors)
        // Only proceed if the service is intentionally disabled by configuration
        if (captchaService && captchaService.enabled === false) {
            console.info('Captcha middleware: service is explicitly disabled by configuration');
            
            // For debugging - check environment variables to confirm it's intentionally disabled
            const explicitlyDisabled = process.env.CAPTCHA_ENABLED === 'false';
            
            if (explicitlyDisabled) {
                console.info('Captcha middleware: CAPTCHA_ENABLED=false in environment');
            } else {
                console.warn('Captcha middleware: service disabled but not via CAPTCHA_ENABLED environment variable');
            }
            
            // In strict mode, only allow bypass if explicitly disabled by environment
            if (strictMode && !explicitlyDisabled) {
                console.warn('Captcha middleware: blocking request because service is disabled but not explicitly via environment variable');
                return next(APIError.create('captcha_required', null, {
                    message: 'Captcha verification required but service is misconfigured',
                    status: 500
                }));
            }
            
            return next();
        }
        
        // Fail closed if captcha service doesn't exist or isn't properly initialized
        if (!captchaService || typeof captchaService.verifyCaptcha !== 'function') {
            console.error('Captcha middleware: invalid captcha service');
            return next(APIError.create('internal_error', null, {
                message: 'Captcha service misconfigured',
                status: 500
            }));
        }
        
        // Check for conditional captcha (based on rate limits, etc.)
        const requester = req.requester || {};
        const shouldRequireCaptcha = options.always || 
                                   requester.requireCaptcha || 
                                   false;
        
        if (!shouldRequireCaptcha) {
            console.info('Captcha middleware: not required for this request');
            return next();
        }

        console.info('Captcha middleware: verification required for this request');
        
        // Check for captcha token and answer in request
        const captchaToken = req.body.captchaToken;
        const captchaAnswer = req.body.captchaAnswer;

        if (!captchaToken || !captchaAnswer) {
            console.info('Captcha middleware: missing token or answer');
            return next(APIError.create('captcha_required', null, {
                message: 'Captcha verification required',
                status: 400
            }));
        }

        console.info(`Captcha middleware: verifying token ${captchaToken.substring(0, 8)}...`);
        
        // Verify the captcha
        let isValid;
        try {
            isValid = captchaService.verifyCaptcha(captchaToken, captchaAnswer);
        } catch (verifyError) {
            console.error('Captcha middleware: verification threw an error', verifyError);
            return next(APIError.create('captcha_invalid', null, {
                message: 'Captcha verification failed',
                status: 400
            }));
        }
        
        // Check verification result
        if (!isValid) {
            console.info('Captcha middleware: invalid captcha answer');
            return next(APIError.create('captcha_invalid', null, {
                message: 'Invalid captcha response',
                status: 400
            }));
        }

        console.info('Captcha middleware: verification successful');
        // Captcha verified successfully, continue
        next();
    } catch (error) {
        // Don't swallow errors - forward all errors to error handler
        console.error('Captcha middleware error:', error);
        
        // If it's already an APIError, just forward it
        if (error.name === 'APIError') {
            return next(error);
        }
        
        // Convert other errors to APIError and block the request
        return next(APIError.create('captcha_error', null, {
            message: 'Captcha verification failed: ' + (error.message || 'Unknown error'),
            status: 400
        }));
    }
};

module.exports = requireCaptcha; 