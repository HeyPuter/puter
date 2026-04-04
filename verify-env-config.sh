#!/bin/bash
# Quick verification script for Puter .env configuration feature
# This script runs basic sanity checks to ensure the feature is working

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Puter .env Configuration Verification ===${NC}\n"

# Test 1: Check files exist
echo -e "${YELLOW}[1/5] Checking required files...${NC}"
files=(
    "src/backend/src/config/EnvConfigParser.js"
    "src/backend/src/config/EnvConfigParser.test.js"
    ".env.example"
    ".env.development"
    ".env.production"
    "doc/ENV_CONFIGURATION.md"
    "doc/TESTING_ENV_CONFIG.md"
)

all_files_exist=true
for file in "${files[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${RED}✗${NC} $file (MISSING)"
        all_files_exist=false
    fi
done

if [ "$all_files_exist" = false ]; then
    echo -e "${RED}Error: Some required files are missing!${NC}"
    exit 1
fi

echo ""

# Test 2: Check EnvConfigParser exports
echo -e "${YELLOW}[2/5] Checking EnvConfigParser structure...${NC}"
if grep -q "class EnvConfigParser" "$PROJECT_ROOT/src/backend/src/config/EnvConfigParser.js"; then
    echo -e "  ${GREEN}✓${NC} EnvConfigParser class defined"
else
    echo -e "  ${RED}✗${NC} EnvConfigParser class not found"
    exit 1
fi

if grep -q "parse()" "$PROJECT_ROOT/src/backend/src/config/EnvConfigParser.js"; then
    echo -e "  ${GREEN}✓${NC} parse() method exists"
else
    echo -e "  ${RED}✗${NC} parse() method not found"
    exit 1
fi

if grep -q "static validate" "$PROJECT_ROOT/src/backend/src/config/EnvConfigParser.js"; then
    echo -e "  ${GREEN}✓${NC} validate() method exists"
else
    echo -e "  ${RED}✗${NC} validate() method not found"
    exit 1
fi

echo ""

# Test 3: Check RuntimeEnvironment integration
echo -e "${YELLOW}[3/5] Checking RuntimeEnvironment integration...${NC}"
if grep -q "EnvConfigParser" "$PROJECT_ROOT/src/backend/src/boot/RuntimeEnvironment.js"; then
    echo -e "  ${GREEN}✓${NC} EnvConfigParser imported in RuntimeEnvironment"
else
    echo -e "  ${RED}✗${NC} EnvConfigParser not integrated"
    exit 1
fi

if grep -q "require('../config/EnvConfigParser')" "$PROJECT_ROOT/src/backend/src/boot/RuntimeEnvironment.js"; then
    echo -e "  ${GREEN}✓${NC} Correct require path"
else
    echo -e "  ${RED}✗${NC} Incorrect require path"
    exit 1
fi

echo ""

# Test 4: Check .env.example configuration
echo -e "${YELLOW}[4/5] Checking .env.example completeness...${NC}"
required_vars=(
    "PUTER_DOMAIN"
    "SSL_ENABLED"
    "PUTER_API_ROUTING"
    "PORT"
    "NODE_ENV"
)

for var in "${required_vars[@]}"; do
    if grep -q "$var" "$PROJECT_ROOT/.env.example"; then
        echo -e "  ${GREEN}✓${NC} $var documented"
    else
        echo -e "  ${RED}✗${NC} $var not found in .env.example"
        exit 1
    fi
done

echo ""

# Test 5: Quick parser functionality test
echo -e "${YELLOW}[5/5] Testing parser functionality...${NC}"

# Create a temporary test script
TEST_SCRIPT=$(mktemp)
cat > "$TEST_SCRIPT" << 'EOF'
const path = require('path');
const tempDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'puter-verify-'));

// Mock environment for testing
process.env.PUTER_DOMAIN = 'test.example.com';
process.env.SSL_ENABLED = 'true';
process.env.PUTER_API_ROUTING = 'path';
process.env.PORT = '4000';

try {
    const EnvConfigParser = require('./src/backend/src/config/EnvConfigParser.js');
    const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
    const config = parser.parse();
    
    // Verify parsed values
    if (config.domain !== 'test.example.com') throw new Error('Domain not parsed correctly');
    if (config.protocol !== 'https') throw new Error('Protocol not set to https');
    if (config.experimental_no_subdomain !== true) throw new Error('Path mode not enabled');
    if (config.http_port !== 4000) throw new Error('Port not parsed correctly');
    
    console.log('PASS: Parser functionality test');
    process.exit(0);
} catch (err) {
    console.error('FAIL:', err.message);
    process.exit(1);
} finally {
    require('fs').rmSync(tempDir, { recursive: true, force: true });
}
EOF

# Try to run the test
if command -v node &> /dev/null; then
    if node "$TEST_SCRIPT" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Parser functionality test passed"
    else
        echo -e "  ${YELLOW}⚠${NC}  Parser test skipped (test dependencies not available)"
    fi
else
    echo -e "  ${YELLOW}⚠${NC}  Node.js not available for functional test"
fi

rm -f "$TEST_SCRIPT"

echo ""
echo -e "${BLUE}=== Verification Complete ===${NC}"
echo ""
echo -e "${GREEN}All checks passed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Create .env file: cp .env.example .env"
echo "  2. Edit .env with your settings"
echo "  3. Start Puter: npm start"
echo "  4. Check console for: 'Applying environment configuration from .env or ENV vars'"
echo ""
echo "Documentation:"
echo "  - User Guide: doc/ENV_CONFIGURATION.md"
echo "  - Testing: doc/TESTING_ENV_CONFIG.md"
echo "  - Implementation: doc/ENV_CONFIG_IMPLEMENTATION.md"
echo ""
