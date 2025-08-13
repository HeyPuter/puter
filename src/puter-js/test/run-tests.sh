#!/bin/bash

# Puter.js AI Chat API Test Runner Script
# This script runs the test suite and provides a summary

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Puter.js AI Chat API Test Runner${NC}"
echo "=========================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 16+ and try again.${NC}"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${RED}❌ Node.js version 16+ is required. Current version: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js version: $(node -v)${NC}"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found. Please run this script from the test directory.${NC}"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Run the tests
echo -e "${BLUE}🧪 Running test suite...${NC}"
echo ""

# Run tests and capture output
TEST_OUTPUT=$(npm test 2>&1)
TEST_EXIT_CODE=$?

# Display test output
echo "$TEST_OUTPUT"

# Check test results
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed!${NC}"
    
    # Check if results directory exists and show report info
    if [ -d "results" ]; then
        LATEST_REPORT=$(ls -t results/chat-api-test-report-*.json 2>/dev/null | head -1)
        if [ -n "$LATEST_REPORT" ]; then
            echo -e "${BLUE}📄 Test report generated: ${LATEST_REPORT}${NC}"
        fi
    fi
else
    echo -e "\n${RED}❌ Some tests failed. Check the output above for details.${NC}"
    
    # Show failed test summary if available
    if [ -d "results" ]; then
        LATEST_REPORT=$(ls -t results/chat-api-test-report-*.json 2>/dev/null | head -1)
        if [ -n "$LATEST_REPORT" ]; then
            echo -e "${YELLOW}📊 Check the detailed report: ${LATEST_REPORT}${NC}"
        fi
    fi
fi

echo ""
echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}Test run completed with exit code: $TEST_EXIT_CODE${NC}"

exit $TEST_EXIT_CODE
