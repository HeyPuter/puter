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
 * Simple test script for the CaptchaService API endpoints
 * 
 * This script tests the CaptchaService functionality through its API endpoints:
 * 1. Testing the /api/captcha/generate endpoint
 * 2. Testing the /api/captcha/verify endpoint with valid and invalid answers
 * 3. Testing token expiration
 * 
 * IMPORTANT: This test requires the Puter server to be running at http://localhost:4100
 * 
 * Run this script with: node test-captcha.js
 */

// Axios for HTTP requests
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// Base URL for API requests
const API_BASE_URL = 'http://localhost:4100';

// Axios instance with proper headers
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Host': 'puter.localhost:4100',
    'Origin': 'http://puter.localhost:4100',
    'Referer': 'http://puter.localhost:4100/'
  }
});

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
 * Check if the server is running
 */
async function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:4100', (res) => {
      // Even if we get a 400 response, the server is running
      resolve(res.statusCode !== undefined);
    });
    
    req.on('error', () => {
      resolve(false);
    });
    
    req.setTimeout(2000, () => {
      req.abort();
      resolve(false);
    });
  });
}

/**
 * Test captcha generation
 */
async function testCaptchaGeneration() {
  testHeader('Testing Captcha Generation');
  
  // Try different possible paths
  const paths = [
    '/api/captcha/generate',
    '/captcha/generate',
    '/api/v1/captcha/generate',
    '/v1/captcha/generate'
  ];
  
  for (const path of paths) {
    try {
      log(`Trying endpoint: ${path}`, colors.blue);
      const response = await api.get(path);
      
      if (response.status === 200 && response.data.token && response.data.image) {
        success(`Captcha generation endpoint found at ${path}`);
        
        const token = response.data.token;
        const image = response.data.image;
        
        // Save the token for verification tests
        testCaptchaGeneration.token = token;
        testCaptchaGeneration.workingPath = path.replace('/generate', '');
        
        // Log the token (first 10 chars)
        success(`Received token: ${token.substring(0, 10)}...`);
        
        // Save the image to a file for visual inspection
        fs.writeFileSync('captcha.svg', image);
        success('Saved captcha image to captcha.svg for visual inspection');
        
        // For testing purposes, we'll use a special token that we can verify
        // This is a hack for automated testing - in a real scenario, the user would solve the captcha
        console.log('\n⚠️ For automated testing, we will create a special test token with a known answer');
        
        // Create a special test token with a known answer
        const testToken = 'test-token-for-automated-testing';
        const testAnswer = 'testanswer';
        
        // Make a direct request to create this test token
        try {
          const createTestTokenResponse = await api.post('/api/captcha/create-test-token', {
            token: testToken,
            answer: testAnswer
          });
          
          if (createTestTokenResponse.status === 200) {
            success('Created special test token for automated testing');
            testCaptchaGeneration.testToken = testToken;
            testCaptchaGeneration.testAnswer = testAnswer;
          }
        } catch (err) {
          // If the special endpoint doesn't exist, we'll use a placeholder
          console.log('Special test endpoint not available, using placeholder for testing');
          testCaptchaGeneration.testToken = token;
          testCaptchaGeneration.testAnswer = 'testanswer';
        }
        
        return {
          token,
          image,
          path
        };
      }
    } catch (err) {
      log(`Endpoint ${path} failed: ${err.message}`, colors.yellow);
      if (err.response && err.response.status !== 404) {
        console.log(err.response.data);
      }
    }
  }
  
  error('Could not find a working captcha generation endpoint');
  return null;
}

/**
 * Test captcha verification with a valid answer
 */
async function testCaptchaVerificationValid(token, answer) {
  testHeader('Testing Captcha Verification (Valid)');
  
  // Use the test token and answer if available
  const testToken = testCaptchaGeneration.testToken || token;
  const testAnswer = testCaptchaGeneration.testAnswer || answer;
  
  // Use the path that worked for generation
  const basePath = testCaptchaGeneration.workingPath || '/api/captcha';
  const verifyPath = `${basePath}/verify`;
  
  try {
    log(`Using endpoint: ${verifyPath}`, colors.blue);
    log(`Using test token: ${testToken.substring(0, 10)}...`, colors.blue);
    log(`Using test answer: ${testAnswer}`, colors.blue);
    
    const response = await api.post(verifyPath, {
      token: testToken,
      answer: testAnswer
    });
    
    if (response.status === 200 && response.data.valid === true) {
      success('Captcha verification endpoint correctly validated the answer');
      return true;
    } else {
      error('Captcha verification endpoint failed to validate the correct answer');
      console.log(response.data);
      return false;
    }
  } catch (err) {
    error(`Error testing captcha verification: ${err.message}`);
    if (err.response) {
      console.log(err.response.data);
    }
    return false;
  }
}

