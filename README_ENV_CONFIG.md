# Puter Centralized Environment Configuration - Feature Documentation

## 🎯 Quick Start

```bash
# 1. Create .env file
cp .env.example .env

# 2. Edit with your settings
echo "PUTER_DOMAIN=puter.example.com" >> .env
echo "SSL_ENABLED=true" >> .env
echo "PUTER_API_ROUTING=path" >> .env

# 3. Start Puter
npm start

# Puter will automatically apply configuration from .env
```

## ✨ What's New

Puter now supports **centralized environment-based configuration** through `.env` files and environment variables. This replaces the need to manually edit complex `config.json` files.

### Key Benefits

- ✅ **Simplified Setup** - Just 3-4 environment variables
- ✅ **CI/CD Friendly** - Perfect for Docker, Kubernetes, cloud deployments
- ✅ **Flexible Routing** - Choose between subdomain (api.example.com) or path-based (/api) APIs
- ✅ **Production Ready** - Supports complex deployments, SSL, reverse proxies
- ✅ **Backward Compatible** - Existing config.json files still work
- ✅ **Well Documented** - Comprehensive guides and examples

## 📖 Documentation

### For Users

- **[ENV_CONFIGURATION.md](doc/ENV_CONFIGURATION.md)** - Complete configuration guide
  - Environment variable reference
  - Common deployment scenarios
  - Troubleshooting guide
  - Migration instructions

- **[Example .env Files](.env.*)** - Ready-to-use templates
  - `.env.development` - Local development
  - `.env.selfhosted` - Simple self-hosted setup
  - `.env.production` - Production with reverse proxy
  - `.env.production-subdomains` - Production with subdomains
  - `.env.docker` - Docker/Kubernetes deployment

### For Testers

- **[TESTING_ENV_CONFIG.md](doc/TESTING_ENV_CONFIG.md)** - Comprehensive testing guide
  - Step-by-step test scenarios
  - Manual testing procedures
  - Debugging tips
  - Test checklist

### For Developers

- **[ENV_CONFIG_IMPLEMENTATION.md](doc/ENV_CONFIG_IMPLEMENTATION.md)** - Implementation details
  - Architecture overview
  - Configuration loading pipeline
  - Integration points
  - Contributing guidelines

## 🚀 Common Scenarios

### Local Development

```bash
PUTER_DOMAIN=puter.localhost
SSL_ENABLED=false
PUTER_API_ROUTING=subdomain
PORT=4100
NODE_ENV=dev
```

### Production with Path-based API

```bash
PUTER_DOMAIN=puter.example.com
SSL_ENABLED=true
PUTER_API_ROUTING=path
PORT=4000
PUBLIC_PORT=443
NODE_ENV=production
```

### Docker Deployment

```bash
docker run -e PUTER_DOMAIN=puter.example.com \
           -e SSL_ENABLED=true \
           -e PUTER_API_ROUTING=path \
           puter:latest
```

## 📋 Configuration Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `PUTER_DOMAIN` | Main domain for Puter | `puter.example.com` |

### Optional (with Defaults)

| Variable | Default | Options |
|----------|---------|---------|
| `SSL_ENABLED` | `false` | `true`, `false` |
| `PUTER_API_ROUTING` | `subdomain` | `subdomain`, `path` |
| `PORT` | `auto` | `auto` or port number |
| `PUBLIC_PORT` | Depends on protocol | port number |
| `NODE_ENV` | `dev` | `dev`, `prod`, `staging`, `test` |
| `SERVER_ID` | `puter-server` | Any string |
| `CONTACT_EMAIL` | `hey@{domain}` | Email address |

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run only EnvConfigParser tests
npm test -- src/backend/src/config/EnvConfigParser.test.js

# Run with coverage
npm test -- --coverage
```

### Verify Installation

```bash
# Run verification script
bash verify-env-config.sh

# This checks:
# ✓ All required files are present
# ✓ EnvConfigParser is correctly integrated
# ✓ Configuration parsing works
# ✓ Documentation is complete
```

### Manual Testing

See [TESTING_ENV_CONFIG.md](doc/TESTING_ENV_CONFIG.md) for detailed step-by-step scenarios.

## 💻 How It Works

### Configuration Loading Pipeline

```
1. DEFAULT CONFIG
   (hardcoded defaults)
   ↓
