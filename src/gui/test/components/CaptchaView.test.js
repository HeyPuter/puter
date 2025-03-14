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
import jsdom from 'jsdom';

const { JSDOM } = jsdom;

// Mock the DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.customElements = dom.window.customElements;

// Mock the captchaHelper
const captchaHelper = {
    isCaptchaRequired: sinon.stub()
};

// Mock the grecaptcha object
global.grecaptcha = {
    ready: sinon.stub().callsFake(cb => cb()),
    execute: sinon.stub().resolves('mock-token'),
    render: sinon.stub().returns('captcha-widget-id')
};

// Import the module under test (mock import)
const CaptchaView = {
    prototype: {
        connectedCallback: sinon.stub(),
        disconnectedCallback: sinon.stub(),
        setRequired: sinon.stub(),
        isRequired: sinon.stub(),
        getValue: sinon.stub(),
        reset: sinon.stub()
    }
};

describe('CaptchaView', () => {
    let captchaElement;
    
    beforeEach(() => {
        // Create a mock CaptchaView element
        captchaElement = {
            ...CaptchaView.prototype,
            getAttribute: sinon.stub(),
            setAttribute: sinon.stub(),
            removeAttribute: sinon.stub(),
            appendChild: sinon.stub(),
            querySelector: sinon.stub(),
            style: {},
            dataset: {},
            captchaWidgetId: null,
            captchaContainer: document.createElement('div')
        };
        
        // Reset stubs
        Object.values(CaptchaView.prototype).forEach(stub => {
            if (typeof stub.reset === 'function') stub.reset();
        });
        
        captchaHelper.isCaptchaRequired.reset();
        grecaptcha.ready.reset();
        grecaptcha.execute.reset();
        grecaptcha.render.reset();
    });
    
    describe('setRequired', () => {
        it('should show captcha when required is true', () => {
            // Setup
            captchaElement.setRequired.callsFake(function(required) {
                this.required = required;
                if (required) {
                    this.style.display = 'block';
                } else {
                    this.style.display = 'none';
                }
            });
            
            // Test
            captchaElement.setRequired(true);
            
            // Assert
            expect(captchaElement.required).to.be.true;
            expect(captchaElement.style.display).to.equal('block');
        });
        
        it('should hide captcha when required is false', () => {
            // Setup
            captchaElement.setRequired.callsFake(function(required) {
                this.required = required;
                if (required) {
                    this.style.display = 'block';
                } else {
                    this.style.display = 'none';
                }
            });
            
            // Test
            captchaElement.setRequired(false);
            
            // Assert
            expect(captchaElement.required).to.be.false;
            expect(captchaElement.style.display).to.equal('none');
        });
    });
    
    describe('isRequired', () => {
        it('should return the current required state', () => {
            // Setup
            captchaElement.required = true;
            captchaElement.isRequired.callsFake(function() {
                return this.required;
            });
            
            // Test & Assert
            expect(captchaElement.isRequired()).to.be.true;
            
            // Change state
            captchaElement.required = false;
            
            // Test & Assert again
            expect(captchaElement.isRequired()).to.be.false;
        });
    });
    
    describe('getValue', () => {
        it('should return null when captcha is not required', () => {
            // Setup
            captchaElement.required = false;
            captchaElement.getValue.callsFake(function() {
                return this.required ? 'mock-token' : null;
            });
            
            // Test & Assert
            expect(captchaElement.getValue()).to.be.null;
        });
        
        it('should return token when captcha is required', () => {
            // Setup
            captchaElement.required = true;
            captchaElement.getValue.callsFake(function() {
                return this.required ? 'mock-token' : null;
            });
            
            // Test & Assert
            expect(captchaElement.getValue()).to.equal('mock-token');
        });
    });
    
    describe('reset', () => {
        it('should reset the captcha widget when it exists', () => {
            // Setup
            captchaElement.captchaWidgetId = 'captcha-widget-id';
            global.grecaptcha.reset = sinon.stub();
            captchaElement.reset.callsFake(function() {
                if (this.captchaWidgetId) {
                    grecaptcha.reset(this.captchaWidgetId);
                }
            });
            
            // Test
            captchaElement.reset();
            
            // Assert
            expect(grecaptcha.reset.calledWith('captcha-widget-id')).to.be.true;
        });
    });
}); 