#!/bin/bash

# Puter.js AI Chat API Test Runner Script
# This script runs the test suite and provides a summary

set -e  # Exit on any error

echo "Puter.js AI Chat API Test Runner"
echo "=========================================="

# Check Node.js version
NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 16 ]; then
    echo "Error: Node.js 16.0.0 or higher is required"
    echo "Current version: $(node --version 2>/dev/null || echo 'Not installed')"
    echo "Please update Node.js and try again"
    exit 1
fi
echo "Node.js version: $(node --version)"

# Check if we're in the right directory
if [ ! -f "chat-api.test.js" ]; then
    echo "Error: chat-api.test.js not found"
    echo "Please run this script from the test directory"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Running test suite..."
TEST_OUTPUT=$(npm test 2>&1)
TEST_EXIT_CODE=$?

echo "$TEST_OUTPUT"

# Display summary based on exit code
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "All tests passed successfully!"
else
    echo ""
    echo "Some tests failed. Check the output above for details."
fi

exit $TEST_EXIT_CODE
