/**
 * Puter.js AI Chat API Test Suite
 * Tests the puter.ai.chat() method using comprehensive test cases
 */

const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Simulate the real puter.ai.chat behavior for testing
class TestPuterAI {
    constructor() {
        this.lastCall = null;
    }

    async chat(...args) {
        this.lastCall = {
            args,
            timestamp: Date.now()
        };
        
        // Simulate the actual chat method's parameter processing
        const result = this.processParameters(args);
        
        // Return a mock response that mimics the real structure
        return {
            message: {
                role: "assistant",
                content: `Test response for: ${result.messages[0]?.content || 'unknown input'}`
            },
            usage: {
                prompt_tokens: 10,
                completion_tokens: 25,
                total_tokens: 35
            },
            // Add convenience methods like the real implementation
            toString: function() { return this.message.content; },
            valueOf: function() { return this.message.content; }
        };
    }

    processParameters(args) {
        // This simulates the actual parameter processing logic from the real implementation
        const result = {
            messages: [],
            vision: false,
            test_mode: false,
            driver: 'openai-completion',
            model: undefined,
            temperature: undefined,
            max_tokens: undefined,
            stream: undefined,
            tools: undefined
        };

        if (!args || args.length === 0) {
            throw { message: 'Arguments are required', code: 'arguments_required' };
        }

        // Process different input formats (matching the real implementation)
        if (typeof args[0] === 'string') {
            result.messages = [{ content: args[0] }];
            
            // Check for vision mode
            if (args[1] && (typeof args[1] === 'string' || args[1] instanceof File)) {
                result.vision = true;
                result.messages[0].content = [
                    args[0],
                    { image_url: { url: args[1] } }
                ];
            } else if (Array.isArray(args[1])) {
                result.vision = true;
                const imageObjects = args[1].map(img => ({ image_url: { url: img } }));
                result.messages[0].content = [args[0], ...imageObjects];
            }
        } else if (Array.isArray(args[0])) {
            result.messages = args[0];
        } else if (typeof args[0] === 'object') {
            Object.assign(result, args[0]);
        }

        // Check for test mode
        for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === 'boolean' && args[i] === true) {
                result.test_mode = true;
                break;
            }
        }

        // Check for user parameters object
        for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === 'object' && !Array.isArray(args[i]) && args[i] !== null) {
                if (args[i].model) result.model = args[i].model;
                if (args[i].temperature) result.temperature = args[i].temperature;
                if (args[i].max_tokens) result.max_tokens = args[i].max_tokens;
                if (args[i].stream !== undefined) result.stream = args[i].stream;
                if (args[i].tools) result.tools = args[i].tools;
                if (args[i].driver) result.driver = args[i].driver;
                if (args[i].testMode) result.test_mode = args[i].testMode;
                break;
            }
        }

        // Model mapping logic (matching the real implementation)
        if (result.model) {
            if (result.model.startsWith('gpt-')) {
                result.driver = 'openai-completion';
            } else if (result.model.startsWith('claude-')) {
                result.driver = 'claude';
            } else if (result.model.startsWith('gemini-')) {
                result.driver = 'gemini';
            } else if (result.model.startsWith('mistral-')) {
                result.driver = 'mistral';
            } else if (result.model.startsWith('openrouter:')) {
                result.driver = 'openrouter';
            }
        }

        return result;
    }

    reset() {
        this.lastCall = null;
    }
}

// Create test instance
const puter = { ai: new TestPuterAI() };

// Test runner class
class ChatAPITestRunner {
    constructor() {
        this.testResults = [];
        this.passed = 0;
        this.failed = 0;
        this.skipped = 0;
        this.testTimeout = 30000; // 30 seconds per test
        this.stopOnFirstFailure = true; // Stop at first failure
    }

    async loadTestCases() {
        try {
            const testFile = path.join(__dirname, 'spec', 'chat-api-test-cases.yaml');
            const fileContents = fs.readFileSync(testFile, 'utf8');
            return yaml.load(fileContents);
        } catch (error) {
            console.error('Failed to load test cases:', error.message);
            return null;
        }
    }

