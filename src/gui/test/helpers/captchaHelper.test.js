/**
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

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';

// Mock the fetch API and global window object for testing
global.window = {
    api_origin: 'https://test-api.puter.com',
    gui_params: {}
};
global.fetch = sinon.stub();
global.console = {
    log: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub()
};

// Import the module under test
import { isCaptchaRequired, invalidateCaptchaRequirementsCache } from '../../src/helpers/captchaHelper.js';

describe('captchaHelper', () => {
    let fetchStub;
    
    beforeEach(() => {
        // Reset stubs before each test
        fetchStub = global.fetch;
        fetchStub.reset();
        
        // Reset the window object
        global.window.gui_params = {};
    });
    
    afterEach(() => {
        // Reset any cached data between tests
        invalidateCaptchaRequirementsCache();
    });
    
    describe('isCaptchaRequired', () => {
        it('should use GUI parameters if available', async () => {
            // Setup
            global.window.gui_params = {
                captchaRequired: {
                    login: true,
                    signup: false
                }
            };
            
            // Test
            const loginRequired = await isCaptchaRequired('login');
            const signupRequired = await isCaptchaRequired('signup');
            
            // Assert
            expect(loginRequired).to.be.true;
            expect(signupRequired).to.be.false;
            expect(fetchStub.called).to.be.false; // Fetch should not be called
        });
        
        it('should fetch from API if GUI parameters are not available', async () => {
            // Setup
            const apiResponse = {
                captchaRequired: {
                    login: false,
                    signup: true
                }
            };
            
            fetchStub.resolves({
                ok: true,
                json: () => Promise.resolve(apiResponse)
            });
            
            // Test
            const loginRequired = await isCaptchaRequired('login');
            
            // Assert
            expect(loginRequired).to.be.false;
            expect(fetchStub.calledOnce).to.be.true;
            expect(fetchStub.firstCall.args[0]).to.equal('https://test-api.puter.com/whoarewe');
        });
        
        it('should cache API responses for subsequent calls', async () => {
            // Setup
            const apiResponse = {
                captchaRequired: {
                    login: true,
                    signup: false
                }
            };
            
            fetchStub.resolves({
                ok: true,
                json: () => Promise.resolve(apiResponse)
            });
            
            // Test - first call should use the API
            const firstLoginRequired = await isCaptchaRequired('login');
            
            // Second call should use the cache
            const secondLoginRequired = await isCaptchaRequired('login');
            
            // Assert
            expect(firstLoginRequired).to.be.true;
            expect(secondLoginRequired).to.be.true;
            expect(fetchStub.calledOnce).to.be.true; // Fetch should only be called once
        });
        
        it('should handle API errors and default to requiring captcha', async () => {
            // Setup
            fetchStub.rejects(new Error('Network error'));
            
            // Test
            const loginRequired = await isCaptchaRequired('login');
            
            // Assert
            expect(loginRequired).to.be.true; // Should default to true on error
            expect(fetchStub.calledOnce).to.be.true;
        });
        
        it('should handle non-200 API responses and default to requiring captcha', async () => {
            // Setup
            fetchStub.resolves({
                ok: false,
                status: 500
            });
            
            // Test
            const loginRequired = await isCaptchaRequired('login');
            
            // Assert
            expect(loginRequired).to.be.true; // Should default to true on error
            expect(fetchStub.calledOnce).to.be.true;
        });
        
        it('should handle missing action type in response and default to requiring captcha', async () => {
            // Setup
            const apiResponse = {
                captchaRequired: {
                    // login is missing
                    signup: false
                }
            };
            
            fetchStub.resolves({
                ok: true,
                json: () => Promise.resolve(apiResponse)
            });
            
            // Test
            const loginRequired = await isCaptchaRequired('login');
            
            // Assert
            expect(loginRequired).to.be.true; // Should default to true if not specified
            expect(fetchStub.calledOnce).to.be.true;
        });
    });
    
    describe('invalidateCaptchaRequirementsCache', () => {
        it('should invalidate the cache and force a new API call', async () => {
            // Setup - first API call
            const firstApiResponse = {
                captchaRequired: {
                    login: true
                }
            };
            
            fetchStub.resolves({
                ok: true,
                json: () => Promise.resolve(firstApiResponse)
            });
            
            // First call to cache the result
            await isCaptchaRequired('login');
            
            // Setup - second API call with different response
            const secondApiResponse = {
                captchaRequired: {
                    login: false
                }
            };
            
            fetchStub.resolves({
                ok: true,
                json: () => Promise.resolve(secondApiResponse)
            });
            
            // Invalidate the cache
            invalidateCaptchaRequirementsCache();
            
            // Test - this should now make a new API call
            const loginRequired = await isCaptchaRequired('login');
            
            // Assert
            expect(loginRequired).to.be.false; // Should get the new value
            expect(fetchStub.calledTwice).to.be.true; // Fetch should be called twice
        });
    });
}); 