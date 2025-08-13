/**
 * Puter.js AI Chat API Test Suite
 * Tests the puter.ai.chat() method using comprehensive test cases
 */

const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Mock puter.ai.chat for testing
class MockPuterAI {
    constructor() {
        this.lastCall = null;
        this.mockResponse = {
            message: {
                role: "assistant",
                content: "Mock response for testing"
            },
            usage: {
                prompt_tokens: 10,
                completion_tokens: 25,
                total_tokens: 35
            }
        };
        
        // Add convenience methods
        this.mockResponse.toString = () => this.mockResponse.message.content;
        this.mockResponse.valueOf = () => this.mockResponse.message.content;
    }

    async chat(...args) {
        this.lastCall = {
            args,
            timestamp: Date.now()
        };
        
        // Simulate the actual chat method's parameter processing
        const result = this.processParameters(args);
        
        // Return mock response
        return Promise.resolve(this.mockResponse);
    }

    processParameters(args) {
        // This simulates the actual parameter processing logic
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

        // Process different input formats
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

        // Model mapping logic
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

// Test runner class
class ChatAPITestRunner {
    constructor() {
        this.puter = new MockPuterAI();
        this.testResults = [];
        this.passed = 0;
        this.failed = 0;
        this.skipped = 0;
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
        console.log('🚀 Starting Puter.js AI Chat API Test Suite\n');
        
        const testCases = await this.loadTestCases();
        if (!testCases) {
            console.error('❌ Failed to load test cases');
            return;
        }

        console.log(`📋 Test Suite: ${testCases.test_suite.name}`);
        console.log(`📝 Description: ${testCases.test_suite.description}`);
        console.log(`🔢 Version: ${testCases.test_suite.version}\n`);

        for (const category of testCases.test_categories) {
            await this.runTestCategory(category);
        }

        this.printSummary();
    }

    async runTestCategory(category) {
        console.log(`\n📁 Category: ${category.name}`);
        console.log(`   ${category.description}`);
        console.log(`   ${'─'.repeat(50)}`);

        for (const test of category.tests) {
            await this.runTest(test, category.name);
        }
    }

    async runTest(test, categoryName) {
        const testName = `${categoryName} - ${test.name}`;
        console.log(`\n🧪 Running: ${test.name}`);
        console.log(`   ${test.description}`);

        try {
            // Reset mock state
            this.puter.reset();

            // Run the test
            let result;
            if (test.input === null) {
                // Test error case
                try {
                    await this.puter.chat();
                    result = { success: false, error: 'Expected error but none thrown' };
                } catch (error) {
                    result = { success: true, error };
                }
            } else {
                // Test normal case
                result = await this.puter.chat(...(Array.isArray(test.input) ? test.input : [test.input]));
            }

            // Validate results
            const validationResult = this.validateTest(test, result);
            
            if (validationResult.passed) {
                console.log(`   ✅ PASSED`);
                this.passed++;
                this.testResults.push({
                    name: testName,
                    status: 'PASSED',
                    category: categoryName,
                    description: test.description
                });
            } else {
                console.log(`   ❌ FAILED`);
                console.log(`      Expected: ${JSON.stringify(test.expected, null, 2)}`);
                console.log(`      Got: ${JSON.stringify(validationResult.actual, null, 2)}`);
                console.log(`      Issues: ${validationResult.issues.join(', ')}`);
                this.failed++;
                this.testResults.push({
                    name: testName,
                    status: 'FAILED',
                    category: categoryName,
                    description: test.description,
                    expected: test.expected,
                    actual: validationResult.actual,
                    issues: validationResult.issues
                });
            }

        } catch (error) {
            console.log(`   ❌ ERROR: ${error.message}`);
            this.failed++;
            this.testResults.push({
                name: testName,
                status: 'ERROR',
                category: categoryName,
                description: test.description,
                error: error.message
            });
        }
    }

    validateTest(test, result) {
        const validation = {
            passed: true,
            actual: {},
            issues: []
        };

        // Get the actual processed parameters
        const actualParams = this.puter.lastCall ? 
            this.puter.processParameters(this.puter.lastCall.args) : {};

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
        if (test.expected_response && result) {
            if (!result.message || !result.usage) {
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
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`✅ Passed: ${this.passed}`);
        console.log(`❌ Failed: ${this.failed}`);
        console.log(`⏭️  Skipped: ${this.skipped}`);
        console.log(`📈 Total: ${this.passed + this.failed + this.skipped}`);
        console.log(`📊 Success Rate: ${((this.passed / (this.passed + this.failed + this.skipped)) * 100).toFixed(1)}%`);

        if (this.failed > 0) {
            console.log('\n❌ FAILED TESTS:');
            this.testResults
                .filter(r => r.status === 'FAILED')
                .forEach(result => {
                    console.log(`   - ${result.name}: ${result.issues.join(', ')}`);
                });
        }

        if (this.testResults.some(r => r.status === 'ERROR')) {
            console.log('\n💥 TESTS WITH ERRORS:');
            this.testResults
                .filter(r => r.status === 'ERROR')
                .forEach(result => {
                    console.log(`   - ${result.name}: ${result.error}`);
                });
        }
    }

    generateReport() {
        const report = {
            summary: {
                total: this.passed + this.failed + this.skipped,
                passed: this.passed,
                failed: this.failed,
                skipped: this.skipped,
                successRate: (this.passed / (this.passed + this.failed + this.skipped)) * 100
            },
            results: this.testResults,
            timestamp: new Date().toISOString()
        };

        const reportDir = path.join(__dirname, 'results');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const reportFile = path.join(reportDir, `chat-api-test-report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        console.log(`\n📄 Test report saved to: ${reportFile}`);
        return reportFile;
    }
}

// Main execution
async function main() {
    const runner = new ChatAPITestRunner();
    
    try {
        await runner.runTests();
        runner.generateReport();
        
        // Exit with appropriate code
        process.exit(runner.failed > 0 ? 1 : 0);
    } catch (error) {
        console.error('❌ Test runner failed:', error);
        process.exit(1);
    }
}

// Export for use in other test files
module.exports = {
    ChatAPITestRunner,
    MockPuterAI
};

// Run if this file is executed directly
if (require.main === module) {
    main();
}
