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
const config = require("../../config");

/**
 * @class CaptchaModule
 * @extends AdvancedBase
 * @description Module that provides captcha verification functionality to protect
 * against automated abuse, particularly for login and signup flows. Registers
 * a CaptchaService for generating and verifying captchas as well as middlewares
 * that can be used to protect routes and determine captcha requirements.
 */
class CaptchaModule extends AdvancedBase {
    async install(context) {
        const services = context.get('services');
        
        const { CaptchaService } = require('./services/CaptchaService');
        
        // Get configuration from config system with fallbacks
        console.log('CAPTCHA DEBUG: config.captcha is', JSON.stringify(config.captcha));
        console.log('CAPTCHA DEBUG: config.captcha?.enabled type is', typeof config.captcha?.enabled);
        console.log('CAPTCHA DEBUG: config.captcha?.enabled value is', config.captcha?.enabled);
        console.log('CAPTCHA DEBUG: config.captcha?.enabled === true is', config.captcha?.enabled === true);
        
        const captchaEnabled = config.captcha?.enabled === true; // Only enabled if explicitly true
        const captchaExpirationTime = config.captcha?.expirationTime || 10 * 60 * 1000; // 10 minutes
        const captchaDifficulty = config.captcha?.difficulty || 'medium';
        
        console.log('CAPTCHA DIAGNOSTIC: CaptchaModule installing with config.captcha =', JSON.stringify(config.captcha));
        console.log('CAPTCHA DIAGNOSTIC: captchaEnabled =', captchaEnabled);
        console.log('CAPTCHA DIAGNOSTIC: Environment NODE_ENV =', process.env.NODE_ENV);
        
        // Register the captcha service
        services.registerService('captcha', CaptchaService, {
            // Configuration from config system
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
        
        // Register the captcha middlewares in the context
        // This allows them to be accessed by name rather than requiring the file directly
        const captchaMiddleware = require('./middleware/captcha-middleware');
        context.set('captcha-middleware', captchaMiddleware);
        
        // Also register individual middlewares for explicit access
        context.set('check-captcha-middleware', captchaMiddleware.checkCaptcha);
        context.set('require-captcha-middleware', captchaMiddleware.requireCaptcha);
        
        console.log('Captcha module installed with check and require middlewares');
    }
}

module.exports = { CaptchaModule }; 