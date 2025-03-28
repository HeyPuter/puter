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
const CaptchaService = require('./services/CaptchaService');

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
        console.log('DIAGNOSTIC: CaptchaModule.install - Start of method');
        
        // Get services from context
        const services = context.get('services');
        if (!services) {
            throw new Error('Services not available in context');
        }
        
        // Register the captcha service
        console.log('DIAGNOSTIC: CaptchaModule.install - Before service registration');
        services.registerService('captcha', CaptchaService);
        console.log('DIAGNOSTIC: CaptchaModule.install - After service registration');
        
        // Log the captcha service status
        try {
            const captchaService = services.get('captcha');
            console.log(`Captcha service registered and ${captchaService.enabled ? 'enabled' : 'disabled'}`);
            console.log('TOKENS_TRACKING: Retrieved CaptchaService instance with ID:', captchaService.serviceId);
        } catch (error) {
            console.error('Failed to get captcha service after registration:', error);
        }
    }
}

module.exports = { CaptchaModule }; 