# Puter.js AI Chat API Test Suite

This directory contains comprehensive regression tests for the `puter.ai.chat()` method based on the test cases defined in `spec/chat-api-test-cases.yaml`.

## Overview

The test suite validates all aspects of the chat API including:
- Basic text chat functionality
- Vision capabilities with images
- Conversation arrays and message handling
- Parameter processing and validation
- Model mapping and driver selection
- Error handling and edge cases
- Response structure and convenience methods

## Test Structure

```
test/
├── spec/
│   └── chat-api-test-cases.yaml    # Test case definitions
├── chat-api.test.js                 # Main test runner
├── package.json                     # Test dependencies
├── README.md                        # This file
└── results/                         # Generated test reports (auto-created)
```

## Prerequisites

- Node.js 16.0.0 or higher
- npm or yarn package manager

## Installation

1. Navigate to the test directory:
   ```bash
   cd src/puter-js/test
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running Tests

### Basic Test Run
```bash
npm test
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### Generate Report
```bash
npm run test:report
```

## Test Categories

The test suite covers 8 main categories:

1. **Basic Text Chat** - Simple string prompts and test mode
2. **Vision Capabilities** - Image processing and vision mode detection
3. **Conversation Arrays** - Message arrays and string conversion
4. **Full Parameters Object** - Complete parameter specification
5. **Mixed Parameters** - Combined parameter formats
6. **Model Mapping** - Automatic model name conversion and driver selection
7. **Driver Override** - Manual driver selection
8. **Response Handling** - Response structure and convenience methods
9. **Error Handling** - Error cases and validation
10. **Performance Tests** - Large inputs and concurrency

## Test Output

The test runner provides:
- Real-time test progress with emojis and clear status indicators
- Detailed failure information with expected vs actual values
- Summary statistics (passed/failed/skipped counts)
- Success rate percentage
- JSON test reports for CI/CD integration

## Test Reports

After running tests, detailed reports are generated in the `results/` directory:
- `chat-api-test-report-{timestamp}.json` - Machine-readable test results
- Includes all test results, validation details, and timing information

## Mock Implementation

The test suite uses a `MockPuterAI` class that:
- Simulates the actual `puter.ai.chat()` method behavior
- Processes parameters according to the real implementation logic
- Validates input/output according to test case expectations
- Provides mock responses for testing

## Adding New Tests

To add new test cases:

1. Edit `spec/chat-api-test-cases.yaml`
2. Add new test cases to existing categories or create new ones
3. Follow the existing test case structure:
   ```yaml
   - name: "test_name"
     description: "Test description"
     input: "test input"
     expected:
       property: "expected_value"
     validation:
       - "Validation rule 1"
       - "Validation rule 2"
   ```

## Integration with CI/CD

The test suite:
- Exits with code 0 on success, 1 on failure
- Generates structured JSON reports
- Can be easily integrated with CI/CD pipelines
- Supports parallel execution (though currently disabled for stability)

## Troubleshooting

### Common Issues

1. **YAML parsing errors**: Ensure the test case YAML is valid
2. **Missing dependencies**: Run `npm install` to install required packages
3. **File path issues**: Ensure the test runner can access the spec file

### Debug Mode

To enable debug output, set the `DEBUG` environment variable:
```bash
DEBUG=* npm test
```

## Contributing

When adding new tests:
- Follow the existing naming conventions
- Include clear descriptions and validation rules
- Test both positive and negative cases
- Ensure tests are deterministic and repeatable

## License

MIT License - see package.json for details.
