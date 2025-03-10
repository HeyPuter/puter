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

/**
 * Test script for the captcha middleware
 * 
 * This script tests the captcha middleware functionality by:
 * 1. Creating a mock Express app with the middleware
 * 2. Testing different scenarios (disabled, enabled, valid/invalid captcha)
 * 3. Verifying the results
 * 
 * Run this script with: node test-captcha-middleware.js
 */

// Mock Express and required dependencies
const express = require('express');
const requireCaptcha = require('./captcha-middleware');
const { CaptchaService } = require('../services/CaptchaService');
const APIError = require('../../../api/APIError');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Logging functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, colors.green);
}

function error(message) {
  log(`✗ ${message}`, colors.red);
}

function testHeader(message) {
  log(`\n${colors.cyan}=== ${message} ===${colors.reset}\n`);
}

// Mock Express app and services
class MockApp {
  constructor(captchaEnabled = true) {
    this.services = new Map();
    
    // Create and register captcha service
    const captchaService = new MockCaptchaService({
      enabled: captchaEnabled,
      expirationTime: 10 * 60 * 1000,
      difficulty: 'medium'
    });
    
    this.services.set('captcha', captchaService);
  }
}

// Mock CaptchaService for testing
class MockCaptchaService {
  constructor(config = {}) {
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.expirationTime = config.expirationTime || (10 * 60 * 1000);
    this.captchaTokens = new Map();
    
    // Create a test token
    this.captchaTokens.set('valid-token', {
      text: 'testanswer',
      expiresAt: Date.now() + this.expirationTime
    });
    
    // Create an expired token
    this.captchaTokens.set('expired-token', {
      text: 'expiredanswer',
      expiresAt: Date.now() - 1000
    });
  }
  
  verifyCaptcha(token, userAnswer) {
    if (!this.enabled) {
      return true;
    }
    
    const captchaData = this.captchaTokens.get(token);
    
    if (!captchaData || captchaData.expiresAt < Date.now()) {
      return false;
    }
    
    const normalizedUserAnswer = userAnswer.toLowerCase().trim();
    return captchaData.text === normalizedUserAnswer;
  }
}

// Mock request object
function createMockRequest(options = {}) {
  return {
    app: options.app || new MockApp(),
    body: options.body || {},
    requester: options.requester || {}
  };
}

// Mock response object
function createMockResponse() {
  return {
    status: function() { return this; },
    json: function() { return this; }
  };
}

// Test middleware with captcha service disabled
async function testMiddlewareDisabled() {
  testHeader('Testing middleware with captcha service disabled');
  
  const mockApp = new MockApp(false); // Disabled captcha service
  const req = createMockRequest({ app: mockApp });
  const res = createMockResponse();
  let nextCalled = false;
  
  const next = () => { nextCalled = true; };
  
  try {
    await requireCaptcha()(req, res, next);
    
    if (nextCalled) {
      success('Middleware correctly called next() when captcha service is disabled');
    } else {
      error('Middleware did not call next() when captcha service is disabled');
    }
  } catch (err) {
    error(`Middleware threw an error when captcha service is disabled: ${err.message}`);
  }
}

// Test middleware with always option
async function testMiddlewareAlways() {
  testHeader('Testing middleware with always option');
  
  const req = createMockRequest();
  const res = createMockResponse();
  let nextCalled = false;
  
  const next = () => { nextCalled = true; };
  
  try {
    await requireCaptcha({ always: true })(req, res, next);
    error('Middleware did not throw an error when captcha is required but not provided');
  } catch (err) {
    if (err.message.includes('Captcha verification required')) {
      success('Middleware correctly threw an error when captcha is required but not provided');
    } else {
      error(`Middleware threw an unexpected error: ${err.message}`);
    }
  }
}

// Test middleware with valid captcha
async function testMiddlewareValidCaptcha() {
  testHeader('Testing middleware with valid captcha');
  
  const req = createMockRequest({
    body: {
      captchaToken: 'valid-token',
      captchaAnswer: 'testanswer'
    }
  });
  const res = createMockResponse();
  let nextCalled = false;
  
  const next = () => { nextCalled = true; };
  
  try {
    await requireCaptcha({ always: true })(req, res, next);
    
    if (nextCalled) {
      success('Middleware correctly called next() with valid captcha');
    } else {
      error('Middleware did not call next() with valid captcha');
    }
  } catch (err) {
    error(`Middleware threw an error with valid captcha: ${err.message}`);
  }
}

// Test middleware with invalid captcha
async function testMiddlewareInvalidCaptcha() {
  testHeader('Testing middleware with invalid captcha');
  
  const req = createMockRequest({
    body: {
      captchaToken: 'valid-token',
      captchaAnswer: 'wronganswer'
    }
  });
  const res = createMockResponse();
  let nextCalled = false;
  
  const next = () => { nextCalled = true; };
  
  try {
    await requireCaptcha({ always: true })(req, res, next);
    error('Middleware did not throw an error with invalid captcha');
  } catch (err) {
    if (err.message.includes('Invalid captcha response')) {
      success('Middleware correctly threw an error with invalid captcha');
    } else {
      error(`Middleware threw an unexpected error: ${err.message}`);
    }
  }
}

// Test middleware with expired captcha
async function testMiddlewareExpiredCaptcha() {
  testHeader('Testing middleware with expired captcha');
  
  const req = createMockRequest({
    body: {
      captchaToken: 'expired-token',
      captchaAnswer: 'expiredanswer'
    }
  });
  const res = createMockResponse();
  let nextCalled = false;
  
  const next = () => { nextCalled = true; };
  
  try {
    await requireCaptcha({ always: true })(req, res, next);
    error('Middleware did not throw an error with expired captcha');
  } catch (err) {
    if (err.message.includes('Invalid captcha response')) {
      success('Middleware correctly threw an error with expired captcha');
    } else {
      error(`Middleware threw an unexpected error: ${err.message}`);
    }
  }
}

// Test middleware with conditional captcha (requester.requireCaptcha = true)
async function testMiddlewareConditional() {
  testHeader('Testing middleware with conditional captcha');
  
  const req = createMockRequest({
    requester: {
      requireCaptcha: true
    }
  });
  const res = createMockResponse();
  let nextCalled = false;
  
  const next = () => { nextCalled = true; };
  
  try {
    await requireCaptcha()(req, res, next);
    error('Middleware did not throw an error when conditional captcha is required');
  } catch (err) {
    if (err.message.includes('Captcha verification required')) {
      success('Middleware correctly threw an error when conditional captcha is required');
    } else {
      error(`Middleware threw an unexpected error: ${err.message}`);
    }
  }
}

// Run all tests
async function runTests() {
  log(`\n${colors.magenta}=== CAPTCHA MIDDLEWARE TESTS ===${colors.reset}\n`);
  
  try {
    // Mock APIError.create for testing
    APIError.create = (code, source, fields = {}) => {
      return new Error(fields.message || code);
    };
    
    // Run tests
    await testMiddlewareDisabled();
    await testMiddlewareAlways();
    await testMiddlewareValidCaptcha();
    await testMiddlewareInvalidCaptcha();
    await testMiddlewareExpiredCaptcha();
    await testMiddlewareConditional();
    
    log(`\n${colors.green}All tests completed!${colors.reset}\n`);
  } catch (err) {
    log(`\n${colors.red}Error running tests: ${err.message}${colors.reset}\n`);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  runTests
}; 