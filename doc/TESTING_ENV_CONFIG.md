# Environment Configuration Testing Guide

This guide provides step-by-step instructions to test the new `.env` configuration system.

## Test Environment Setup

### Prerequisites
- Node.js 16+
- Puter source code cloned
- npm dependencies installed: `npm install`

## Testing Scenarios

### Test 1: Basic Environment Configuration (Dev Setup)

**Goal**: Verify that environment variables are correctly parsed and applied

```bash
# Step 1: Clear any existing config
rm -f config/config.json

# Step 2: Set environment variables
export PUTER_DOMAIN=test.localhost
export SSL_ENABLED=false
export PUTER_API_ROUTING=subdomain
export PORT=4100
export NODE_ENV=dev

# Step 3: Start Puter
npm start

# Expected output in console:
# - "Applying environment configuration from .env or ENV vars"
# - Server starts on port 4100
# - No errors related to configuration

# Step 4: Verify configuration was applied
# Check config/config.json:
cat config/config.json | grep -E '"domain"|"protocol"|"http_port"'
# Expected output:
# "domain": "test.localhost",
# "protocol": "http",
# "http_port": 4100,
```

### Test 2: .env File Loading

**Goal**: Verify that .env file is correctly parsed

```bash
# Step 1: Create .env file
cat > .env << 'EOF'
PUTER_DOMAIN=puter.test.local
SSL_ENABLED=true
PUTER_API_ROUTING=path
PORT=4000
PUBLIC_PORT=443
NODE_ENV=production
EOF

# Step 2: Unset environment variables to test .env file
unset PUTER_DOMAIN
unset SSL_ENABLED
unset PUTER_API_ROUTING
unset PORT
unset NODE_ENV

# Step 3: Start Puter
npm start

# Expected:
# - Configuration loaded from .env file
# - console shows: "Applying environment configuration from .env..."
# - Protocol is https
# - API uses path mode (/api)
```

### Test 3: Environment Variables Override .env File

**Goal**: Verify precedence: env vars > .env file > defaults

```bash
# Step 1: Create .env file with one value
cat > .env << 'EOF'
PUTER_DOMAIN=fromenv.local
SSL_ENABLED=false
EOF

# Step 2: Set environment variable that conflicts
export PUTER_DOMAIN=fromvar.local

# Step 3: Start Puter
npm start

# Expected:
# - PUTER_DOMAIN=fromvar.local (environment variable wins)
# - SSL_ENABLED=false (from .env file)
# - Check config.json to confirm
```

### Test 4: Subdomain API Routing

**Goal**: Verify subdomain-based API routing works correctly

```bash
# Step 1: Configure subdomain mode
export PUTER_DOMAIN=example.local
export PUTER_API_ROUTING=subdomain
export SSL_ENABLED=false

# Step 2: Start Puter
npm start

# Step 3: Verify configuration
# Check config.json:
grep -E 'experimental_no_subdomain|api_base_url' config/config.json
# Expected:
# "experimental_no_subdomain": false,
# "api_base_url": "http://api.example.local",

# Step 4: Test API access
# In another terminal:
curl http://api.example.local:4100/auth/get-core/account
# Should get a response (with or without auth token)
```

### Test 5: Path-based API Routing

**Goal**: Verify path-based (domain.com/api) routing works correctly

```bash
# Step 1: Configure path mode
export PUTER_DOMAIN=example.local
export PUTER_API_ROUTING=path
export SSL_ENABLED=false
export PORT=4100

# Step 2: Start Puter
npm start

# Step 3: Verify configuration
# Check config.json:
grep -E 'experimental_no_subdomain|api_base_url' config/config.json
# Expected:
# "experimental_no_subdomain": true,
# "api_base_url": "http://example.local:4100",

# Step 4: Test API access
# In another terminal:
curl http://example.local:4100/api/auth/get-core/account
# Should get a response
```

### Test 6: SSL Configuration

**Goal**: Verify SSL settings are correctly applied

```bash
# Step 1: Enable SSL
export PUTER_DOMAIN=secure.local
export SSL_ENABLED=true
export PORT=4000

# Step 2: Start Puter
npm start

# Step 3: Verify configuration
# Check config.json:
grep -E '"protocol"|"nginx_mode"' config/config.json
# Expected:
# "protocol": "https",
# "nginx_mode": false,

# Note: Actual HTTPS won't work without valid certificates
# This test just verifies the configuration is correct
```

### Test 7: Port Configuration

**Goal**: Verify port settings work correctly

```bash
# Test 7a: Fixed port
export PUTER_DOMAIN=example.local
export PORT=5000

npm start
# Should start on port 5000

# Test 7b: Auto port
export PUTER_DOMAIN=example.local
unset PORT

npm start
# Should automatically find available port between 4100-4119
# Check console for "started on port XXXX"

# Test 7c: Public port (for reverse proxies)
export PUTER_DOMAIN=example.local
export PORT=4000
export PUBLIC_PORT=443

npm start
# Internal port: 4000
# External port in config: 443
```

### Test 8: Invalid Configuration Handling

**Goal**: Verify error handling for invalid configurations