    async runTests() {
        console.log('Starting Puter.js AI Chat API Test Suite\n');
        
        const testCases = await this.loadTestCases();
        if (!testCases) {
            console.error('Failed to load test cases');
            return;
        }

        console.log(`Test Suite: ${testCases.test_suite.name}`);
        console.log(`Description: ${testCases.test_suite.description}`);
        console.log(`Version: ${testCases.test_suite.version}`);
        console.log(`Test Timeout: ${this.testTimeout}ms`);
        console.log(`Stop on first failure: ${this.stopOnFirstFailure}\n`);

        for (const category of testCases.test_categories) {
            const shouldContinue = await this.runTestCategory(category);
            if (!shouldContinue) {
                break; // Stop if requested
            }
        }

        this.printSummary();
    }

    async runTestCategory(category) {
        console.log(`\nCategory: ${category.name}`);
        console.log(`   ${category.description}`);
        console.log(`   ${'-'.repeat(50)}`);

        for (const test of category.tests) {
            const shouldContinue = await this.runTest(test, category.name);
            if (!shouldContinue) {
                return false; // Stop execution
            }
        }
        return true; // Continue execution
    }

    async runTest(test, categoryName) {
        const testName = `${categoryName} - ${test.name}`;
        console.log(`\nRunning: ${test.name}`);
        console.log(`   ${test.description}`);

        try {
            // Reset mock state
            puter.ai.reset();

            // Set up test timeout
            const testPromise = this.executeTest(test);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Test timeout after ${this.testTimeout}ms`)), this.testTimeout);
            });

            // Run test with timeout
            const result = await Promise.race([testPromise, timeoutPromise]);

            // Validate results
            const validationResult = this.validateTest(test, result);
            
            if (validationResult.passed) {
                console.log(`   PASSED`);
                this.passed++;
                this.testResults.push({
                    name: testName,
                    status: 'PASSED',
                    category: categoryName,
                    description: test.description,
                    result: result
                });
                return true; // Continue execution
            } else {
                console.log(`   FAILED`);
                console.log(`      Expected: ${JSON.stringify(test.expected, null, 2)}`);
                console.log(`      Got: ${JSON.stringify(validationResult.actual, null, 2)}`);
                console.log(`      Issues: ${validationResult.issues.join(', ')}`);
                
                // Print detailed failure information
                this.printDetailedFailure(test, validationResult, result);
                
                this.failed++;
                this.testResults.push({
                    name: testName,
                    status: 'FAILED',
                    category: categoryName,
                    description: test.description,
                    expected: test.expected,
                    actual: validationResult.actual,
                    issues: validationResult.issues,
                    result: result
                });
                
                // Stop execution if configured to stop on first failure
                if (this.stopOnFirstFailure) {
                    console.log('\nStopping test execution due to first failure.');
                    return false; // Stop execution
                }
                return true; // Continue execution
            }

        } catch (error) {
            console.log(`   ERROR: ${error.message}`);
            this.failed++;
            this.testResults.push({
                name: testName,
                status: 'ERROR',
                category: categoryName,
                description: test.description,
                error: error.message
            });
            
            // Stop execution if configured to stop on first failure
            if (this.stopOnFirstFailure) {
                console.log('\nStopping test execution due to first failure.');
                return false; // Stop execution
            }
            return true; // Continue execution
        }
    }

    printDetailedFailure(test, validationResult, result) {
        console.log('\n   DETAILED FAILURE INFORMATION:');
        console.log(`   Test: ${test.name}`);
        console.log(`   Category: ${test.category || 'Unknown'}`);
        console.log(`   Description: ${test.description}`);
        console.log(`   Input: ${JSON.stringify(test.input, null, 2)}`);
        console.log(`   Expected: ${JSON.stringify(test.expected, null, 2)}`);
        console.log(`   Actual: ${JSON.stringify(validationResult.actual, null, 2)}`);
        console.log(`   Issues: ${validationResult.issues.join(', ')}`);
        
        if (result && result.actualParams) {
            console.log(`   Processed Parameters: ${JSON.stringify(result.actualParams, null, 2)}`);
        }
        
        if (puter.ai.lastCall) {
            console.log(`   Raw Arguments: ${JSON.stringify(puter.ai.lastCall.args, null, 2)}`);
        }
    }

    async executeTest(test) {
        if (test.input === null) {
            // Test error case - expect an error to be thrown
            try {
                await puter.ai.chat();
                throw new Error('Expected error but none thrown');
            } catch (error) {
                return { success: false, error };
            }
        }

        // Test normal case - make simulated API call
        try {
            const args = Array.isArray(test.input) ? test.input : [test.input];
            const result = await puter.ai.chat(...args);
            
            // Get the actual processed parameters from the mock
            const actualParams = puter.ai.lastCall ? 
                puter.ai.processParameters(puter.ai.lastCall.args) : {};

            return {
                success: true,
                result: result,
                actualParams: actualParams
            };
        } catch (error) {
            return {
                success: false,
                error: error
            };
        }
    }

    validateTest(test, result) {
        const validation = {
            passed: true,
            actual: {},
            issues: []
        };

        // Get the actual processed parameters
        const actualParams = puter.ai.lastCall ? 
            puter.ai.processParameters(puter.ai.lastCall.args) : {};

        // Validate expected properties
        if (test.expected) {
            for (const [key, expectedValue] of Object.entries(test.expected)) {
                if (key === 'expected_response' || key === 'expected_error') {
                    continue; // Skip response validation for now
                }

                const actualValue = actualParams[key];
                validation.actual[key] = actualValue;

                if (expectedValue !== actualValue) {
                    validation.passed = false;
                    validation.issues.push(`${key}: expected ${expectedValue}, got ${actualValue}`);
                }
            }
        }

        // Validate response structure if specified
        if (test.expected_response && result.result) {
            if (!result.result.message || !result.result.usage) {
                validation.passed = false;
                validation.issues.push('Response missing message or usage');
            }
        }

        // Validate error cases
        if (test.expected_error && result && result.error) {
            const error = result.error;
            if (test.expected_error.code && error.code !== test.expected_error.code) {
                validation.passed = false;
                validation.issues.push(`Error code: expected ${test.expected_error.code}, got ${error.code}`);
            }
            if (test.expected_error.message && error.message !== test.expected_error.message) {
                validation.passed = false;
                validation.issues.push(`Error message: expected ${test.expected_error.message}, got ${error.message}`);
            }
        }

        return validation;
    }

    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);
        console.log(`Skipped: ${this.skipped}`);
        console.log(`Total: ${this.passed + this.failed + this.skipped}`);
        
        const total = this.passed + this.failed + this.skipped;
        if (total > 0) {
            console.log(`Success Rate: ${((this.passed / total) * 100).toFixed(1)}%`);
        }

        if (this.failed > 0) {
            console.log('\nFAILED TESTS:');
            this.testResults
                .filter(r => r.status === 'FAILED')
                .forEach(result => {
                    console.log(`   - ${result.name}: ${result.issues.join(', ')}`);
                });
        }

        if (this.testResults.some(r => r.status === 'ERROR')) {
            console.log('\nTESTS WITH ERRORS:');
            this.testResults
                .filter(r => r.status === 'ERROR')
                .forEach(result => {
                    console.log(`   - ${result.name}: ${result.error}`);
                });
        }

        // Print summary to stdout for easy parsing
        console.log('\nSUMMARY_OUTPUT_START');
        console.log(JSON.stringify({
            passed: this.passed,
            failed: this.failed,
            skipped: this.skipped,
            total: total,
            successRate: total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0,
            results: this.testResults
        }, null, 2));
        console.log('SUMMARY_OUTPUT_END');
    }

    // Removed generateReport method - no file saving needed
}

// Main execution
async function main() {
    const runner = new ChatAPITestRunner();
    
    try {
        await runner.runTests();
        // runner.generateReport(); // Removed as per edit hint
        
        // Exit with appropriate code
        process.exit(runner.failed > 0 ? 1 : 0);
    } catch (error) {
        console.error('Test runner failed:', error);
        process.exit(1);
    }
}

// Export for use in other test files
module.exports = {
    ChatAPITestRunner,
    TestPuterAI
};

// Run if this file is executed directly
if (require.main === module) {
    main();
}