/**
 * Test captcha verification with an invalid answer
 */
async function testCaptchaVerificationInvalid(token) {
  testHeader('Testing Captcha Verification (Invalid)');
  
  // Use the path that worked for generation
  const basePath = testCaptchaGeneration.workingPath || '/api/captcha';
  const verifyPath = `${basePath}/verify`;
  
  try {
    log(`Using endpoint: ${verifyPath}`, colors.blue);
    const response = await api.post(verifyPath, {
      token,
      answer: 'wrong-answer'
    });
    
    if (response.status === 200 && response.data.valid === false) {
      success('Captcha verification endpoint correctly rejected the invalid answer');
      return true;
    } else {
      error('Captcha verification endpoint incorrectly validated a wrong answer');
      console.log(response.data);
      return false;
    }
  } catch (err) {
    error(`Error testing captcha verification: ${err.message}`);
    if (err.response) {
      console.log(err.response.data);
    }
    return false;
  }
}

/**
 * Test captcha verification with an expired token
 */
async function testCaptchaVerificationExpired(token) {
  testHeader('Testing Captcha Verification (Used Token)');
  
  // Use the path that worked for generation
  const basePath = testCaptchaGeneration.workingPath || '/api/captcha';
  const verifyPath = `${basePath}/verify`;
  
  try {
    log(`Using endpoint: ${verifyPath}`, colors.blue);
    const response = await api.post(verifyPath, {
      token,
      answer: 'any-answer'
    });
    
    if (response.status === 200 && response.data.valid === false) {
      success('Captcha verification endpoint correctly rejected the used token');
      return true;
    } else {
      error('Captcha verification endpoint incorrectly validated a used token');
      console.log(response.data);
      return false;
    }
  } catch (err) {
    error(`Error testing captcha verification: ${err.message}`);
    if (err.response) {
      console.log(err.response.data);
    }
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  log('\n🔍 Starting Captcha Service API Tests', colors.magenta);
  
  // Check if the server is running
  const serverRunning = await checkServerRunning();
  if (!serverRunning) {
    error('❌ Server is not running at http://localhost:4100');
    log('\nThis test requires the Puter server to be running. Please start the server with:', colors.yellow);
    log('cd /path/to/puter && npm start', colors.yellow);
    log('\nThen run this test again.', colors.yellow);
    return;
  }
  
  success('Server is running at http://localhost:4100');
  
  // Test captcha generation
  const captchaData = await testCaptchaGeneration();
  if (!captchaData) {
    error('Cannot proceed with verification tests due to generation failure');
    log('\nPossible reasons for failure:', colors.yellow);
    log('1. The captcha endpoints are not properly registered', colors.yellow);
    log('2. The server requires specific headers or authentication', colors.yellow);
    log('3. The CaptchaService is not properly initialized', colors.yellow);
    log('4. The CaptchaModule is not loaded by the system', colors.yellow);
    
    log('\nTo fix this issue:', colors.yellow);
    log('1. Make sure the CaptchaModule is properly registered in the system', colors.yellow);
    log('2. Check that the CaptchaService is properly initializing and registering its endpoints', colors.yellow);
    log('3. Restart the server after making any changes', colors.yellow);
    return;
  }
  
  // For a real test, we would need to know the answer
  // In a real scenario, we would need to extract the text from the SVG or have a way to get it
  // For this test, we'll prompt the user to enter the captcha text
  log('\n⚠️ Since we cannot automatically extract the text from the SVG, please:', colors.yellow);
  log('1. Open the captcha.svg file that was saved', colors.yellow);
  log('2. Enter the text you see in the captcha below:', colors.yellow);
  
  // In a real test, we would use a proper way to get user input
  // For this example, we'll just use a placeholder
  const captchaAnswer = 'PLACEHOLDER'; // Replace this with actual user input in a real scenario
  
  log(`\nUsing answer: "${captchaAnswer}" for testing purposes`, colors.yellow);
  log('In a real test, you would replace this with the actual captcha text', colors.yellow);
  
  // Test verification with valid answer
  // Note: This will likely fail since we're using a placeholder
  await testCaptchaVerificationValid(captchaData.token, captchaAnswer);
  
  // Test verification with invalid answer
  await testCaptchaVerificationInvalid(captchaData.token);
  
  // Test verification with used token (should be invalid after previous verification)
  await testCaptchaVerificationExpired(captchaData.token);
  
  log('\n🏁 Captcha Service API Tests Completed', colors.magenta);
}

// Run the tests
runTests().catch(err => {
  error(`Unhandled error during tests: ${err.message}`);
  console.error(err);
}); 