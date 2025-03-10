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

const { AdvancedBase } = require("@heyputer/putility");

/**
 * @class CaptchaModule
 * @extends AdvancedBase
 * @description Module that provides captcha verification functionality to protect
 * against automated abuse, particularly for login and signup flows. Registers
 * a CaptchaService for generating and verifying captchas as well as a middleware
 * that can be used to protect routes.
 */
class CaptchaModule extends AdvancedBase {
    async install(context) {
        const services = context.get('services');
        
        const { CaptchaService } = require('./services/CaptchaService');
        
        // Get configuration from environment or use defaults
        const captchaEnabled = process.env.CAPTCHA_ENABLED !== 'false'; // Enabled by default
        const captchaExpirationTime = parseInt(process.env.CAPTCHA_EXPIRATION_TIME) || 10 * 60 * 1000; // 10 minutes
        const captchaDifficulty = process.env.CAPTCHA_DIFFICULTY || 'medium';
        
        // Register the captcha service
        services.registerService('captcha', CaptchaService, {
            // Configuration with environment variables support
            enabled: captchaEnabled,
            expirationTime: captchaExpirationTime,
            difficulty: captchaDifficulty
        });
        
        // Log the captcha service status
        try {
            const captchaService = services.get('captcha');
            console.log(`Captcha service registered and ${captchaService.enabled ? 'enabled' : 'disabled'}`);
            
            // Add event listener to confirm when the service is fully initialized
            const eventService = services.get('event');
            if (eventService) {
                eventService.on('service-ready', (serviceName) => {
                    if (serviceName === 'captcha') {
                        console.log('Captcha service initialization complete');
                    }
                });
            }
        } catch (error) {
            console.error('Error accessing captcha service after registration:', error);
        }
        
        // Register captcha middleware
        const captchaMiddleware = require('./middleware/captcha-middleware');
        context.set('captcha-middleware', captchaMiddleware);
        
        console.log('Captcha module installed with middleware');
    }
}

module.exports = { CaptchaModule }; 