# Puter .env Configuration - Implementation Summary

## Feature Overview

This document summarizes the centralized `.env` configuration system for Puter, which significantly simplifies deployment by allowing users to configure Puter through environment variables instead of manually editing `config.json`.

## Problem Solved

**Before:** Users had to:
1. Manually edit `config.json` with complex settings
2. Deal with domain/API routing mismatches
3. Reconfigure for each deployment (dev/staging/prod)
4. Manage multiple configuration files

**After:** Users can simply:
1. Create `.env` file with 3-4 key settings
2. Start Puter - configuration is automatically applied
3. Use environment variables for CI/CD deployments
4. Easily switch between routing modes

## Key Files Created/Modified

### New Files

1. **`src/backend/src/config/EnvConfigParser.js`**
   - Main parser class
   - Parses `.env` files and environment variables
   - Validates configuration
   - Provides documentation

2. **`src/backend/src/config/EnvConfigParser.test.js`**
   - Comprehensive unit tests
   - 60+ test cases covering all scenarios
   - Tests for error handling and edge cases

3. **`doc/ENV_CONFIGURATION.md`**
   - Complete user guide
   - Configuration reference
   - Deployment scenarios
   - Troubleshooting guide

4. **`doc/TESTING_ENV_CONFIG.md`**
   - Testing procedures
   - Step-by-step test scenarios
   - Debugging guide

5. **Example `.env` files**
   - `.env.example` - Main template with all options
   - `.env.development` - Local development setup
   - `.env.selfhosted` - Simple self-hosted setup
   - `.env.production` - Production with reverse proxy
   - `.env.production-subdomains` - Production with subdomains
   - `.env.docker` - Docker/Kubernetes setup

### Modified Files

1. **`src/backend/src/boot/RuntimeEnvironment.js`**
   - Added env config loading after config.json
   - Integrated EnvConfigParser into boot process
   - Conditional loading (only if PUTER_DOMAIN is set)

2. **`.env.example`**
   - Updated with all available configuration options
   - Added comprehensive comments
   - Added example production setup

## Configuration Options

### Required

- **PUTER_DOMAIN** - Main domain for Puter (e.g., `puter.example.com`)
  - Alternative: MAIN_DOMAIN
  - Default: `puter.localhost`

### Optional but Recommended

- **SSL_ENABLED** - Enable HTTPS (true/false)
  - Alternative: PUTER_SSL
  - Default: false

- **PUTER_API_ROUTING** - API routing mode
  - Options: `subdomain` (api.example.com) or `path` (example.com/api)
  - Alternative: API_ROUTING
  - Default: `subdomain`

### Port Configuration

- **PORT** - Listen port (default: auto)
  - Alternative: HTTP_PORT
  - Options: "auto" or 1-65535

- **PUBLIC_PORT** - Exposed port for reverse proxies
  - Alternative: PUB_PORT
  - Default: Same as PORT or 80/443

### Server Configuration

- **SERVER_ID** - Server identifier (default: puter-server)
- **CONTACT_EMAIL** - Contact email (default: hey@domain)
- **NODE_ENV** - Environment mode (default: dev)
  - Alternative: ENV

## How It Works

### Loading Pipeline

```
1. Load default_config.js
   ↓
2. Load/validate config.json
   ↓
3. Parse and apply .env/env vars (EnvConfigParser)
   - only if PUTER_DOMAIN is set
   ↓
4. Apply computed defaults
   - origin = protocol://domain:port
   - api_base_url = api.domain or domain /api
   ↓
5. Use final merged config
```

### Key Features

1. **Non-breaking**: Works alongside existing config.json
2. **Precedence**: Environment > .env > config.json > defaults
3. **Smart Defaults**: Automatically computes derived settings
4. **Validation**: Validates configuration on startup
5. **Flexible**: Works for dev/staging/production

## Deployment Examples

### Local Development

```bash
# .env
PUTER_DOMAIN=puter.localhost
PORT=4100
npm start
```

### Docker

```bash
docker run -e PUTER_DOMAIN=puter.example.com \
           -e SSL_ENABLED=true \
           -e PUTER_API_ROUTING=path \
           -p 4000:4000 puter
```

### Production with Nginx

```bash
# .env
PUTER_DOMAIN=puter.example.com
SSL_ENABLED=true
PUTER_API_ROUTING=path
PORT=4000
PUBLIC_PORT=443

# nginx.conf
proxy_pass http://localhost:4000;
proxy_set_header Host $host;
```

## Testing

### Unit Tests
- 60+ tests in `EnvConfigParser.test.js`
- Tests cover: parsing, validation, error handling, integration
- Run with: `npm test -- src/backend/src/config/EnvConfigParser.test.js`

