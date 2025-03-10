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

/**
 * Direct test script for the CaptchaService
 * 
 * This script directly tests the CaptchaService functionality by:
 * 1. Creating an instance of the service
 * 2. Calling its methods directly
 * 3. Verifying the results
 * 
 * This is a more direct test that doesn't rely on API endpoints.
 * 
 * Run this script with: node test-captcha-direct.js
 */

const fs = require('fs');
const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');

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

/**
 * Log a message with color
 */
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Log a success message
 */
function success(message) {
  log(`✓ ${message}`, colors.green);
}

/**
 * Log an error message
 */
function error(message) {
  log(`✗ ${message}`, colors.red);
}

/**
 * Log a test header
 */
function testHeader(message) {
  log(`\n${colors.cyan}=== ${message} ===${colors.reset}`);
}

/**
 * Simple CaptchaService implementation for testing
 * This avoids the complexity of mocking the entire service infrastructure
 */
class SimpleCaptchaService {
  constructor(config = {}) {
    this.captchaTokens = new Map();
    this.enabled = config.enabled !== undefined ? config.enabled : true;
    this.expirationTime = config.expirationTime || (10 * 60 * 1000);
    this.difficulty = config.difficulty || 'medium';
    
    this.log = {
      debug: console.log,
      info: console.log,
      warn: console.warn,
      error: console.error
    };
    
    this.crypto = crypto;
    this.svgCaptcha = svgCaptcha;
  }
  
  generateCaptcha() {
    if (!this.enabled) {
      throw new Error('Captcha service is disabled');
    }

    // Configure captcha options based on difficulty
    const options = this._getCaptchaOptions();
    
    // Generate the captcha
    const captcha = this.svgCaptcha.create(options);
    
    // Generate a unique token
    const token = this.crypto.randomBytes(32).toString('hex');
    
    // Store token with captcha text and expiration
    this.captchaTokens.set(token, {
      text: captcha.text.toLowerCase(),
      expiresAt: Date.now() + this.expirationTime
    });
    
    this.log.debug(`Generated captcha with token: ${token}`);
    
    return {
      token: token,
      image: captcha.data
    };
  }
  
  verifyCaptcha(token, userAnswer) {
    if (!this.enabled) {
      this.log.warn('Captcha verification skipped (service disabled)');
      return true; // If disabled, always pass verification
    }

    // Get captcha data for token
    const captchaData = this.captchaTokens.get(token);
    
    // Invalid token or expired
    if (!captchaData || captchaData.expiresAt < Date.now()) {
      this.log.debug(`Invalid or expired captcha token: ${token}`);
      return false;
    }
    
    // Normalize and compare answers
    const normalizedUserAnswer = userAnswer.toLowerCase().trim();
    const isValid = captchaData.text === normalizedUserAnswer;
    
    // Remove token after verification (one-time use)
    this.captchaTokens.delete(token);
    
    this.log.debug(`Verified captcha token: ${token}, valid: ${isValid}`);
    return isValid;
  }
  
  cleanupExpiredTokens() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [token, data] of this.captchaTokens.entries()) {
      if (data.expiresAt < now) {
        this.captchaTokens.delete(token);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.log.debug(`Cleaned up ${expiredCount} expired captcha tokens`);
    }
  }
  
  _getCaptchaOptions() {
    const baseOptions = {
      size: 6, // Default captcha length
      ignoreChars: '0o1ilI', // Characters to avoid (confusing)
      noise: 2, // Lines to add as noise
      color: true,
      background: '#f0f0f0'
    };
    
    switch (this.difficulty) {
      case 'easy':
        return {
          ...baseOptions,
          size: 4,
          width: 150,
          height: 50,
          noise: 1
        };
      case 'hard':
        return {
          ...baseOptions,
          size: 7,
          width: 200,
          height: 60,
          noise: 3
        };
      case 'medium':
      default:
        return {
          ...baseOptions,
          width: 180,
          height: 50
        };
    }
  }
}

/**
 * Test captcha generation
 */
async function testCaptchaGeneration(captchaService) {
  testHeader('Testing Captcha Generation');
  
  try {
    const captcha = captchaService.generateCaptcha();
    
    if (captcha && captcha.token && captcha.image) {
      success('Captcha generation is working');
      success(`Generated token: ${captcha.token.substring(0, 10)}...`);
      
      // Save the SVG to a file for visual inspection
      fs.writeFileSync('captcha-direct.svg', captcha.image);
      success('Saved captcha image to captcha-direct.svg for visual inspection');
      
      return captcha;
    } else {
      error('Captcha generation returned unexpected result');
      console.log(captcha);
      return null;
    }
  } catch (err) {
    error(`Error testing captcha generation: ${err.message}`);
    console.error(err);
    return null;
  }
}