```bash
# Test 8a: Invalid port number
export PUTER_DOMAIN=example.local
export PORT=99999
npm start
# Expected: Error message about invalid port

# Test 8b: Invalid SSL value (should still work with false as default)
export PUTER_DOMAIN=example.local
export SSL_ENABLED=invalid-value
npm start
# Expected: Works (treats as false)

# Test 8c: Invalid API routing mode
export PUTER_DOMAIN=example.local
export PUTER_API_ROUTING=invalid-mode
npm start
# Expected: Error about invalid API_ROUTING
```

### Test 9: Configuration Persistence

**Goal**: Verify config.json is created and persists correctly

```bash
# Step 1: Start with environment config
export PUTER_DOMAIN=persist.local
export SSL_ENABLED=true
export PORT=4080
npm start &
# Wait for startup
sleep 5

# Step 2: Check config.json was created
cat config/config.json | jq '.domain, .protocol, .http_port'
# Expected:
# "persist.local"
# "https"
# 4080

# Step 3: Stop server
killall node 2>/dev/null || true

# Step 4: Unset environment variables
unset PUTER_DOMAIN
unset SSL_ENABLED
unset PORT

# Step 5: Start again (should use config.json)
npm start &
sleep 5

# Step 6: Verify configuration persisted
cat config/config.json | jq '.domain, .protocol, .http_port'
# Expected: Same values as before

killall node 2>/dev/null || true
```

### Test 10: Different Domains

**Goal**: Verify system works with various domain formats

```bash
# Test various domain formats
declare -a domains=(
    "localhost"
    "puter.local"
    "my-puter.example.com"
    "192.168.1.100"
    "cloud.internal"
)

for domain in "${domains[@]}"; do
    export PUTER_DOMAIN="$domain"
    
    # Quick validation (don't start full server)
    node -e "
        const EnvConfigParser = require('./src/backend/src/config/EnvConfigParser.js');
        try {
            const parser = new EnvConfigParser();
            const config = parser.parse();
            console.log('✓ Domain $domain: OK');
        } catch(e) {
            console.error('✗ Domain $domain: FAILED -', e.message);
        }
    "
done
```

## Automated Test Execution

### Run Unit Tests

```bash
# Run all tests
npm test

# Run only EnvConfigParser tests
npm test -- src/backend/src/config/EnvConfigParser.test.js

# Run tests with coverage
npm test -- --coverage
```

### Test File Locations

- **Unit Tests**: `src/backend/src/config/EnvConfigParser.test.js`
- **Integration**: Manual testing using scenarios above

## Frontend Configuration Verification

### Test Frontend Receives Correct Origins

```bash
# Start Puter with specific configuration
export PUTER_DOMAIN=test.local
export PUTER_API_ROUTING=path
export PORT=4100
npm start &

# Wait for startup
sleep 5

# Access the GUI and check window variables
google-chrome http://localhost:4100/

# In browser console, check:
# > window.api_origin
# > window.gui_origin
# > window.config.origin

# Expected for path mode:
# window.api_origin = "http://test.local:4100"
# window.gui_origin = "http://test.local:4100"

killall node 2>/dev/null || true
```

## Debugging

### View Parsed Configuration

```bash
# Create a debug script
cat > test-config-parser.js << 'EOF'
const EnvConfigParser = require('./src/backend/src/config/EnvConfigParser.js');

// Set environment for testing
process.env.PUTER_DOMAIN = 'debug.local';
process.env.SSL_ENABLED = 'true';
process.env.PUTER_API_ROUTING = 'path';
process.env.PORT = '4000';

const parser = new EnvConfigParser();
const config = parser.parse();

console.log('Parsed Configuration:');
console.log(JSON.stringify(config, null, 2));
EOF

node test-config-parser.js
```

### Trace Configuration Loading

```bash
# Add debug logging to see config loading
DEBUG=puter:config npm start 2>&1 | grep -i config

# Or check the generated config.json
cat config/config.json | jq . | head -50
```

## Test Checklist

- [ ] Basic env var parsing works
- [ ] .env file is read correctly
- [ ] Environment variables override .env file
- [ ] Subdomain routing configured correctly
- [ ] Path-based routing configured correctly
- [ ] SSL protocol set correctly
- [ ] Ports configured correctly
- [ ] Invalid configurations raise errors
- [ ] config.json is created/persisted
- [ ] Frontend receives correct origins
- [ ] API requests work with configured routing
- [ ] Domain names work with various formats
- [ ] configuration documentation is clear

## Custom Test Harness

Create `.env.test` for testing:

```bash
#!/bin/bash
# Quick test harness

set -e

cleanup() {
    echo "Cleaning up..."
    killall node 2>/dev/null || true
    rm -f config/config.json
}

trap cleanup EXIT

run_test() {
    local name=$1
    shift
    echo ""
    echo "=== Test: $name ==="
    "$@"
}

# Test 1: Basic config
run_test "Basic Config" bash -c '
    export PUTER_DOMAIN=test1.local
    export PORT=5000
    timeout 10 npm start 2>&1 | grep -E "Applying|started|error" || true
'

# Add more tests...

echo ""
echo "All tests completed!"
```

Run with: `bash .env.test`

## Reporting Issues

When reporting configuration-related issues, include:

1. Your `.env` file (without sensitive data)
2. Generated `config.json`
3. Console output during startup
4. Environment where you're running Puter
5. What you expected vs. what happened
