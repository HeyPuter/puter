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
 * @param {string} [options.eventType='default'] - Type of event for extensions (e.g., 'login', 'signup')
 * @returns {Function} Express middleware function
 */
const requireCaptcha = (options = {}) => async (req, res, next) => {
    // Default to strict mode for security
    const strictMode = options.strictMode !== false;
    const eventType = options.eventType || 'default';
    
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
                    status: 503
                }));
            }
            return next();
        }
        
        let captchaService;
        let eventService;
        
        try {
            captchaService = services.get('captcha');
            eventService = services.get('event');
        } catch (error) {
            console.warn('Captcha middleware: required service not available', error);
            if (strictMode) {
                return next(APIError.create('internal_error', null, {
                    message: 'Captcha service unavailable',
                    status: 503
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
        
        // Prepare context information for the event
        const requester = req.requester || {};
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';
        
        // Default to requiring captcha based on options or requester flag
        let shouldRequireCaptcha = options.always || requester.requireCaptcha || false;
        
        // If event service is available, emit an event to allow extensions to control captcha requirement
        if (eventService) {
            try {
                // Create event object with context information
                const event = {
                    require: shouldRequireCaptcha, // Default based on current logic
                    type: eventType,               // Type of operation (login, signup, etc.)
                    ip,                            // Client IP address
                    userAgent,                     // Client user agent
                    requester,                     // Requester object if available
                    req                            // Full request object for additional context
                };
                
                // Emit event and allow extensions to modify the 'require' property
                await eventService.emit('captcha.validate', event);
                
                // Update requirement based on extension feedback
                shouldRequireCaptcha = event.require;
                
                console.info(`Captcha middleware: Event emitted for ${eventType}, require captcha: ${shouldRequireCaptcha}`);
            } catch (eventError) {
                console.error('Captcha middleware: Error emitting event:', eventError);
                // In strict mode, default to requiring captcha on event error
                if (strictMode) {
                    shouldRequireCaptcha = true;
                }
            }
        }
        
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