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

const { Context } = require("../util/context");
const config = require("../config");
const { eggspress } = require("../util/expressutil");

/**
 * The /whoarewe endpoint provides environment information to the frontend
 * before authentication, including whether certain operations will require
 * captcha verification.
 *
 * This allows the frontend to know in advance whether to display captcha
 * elements without needing to make a request and get a rejection first.
 */
const WHOAREWE_GET = eggspress('/whoarewe', {
    subdomain: 'api',
    // No auth required - this endpoint is public
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    try {
        // Get services from context
        const services = Context.get('services');
        
        // Prepare response data
        const envInfo = {
            captchaRequired: {},
            environmentInfo: {
                env: config.env,
                version: process.env.VERSION || 'development'
            }
        };
        
        // Check if captcha will be required for login
        const captchaMiddleware = Context.get('check-captcha-middleware');
        
        if (captchaMiddleware) {
            // Create a mock request to check login captcha requirement
            const mockReq = {
                ip: req.ip,
                headers: req.headers,
                connection: req.connection
            };
            
            // Use the middleware to check if login requires captcha
            await new Promise(resolve => {
                captchaMiddleware({ eventType: 'login' })(mockReq, {}, resolve);
            });
            
            // Store the result
            envInfo.captchaRequired.login = mockReq.captchaRequired || false;
            
            // Check signup captcha requirement
            const signupReq = {
                ip: req.ip,
                headers: req.headers,
                connection: req.connection
            };
            
            await new Promise(resolve => {
                captchaMiddleware({ eventType: 'signup' })(signupReq, {}, resolve);
            });
            
            envInfo.captchaRequired.signup = signupReq.captchaRequired || false;
        } else {
            // If middleware isn't available, assume captcha is required (fail closed)
            envInfo.captchaRequired.login = true;
            envInfo.captchaRequired.signup = true;
        }
        
        // Add feature flags if available
        try {
            const featureFlagService = services.get('featureflag');
            if (featureFlagService) {
                envInfo.featureFlags = featureFlagService.getPublicFlags();
            }
        } catch (error) {
            console.warn('Error getting feature flags for /whoarewe:', error);
        }
        
        // Send the environment information
        res.send(envInfo);
    } catch (error) {
        console.error('Error in /whoarewe endpoint:', error);
        // Don't expose error details to the client
        res.status(500).send({
            error: 'server_error',
            message: 'Failed to retrieve environment information'
        });
    }
});

module.exports = app => {
    app.use(WHOAREWE_GET);
}; 