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

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const sinon = require('sinon');

// Mock the Context
const Context = {
    get: sinon.stub()
};

// Mock the APIError
const APIError = {
    create: sinon.stub().returns({ name: 'APIError' })
};

// Path is relative to where the test will be run
const { checkCaptcha, requireCaptcha } = require('../../../../src/modules/captcha/middleware/captcha-middleware');

describe('Captcha Middleware', () => {
    let req, res, next, services, captchaService, eventService;
    
    beforeEach(() => {
        // Reset all stubs
        sinon.reset();
        
        // Mock request, response, and next function
        req = {
            ip: '127.0.0.1',
            headers: {
                'user-agent': 'test-agent'
            },
            body: {},
            connection: {
                remoteAddress: '127.0.0.1'
            }
        };
        
        res = {
            status: sinon.stub().returnsThis(),
            json: sinon.stub().returnsThis()
        };
        
        next = sinon.stub();
        
        // Mock services
        captchaService = {
            enabled: true,
            verifyCaptcha: sinon.stub()
        };
        
        eventService = {
            emit: sinon.stub().resolves()
        };
        
        services = {
            get: sinon.stub()
        };
        
        // Configure service mocks
        services.get.withArgs('captcha').returns(captchaService);
        services.get.withArgs('event').returns(eventService);
        
        // Configure Context mock
        Context.get.withArgs('services').returns(services);
    });
    
    describe('checkCaptcha', () => {
        it('should set captchaRequired to false when not required', async () => {
            // Setup
            const middleware = checkCaptcha({ strictMode: false });
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(req.captchaRequired).to.be.false;
            expect(next.calledOnce).to.be.true;
        });
        
        it('should set captchaRequired to true when always option is true', async () => {
            // Setup
            const middleware = checkCaptcha({ always: true });
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(req.captchaRequired).to.be.true;
            expect(next.calledOnce).to.be.true;
        });
        
        it('should set captchaRequired to true when requester.requireCaptcha is true', async () => {
            // Setup
            req.requester = { requireCaptcha: true };
            const middleware = checkCaptcha();
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(req.captchaRequired).to.be.true;
            expect(next.calledOnce).to.be.true;
        });
        
        it('should emit captcha.validate event with correct parameters', async () => {
            // Setup
            const middleware = checkCaptcha({ eventType: 'login' });
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(eventService.emit.calledOnce).to.be.true;
            expect(eventService.emit.firstCall.args[0]).to.equal('captcha.validate');
            
            const eventData = eventService.emit.firstCall.args[1];
            expect(eventData.type).to.equal('login');
            expect(eventData.ip).to.equal('127.0.0.1');
            expect(eventData.userAgent).to.equal('test-agent');
            expect(eventData.req).to.equal(req);
        });
        
        it('should respect extension decision to require captcha', async () => {
            // Setup
            eventService.emit.callsFake((event, data) => {
                data.require = true;
                return Promise.resolve();
            });
            
            const middleware = checkCaptcha({ strictMode: false });
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(req.captchaRequired).to.be.true;
            expect(next.calledOnce).to.be.true;
        });
        
        it('should respect extension decision to not require captcha', async () => {
            // Setup
            eventService.emit.callsFake((event, data) => {
                data.require = false;
                return Promise.resolve();
            });
            
            const middleware = checkCaptcha({ always: true });
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(req.captchaRequired).to.be.false;
            expect(next.calledOnce).to.be.true;
        });
        
        it('should default to strictMode value when services are not available', async () => {
            // Setup
            Context.get.withArgs('services').returns(null);
            
            // Test with strictMode true
            let middleware = checkCaptcha({ strictMode: true });
            await middleware(req, res, next);
            expect(req.captchaRequired).to.be.true;
            
            // Reset
            req = { headers: {}, connection: { remoteAddress: '127.0.0.1' } };
            next = sinon.stub();
            
            // Test with strictMode false
            middleware = checkCaptcha({ strictMode: false });
            await middleware(req, res, next);
            expect(req.captchaRequired).to.be.false;
        });
    });
    
    describe('requireCaptcha', () => {
        it('should call next() when captchaRequired is false', async () => {
            // Setup
            req.captchaRequired = false;
            const middleware = requireCaptcha();
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(next.calledOnce).to.be.true;
            expect(next.firstCall.args.length).to.equal(0); // No error passed
        });
        
        it('should return error when captchaRequired is true but token/answer missing', async () => {
            // Setup
            req.captchaRequired = true;
            const middleware = requireCaptcha();
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(next.calledOnce).to.be.true;
            expect(next.firstCall.args.length).to.equal(1); // Error passed
            expect(APIError.create.calledWith('captcha_required')).to.be.true;
        });
        
        it('should verify captcha when token and answer are provided', async () => {
            // Setup
            req.captchaRequired = true;
            req.body.captchaToken = 'test-token';
            req.body.captchaAnswer = 'test-answer';
            captchaService.verifyCaptcha.returns(true);
            
            const middleware = requireCaptcha();
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(captchaService.verifyCaptcha.calledWith('test-token', 'test-answer')).to.be.true;
            expect(next.calledOnce).to.be.true;
            expect(next.firstCall.args.length).to.equal(0); // No error passed
        });
        
        it('should return error when captcha verification fails', async () => {
            // Setup
            req.captchaRequired = true;
            req.body.captchaToken = 'test-token';
            req.body.captchaAnswer = 'test-answer';
            captchaService.verifyCaptcha.returns(false);
            
            const middleware = requireCaptcha();
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(captchaService.verifyCaptcha.calledWith('test-token', 'test-answer')).to.be.true;
            expect(next.calledOnce).to.be.true;
            expect(next.firstCall.args.length).to.equal(1); // Error passed
            expect(APIError.create.calledWith('captcha_invalid')).to.be.true;
        });
        
        it('should handle errors during captcha verification', async () => {
            // Setup
            req.captchaRequired = true;
            req.body.captchaToken = 'test-token';
            req.body.captchaAnswer = 'test-answer';
            captchaService.verifyCaptcha.throws(new Error('Verification error'));
            
            const middleware = requireCaptcha();
            
            // Test
            await middleware(req, res, next);
            
            // Assert
            expect(captchaService.verifyCaptcha.calledWith('test-token', 'test-answer')).to.be.true;
            expect(next.calledOnce).to.be.true;
            expect(next.firstCall.args.length).to.equal(1); // Error passed
            expect(APIError.create.calledWith('captcha_invalid')).to.be.true;
        });
    });
}); 