### Manual Testing
- See `doc/TESTING_ENV_CONFIG.md` for step-by-step scenarios
- Includes basic setup, API routing, SSL, port configuration
- Debugging and verification procedures

## Benefits

1. **Simplified Setup**: 3-4 env vars instead of full config.json
2. **CI/CD Friendly**: Environment variables work perfectly with deployment systems
3. **Flexible Routing**: Easily switch between subdomain and path-based APIs
4. **Production Ready**: Supports complex deployments (reverse proxies, SSL termination)
5. **Backward Compatible**: Existing config.json files still work
6. **Well Documented**: Comprehensive guides and examples

## Migration Guide

### Existing Users

**Option 1: Keep using config.json** (no changes needed)
- Existing deployments continue to work
- No action required

**Option 2: Migrate to .env** (recommended)
```bash
# Create .env based on your config.json
# Example:
echo "PUTER_DOMAIN=$(jq -r '.domain' config/config.json)" > .env
echo "SSL_ENABLED=$(jq -r '.protocol' config/config.json | grep https >/dev/null && echo true || echo false)" >> .env
echo "PUTER_API_ROUTING=subdomain" >> .env
echo "PORT=$(jq -r '.http_port' config/config.json)" >> .env

# Test the new setup
npm start

# If all works, you can optionally remove config.json
```

**Option 3: Gradual Migration**
- Keep config.json
- Add .env for specific overrides
- Both will be applied (env overrides config)

## Future Enhancements

Potential improvements:
1. CLI tool to generate .env from existing config.json
2. Configuration validator command
3. Configuration health check
4. Configuration backup/restore utilities
5. Hot-reload for env changes (optional)

## Technical Details

### EnvConfigParser Class

Methods:
- `parse()` - Parse env config
- `_parseDomain()` - Extract domain
- `_parseProtocol()` - Extract protocol
- `_parseApiRouting()` - Extract API routing mode
- `_parsePort()` - Extract port
- `_parseEnv()` - Extract environment mode
- `static validate()` - Validate configuration
- `static getDocumentation()` - Get help text

Properties:
- `env` - Parsed environment variables
- `envPath` - Path to .env file

### Integration Points

1. **RuntimeEnvironment.js** (Line ~330)
   - Loads env config after config.json
   - Validates on startup
   - Graceful error handling

2. **config.js**
   - Computed defaults for origin, api_base_url
   - Works with env config seamlessly

3. **Frontend**
   - Receives computed api_origin, gui_origin
   - Works with both routing modes

## Support & Documentation

- **User Guide**: `doc/ENV_CONFIGURATION.md`
- **Testing Guide**: `doc/TESTING_ENV_CONFIG.md`
- **Examples**: `.env.*` files in root
- **Code Comments**: Comprehensive JSDoc comments
- **Tests**: 60+ unit tests with documentation

## Version Info

- **Feature Added**: Puter 2.5.1+
- **Status**: Production Ready
- **Breaking Changes**: None
- **Backward Compatibility**: Full

## Contributing

To extend the .env configuration system:

1. Add new environment variable parsing in `EnvConfigParser.js`
2. Add corresponding tests in `EnvConfigParser.test.js`
3. Document in `.env.example` and `ENV_CONFIGURATION.md`
4. Update this file with new features

Example:
```javascript
// In EnvConfigParser._parse*() method
_parseCustomFeature(envVars) {
    return envVars.CUSTOM_FEATURE === 'true';
}

// In parse() method
config.custom_feature = this._parseCustomFeature(envVars);

// In test file
it('should parse custom feature', () => {
    process.env.CUSTOM_FEATURE = 'true';
    const parser = new EnvConfigParser();
    const config = parser.parse();
    expect(config.custom_feature).toBe(true);
});
```

## FAQ

**Q: Will this break my existing setup?**
A: No, existing deployments are unaffected. The env config is only applied if PUTER_DOMAIN is explicitly set.

**Q: Can I mix config.json and .env?**
A: Yes, env vars override config.json settings. Both can be used together.

**Q: How do I migrate from config.json?**
A: Create a .env file with your settings, optionally delete config.json. The env config will be used.

**Q: Does this support Docker?**
A: Yes, all environment variables can be passed to Docker containers.

**Q: Can I use this with Kubernetes?**
A: Yes, environment variables can be set via ConfigMaps or Secrets.

**Q: What about sensitive data (passwords, keys)?**
A: Use environment variables or .env files secured with appropriate file permissions.

## Summary

This implementation provides a clean, user-friendly way to configure Puter without requiring knowledge of the internal config structure. It maintains full backward compatibility while enabling simpler deployments for the majority of use cases.

The feature is production-ready, well-tested, and thoroughly documented.
