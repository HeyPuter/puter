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
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Context and services
const Context = {
    get: vi.fn(),
};

// Mock the extension service
class ExtensionService {
    constructor () {
        this.extensions = new Map();
        this.eventHandlers = new Map();
    }

    registerExtension (name, extension) {
        this.extensions.set(name, extension);
    }

    on (event, handler) {
        if ( ! this.eventHandlers.has(event) ) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    async emit (event, data) {
        const handlers = this.eventHandlers.get(event) || [];
        for ( const handler of handlers ) {
            await handler(data);
        }
    }
}

describe('Extension Integration with Captcha', () => {
    let extensionService, captchaService, services;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Create fresh instances
        extensionService = new ExtensionService();
        captchaService = {
            enabled: true,
            verifyCaptcha: vi.fn(),
        };

        services = {
            get: vi.fn(),
        };

        // Configure service mocks
        services.get.mockImplementation((serviceName) => {
            if ( serviceName === 'extension' ) return extensionService;
            if ( serviceName === 'captcha' ) return captchaService;
        });

        // Configure Context mock
        Context.get.mockImplementation((key) => {
            if ( key === 'services' ) return services;
        });
    });

    describe('Extension Event Handling', () => {
        it('should allow extensions to require captcha via event handler', async () => {
            // Setup - create a test extension that requires captcha
            const testExtension = {
                name: 'test-extension',
                onCaptchaValidate: async (event) => {
                    if ( event.type === 'login' && event.ip === '1.2.3.4' ) {
                        event.require = true;
                    }
                },
            };

            // Register extension and event handler
            extensionService.registerExtension(testExtension.name, testExtension);
            extensionService.on('captcha.validate', testExtension.onCaptchaValidate);

            // Test event emission
            const eventData = {
                type: 'login',
                ip: '1.2.3.4',
                require: false,
            };

            await extensionService.emit('captcha.validate', eventData);

            // Assert
            expect(eventData.require).toBe(true);
        });

        it('should allow extensions to disable captcha requirement', async () => {
            // Setup - create a test extension that disables captcha
            const testExtension = {
                name: 'test-extension',
                onCaptchaValidate: async (event) => {
                    if ( event.type === 'login' && event.ip === 'trusted-ip' ) {
                        event.require = false;
                    }
                },
            };

            // Register extension and event handler
            extensionService.registerExtension(testExtension.name, testExtension);
            extensionService.on('captcha.validate', testExtension.onCaptchaValidate);

            // Test event emission
            const eventData = {
                type: 'login',
                ip: 'trusted-ip',
                require: true,
            };

            await extensionService.emit('captcha.validate', eventData);

            // Assert
            expect(eventData.require).toBe(false);
        });

        it('should handle multiple extensions modifying captcha requirement', async () => {
            // Setup - create two test extensions with different rules
            const extension1 = {
                name: 'extension-1',
                onCaptchaValidate: async (event) => {
                    if ( event.type === 'login' ) {
                        event.require = true;
                    }
                },
            };

            const extension2 = {
                name: 'extension-2',
                onCaptchaValidate: async (event) => {
                    if ( event.ip === 'trusted-ip' ) {
                        event.require = false;
                    }
                },
            };

            // Register extensions and event handlers
            extensionService.registerExtension(extension1.name, extension1);
            extensionService.registerExtension(extension2.name, extension2);
            extensionService.on('captcha.validate', extension1.onCaptchaValidate);
            extensionService.on('captcha.validate', extension2.onCaptchaValidate);

            // Test event emission - extension2 should override extension1
            const eventData = {
                type: 'login',
                ip: 'trusted-ip',
                require: false,
            };

            await extensionService.emit('captcha.validate', eventData);

            // Assert
            expect(eventData.require).toBe(false);
        });

        // TODO: Why was this behavior changed?
        // it('should handle extension errors gracefully', async () => {
        //     // Setup - create a test extension that throws an error
        //     const testExtension = {
        //         name: 'test-extension',
        //         onCaptchaValidate: async () => {
        //             throw new Error('Extension error');
        //         }
        //     };

        //     // Register extension and event handler
        //     extensionService.registerExtension(testExtension.name, testExtension);
        //     extensionService.on('captcha.validate', testExtension.onCaptchaValidate);

        //     // Test event emission
        //     const eventData = {
        //         type: 'login',
        //         ip: '1.2.3.4',
        //         require: false
        //     };

        //     // The emit should not throw
        //     await extensionService.emit('captcha.validate', eventData);

        //     // Assert - the original value should be preserved
        //     expect(eventData.require).toBe(false);
        // });
    });

    describe('Backward Compatibility', () => {
        it('should maintain backward compatibility with older extension APIs', async () => {
            // Setup - create a test extension using the old API format
            const legacyExtension = {
                name: 'legacy-extension',
                handleCaptcha: async (event) => {
                    event.require = true;
                },
            };

            // Register legacy extension with old event name
            extensionService.registerExtension(legacyExtension.name, legacyExtension);
            extensionService.on('captcha.check', legacyExtension.handleCaptcha);

            // Test both old and new event names
            const eventData = {
                type: 'login',
                ip: '1.2.3.4',
                require: false,
            };

            // Should work with both old and new event names
            await extensionService.emit('captcha.check', eventData);
            await extensionService.emit('captcha.validate', eventData);

            // Assert - the requirement should be set by the legacy extension
            expect(eventData.require).toBe(true);
        });

        it('should support legacy extension configuration formats', async () => {
            // Setup - create a test extension with legacy configuration
            const legacyExtension = {
                name: 'legacy-extension',
                config: {
                    captcha: {
                        always: true,
                        types: ['login', 'signup'],
                    },
                },
                onCaptchaValidate: async (event) => {
                    if ( legacyExtension.config.captcha.types.includes(event.type) ) {
                        event.require = legacyExtension.config.captcha.always;
                    }
                },
            };

            // Register extension and event handler
            extensionService.registerExtension(legacyExtension.name, legacyExtension);
            extensionService.on('captcha.validate', legacyExtension.onCaptchaValidate);

            // Test event emission
            const eventData = {
                type: 'login',
                ip: '1.2.3.4',
                require: false,
            };

            await extensionService.emit('captcha.validate', eventData);

            // Assert
            expect(eventData.require).toBe(true);
        });
    });
});