2. CONFIG FILE
   (config.json if exists)
   ↓
3. ENV CONFIG
   (.env or environment variables)
   ↓
4. COMPUTED DEFAULTS
   (origin, api_base_url, etc.)
   ↓
5. FINAL CONFIGURATION
```

### Priority Order

1. **Environment Variables** (highest priority)
2. **.env File**
3. **config.json**
4. **Hardcoded Defaults** (lowest priority)

## 🔄 Migration Guide

### From config.json to .env

**Before:**
```json
{
  "domain": "puter.example.com",
  "protocol": "https",
  "http_port": 4000,
  "experimental_no_subdomain": false
}
```

**After:**
```bash
PUTER_DOMAIN=puter.example.com
SSL_ENABLED=true
PORT=4000
PUTER_API_ROUTING=subdomain
```

### Keep Both (Gradual Migration)

- Environment variables override config.json
- Allows gradual rollout
- Can test new setup without removing old config

### Revert if Needed

Simply remove `.env` or unset environment variables to use config.json exclusively.

## 🐛 Troubleshooting

### Configuration not applied?

```bash
# Check 1: Is PUTER_DOMAIN set?
echo $PUTER_DOMAIN

# Check 2: Is .env in the right place?
ls -la .env

# Check 3: Check console output
npm start 2>&1 | grep -i "environment\|config"
```

### API not reachable?

```bash
# Check 1: Which routing mode are you using?
grep PUTER_API_ROUTING .env

# Check 2: For subdomain, verify DNS
ping api.example.com

# Check 3: For path mode, verify main domain works
curl https://example.com
```

See [ENV_CONFIGURATION.md](doc/ENV_CONFIGURATION.md) for more troubleshooting tips.

## 📦 Files Created/Modified

### New Files

- `src/backend/src/config/EnvConfigParser.js` - Main parser
- `src/backend/src/config/EnvConfigParser.test.js` - Unit tests (60+)
- `.env.example` - Configuration template
- `.env.development`, `.env.production`, etc. - Example setups
- `doc/ENV_CONFIGURATION.md` - User guide
- `doc/TESTING_ENV_CONFIG.md` - Testing guide
- `doc/ENV_CONFIG_IMPLEMENTATION.md` - Implementation details
- `verify-env-config.sh` - Verification script

### Modified Files

- `src/backend/src/boot/RuntimeEnvironment.js` - Integrated EnvConfigParser
- `.env.example` - Updated with comprehensive documentation

## 🤝 Contributing

To add new environment variables or extend functionality:

1. Add parsing logic in `EnvConfigParser` class
2. Add unit tests in `EnvConfigParser.test.js`
3. Document in `.env.example`
4. Update `ENV_CONFIGURATION.md`

Example:
```javascript
// In EnvConfigParser
_parseCustomSetting(envVars) {
    return envVars.CUSTOM_SETTING || 'default';
}

config.custom_setting = this._parseCustomSetting(envVars);
```

## ❓ FAQ

**Q: Will this break my existing setup?**
A: No. The env config only applies if `PUTER_DOMAIN` is explicitly set. Existing configs continue to work.

**Q: Can I use both config.json and .env?**
A: Yes. Environment variables override config.json settings.

**Q: Is this production-ready?**
A: Yes. It's fully tested, documented, and backward compatible.

**Q: What about Kubernetes/Docker?**
A: Perfect. All environment variables work with container orchestration.

**Q: How do I use this with a reverse proxy?**
A: Set `PORT` for internal port, `PUBLIC_PORT` for external (exposed) port.

## 📊 Implementation Status

- ✅ Configuration parser implemented
- ✅ Boot integration complete
- ✅ 60+ unit tests written
- ✅ Comprehensive documentation
- ✅ Example configurations
- ✅ Testing guide
- ✅ Verification script
- ✅ Backward compatibility verified

## 🔗 Related Documentation

- [Puter Installation Guide](install.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Production Deployment Guide](doc/prod.md)

## 📝 License

This feature is part of Puter, licensed under AGPL-3.0-only.
See [LICENSE.txt](LICENSE.txt) for details.

---

**Ready to try it?** Start with `.env.example` and choose a scenario that matches your deployment!

For questions or issues, refer to the documentation above or open an issue on GitHub.