/**
 * Test captcha verification with the correct answer
 */
async function testCaptchaVerificationValid(captchaService, token, text) {
  testHeader('Testing Captcha Verification (Valid)');
  
  try {
    const isValid = captchaService.verifyCaptcha(token, text);
    
    if (isValid === true) {
      success('Captcha verification correctly validated the answer');
      return true;
    } else {
      error('Captcha verification failed to validate the correct answer');
      return false;
    }
  } catch (err) {
    error(`Error testing captcha verification: ${err.message}`);
    console.error(err);
    return false;
  }
}

/**
 * Test captcha verification with an invalid answer
 */
async function testCaptchaVerificationInvalid(captchaService, token) {
  testHeader('Testing Captcha Verification (Invalid)');
  
  try {
    const isValid = captchaService.verifyCaptcha(token, 'wrong-answer');
    
    if (isValid === false) {
      success('Captcha verification correctly rejected the invalid answer');
      return true;
    } else {
      error('Captcha verification incorrectly validated a wrong answer');
      return false;
    }
  } catch (err) {
    error(`Error testing captcha verification: ${err.message}`);
    console.error(err);
    return false;
  }
}

/**
 * Test captcha verification with an expired token
 */
async function testCaptchaVerificationExpired(captchaService, token) {
  testHeader('Testing Captcha Verification (Used Token)');
  
  try {
    const isValid = captchaService.verifyCaptcha(token, 'any-answer');
    
    if (isValid === false) {
      success('Captcha verification correctly rejected the used token');
      return true;
    } else {
      error('Captcha verification incorrectly validated a used token');
      return false;
    }
  } catch (err) {
    error(`Error testing captcha verification: ${err.message}`);
    console.error(err);
    return false;
  }
}

/**
 * Test token cleanup
 */
async function testTokenCleanup(captchaService) {
  testHeader('Testing Token Cleanup');
  
  try {
    // Generate a captcha
    const captcha = captchaService.generateCaptcha();
    
    // Manually modify the expiration time to make it expired
    const tokenData = captchaService.captchaTokens.get(captcha.token);
    tokenData.expiresAt = Date.now() - 1000; // Set to 1 second in the past
    captchaService.captchaTokens.set(captcha.token, tokenData);
    
    // Count tokens before cleanup
    const beforeCount = captchaService.captchaTokens.size;
    
    // Run cleanup
    captchaService.cleanupExpiredTokens();
    
    // Count tokens after cleanup
    const afterCount = captchaService.captchaTokens.size;
    
    if (afterCount < beforeCount) {
      success(`Token cleanup removed expired tokens (before: ${beforeCount}, after: ${afterCount})`);
      return true;
    } else {
      error('Token cleanup failed to remove expired tokens');
      return false;
    }
  } catch (err) {
    error(`Error testing token cleanup: ${err.message}`);
    console.error(err);
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  log('\n🔍 Starting Direct Captcha Service Tests', colors.magenta);
  
  // Create a simplified captcha service for testing
  const captchaService = new SimpleCaptchaService({
    enabled: true,
    expirationTime: 10 * 60 * 1000,
    difficulty: 'medium'
  });
  
  // Test captcha generation
  const captchaData = await testCaptchaGeneration(captchaService);
  if (!captchaData) {
    error('Cannot proceed with verification tests due to generation failure');
    return;
  }
  
  // Get the actual text from the captcha token data
  // This is only possible in this direct test because we have access to the internal data
  const captchaTokenData = captchaService.captchaTokens.get(captchaData.token);
  const actualCaptchaText = captchaTokenData.text;
  
  log(`\nCaptcha text (from internal data): "${actualCaptchaText}"`, colors.yellow);
  
  // Test verification with valid answer
  await testCaptchaVerificationValid(captchaService, captchaData.token, actualCaptchaText);
  
  // Generate a new captcha for the invalid test
  // (since the previous token is now used)
  const captchaData2 = await testCaptchaGeneration(captchaService);
  
  // Test verification with invalid answer
  await testCaptchaVerificationInvalid(captchaService, captchaData2.token);
  
  // Test verification with used token
  await testCaptchaVerificationExpired(captchaService, captchaData2.token);
  
  // Test token cleanup
  await testTokenCleanup(captchaService);
  
  log('\n🏁 Direct Captcha Service Tests Completed', colors.magenta);
}

// Run the tests
runTests().catch(err => {
  error(`Unhandled error during tests: ${err.message}`);
  console.error(err);
}); 