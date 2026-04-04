# Puter Environment Configuration Guide

## Overview

Puter now supports centralized environment-based configuration through `.env` files and environment variables. This significantly simplifies deployment by eliminating the need to manually edit `config.json` files.

## Quick Start

### 1. Basic Setup

Create a `.env` file in the Puter root directory with your configuration:

```bash
# .env
PUTER_DOMAIN=puter.example.com
SSL_ENABLED=true
PUTER_API_ROUTING=path
PORT=4000
```

Then start Puter:
```bash
npm start
```

The system will automatically:
- Generate the appropriate `config.json` if needed
- Apply environment-based configuration on top of defaults
- Configure API routing optimally for your setup

### 2. Configuration Precedence

Configuration is loaded in this order (highest priority first):

1. **Environment Variables** (`process.env`)
   - Set via shell: `PUTER_DOMAIN=example.com node src/backend/index.js`
   - Defined in `.env` file
   
2. **Local Config Files** (`config.json` in config directory)
   - Takes precedence if PUTER_DOMAIN is NOT set
   - Falls back when environment variables are not defined

3. **Default Configuration** (hardcoded defaults)

## Environment Variables

### Main Domain (Required in .env mode)

```bash
# Option 1: PUTER_DOMAIN (recommended)
PUTER_DOMAIN=puter.example.com

# Option 2: MAIN_DOMAIN (alternative)
MAIN_DOMAIN=puter.example.com

# Default: puter.localhost
```

### SSL/Protocol Configuration

```bash
# Enable HTTPS
SSL_ENABLED=true              # or: 1, yes, TRUE (case-insensitive)
# or
PUTER_SSL=true

# Default: false (http)
```

**How it works:**
- `SSL_ENABLED=true` → Sets protocol to `https`
- `SSL_ENABLED=false` → Sets protocol to `http`
- `nginx_mode` is automatically set based on SSL setting

### API Routing Configuration

```bash
# Option 1: Subdomain-based (Production Recommended)
PUTER_API_ROUTING=subdomain
# Results in: api.example.com for API endpoints

# Option 2: Path-based (Simple setups)
PUTER_API_ROUTING=path
# Results in: example.com/api for API endpoints

# Default: subdomain
```

**When to use each:**
- **Subdomain**: Production setups, separate API servers, better scalability
- **Path**: Simple deployments, reverse proxies, sharing SSL certificates

### Port Configuration

```bash
# HTTP/HTTPS Listen Port
PORT=4000                     # or HTTP_PORT=4000
# Default: auto (tries ports 4100-4119)
# Options: "auto" or a number between 1-65535

# Public Port (for reverse proxies)
PUBLIC_PORT=443               # or PUB_PORT=443
# Default: Same as PORT, or 80/443 for auto
# Useful when: Running behind a reverse proxy or load balancer
```

### Server Configuration

```bash
# Server Identifier
SERVER_ID=puter-prod-1
# Default: puter-server

# Contact Email
CONTACT_EMAIL=admin@example.com
# Default: hey@{PUTER_DOMAIN}
```

### Environment Mode

```bash
# Environment Type
NODE_ENV=production           # or ENV=production
# Options: dev, prod, production, test, staging
# Default: dev
```

## Common Deployment Scenarios

### Scenario 1: Local Development

```bash
# .env
PUTER_DOMAIN=puter.localhost
SSL_ENABLED=false
PUTER_API_ROUTING=subdomain
PORT=4100
NODE_ENV=dev
```

**Result:**
- Frontend: `http://puter.localhost:4100`
- API: `http://api.puter.localhost:4100`
- Database: SQLite (default)

### Scenario 2: Simple Self-Hosted (Single Domain)

```bash
# .env
PUTER_DOMAIN=mycloud.local
SSL_ENABLED=true
PUTER_API_ROUTING=path
PORT=4000
PUBLIC_PORT=443
CONTACT_EMAIL=admin@mycloud.local
NODE_ENV=production
```

**Result:**
- Frontend: `https://mycloud.local:443`
- API: `https://mycloud.local:443/api`
- Certificate: Need to configure separately (nginx reverse proxy)

### Scenario 3: Production with Subdomains

```bash
# .env
PUTER_DOMAIN=example.com
SSL_ENABLED=true
PUTER_API_ROUTING=subdomain
PORT=4000
PUBLIC_PORT=443
SERVER_ID=puter-prod-1
CONTACT_EMAIL=support@example.com
NODE_ENV=production
```

**Result:**
- Frontend: `https://example.com`
- API: `https://api.example.com`
- Static Hosting: `https://site.example.com`
- App Hosting: `https://app.example.com`

### Scenario 4: Docker Container

```dockerfile
# Dockerfile
FROM node:latest
WORKDIR /puter
COPY . .

# Create .env from build args
ARG PUTER_DOMAIN=puter.docker
ARG SSL_ENABLED=false
ARG PUTER_API_ROUTING=path
ARG PORT=4000

ENV PUTER_DOMAIN=${PUTER_DOMAIN}
ENV SSL_ENABLED=${SSL_ENABLED}
ENV PUTER_API_ROUTING=${PUTER_API_ROUTING}
ENV PORT=${PORT}

RUN npm install
EXPOSE ${PORT}
CMD ["npm", "start"]
```

Usage:
```bash
docker build \
  --build-arg PUTER_DOMAIN=puter.example.com \
  --build-arg SSL_ENABLED=true \
  --build-arg PUTER_API_ROUTING=path \
  .
```

## How It Works

### 1. Configuration Loading Pipeline

```
DEFAULT CONFIG (default_config.js)
    ↓
CONFIG FILE (config.json - if exists)
    ↓
ENVIRONMENT CONFIGURATION (EnvConfigParser)
    ↓
COMPUTED DEFAULTS (origin, api_base_url, etc.)
    ↓
FINAL CONFIG
```

### 2. Frontend Configuration

The frontend automatically receives:
- `api_origin`: Computed based on `experimental_no_subdomain` setting
- `gui_origin`: Set to the main origin
- `origin`: The computed full URL with protocol/domain/port

### 3. API Routing Logic

**Subdomain Mode** (`experimental_no_subdomain=false`):
```
config.api_base_url = https://api.example.com
```

**Path Mode** (`experimental_no_subdomain=true`):
```
config.api_base_url = https://example.com
// Routes are prefixed with /api internally
```

## Advanced Configuration

### Reverse Proxy Setup

When Puter runs behind a reverse proxy:

```bash
# .env
PUTER_DOMAIN=example.com
SSL_ENABLED=true
PORT=4000              # Internal port
PUBLIC_PORT=443        # External port
```

**Nginx Example:**
```nginx
server {
    listen 443 ssl;
    server_name example.com api.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Custom Configuration Override

If you need more advanced configuration, you can still use `config.json` and override specific values:

```json
{
  "domain": "example.com",
  "protocol": "https",
  "http_port": 4000,
  "pub_port": 443,
  "experimental_no_subdomain": true,
  "custom_setting": "value"
}
```

Environment variables will be applied on top, so you can combine both approaches.

## Migration from config.json

### Method 1: Full Migration to .env

1. Create `.env` with your settings
2. Rename or remove `config.json`
3. Puter will generate a new `config.json` with env settings applied

### Method 2: Gradual Migration

Keep `config.json` but override specific settings:

```bash
# .env
PUTER_DOMAIN=new.example.com  # Overrides config.json domain
```

The `config.json` will remain but be extended with env configuration.

### Method 3: Revert to config.json

Simply delete the `.env` file or unset environment variables, and Puter will use `config.json` settings exclusively.

## Troubleshooting

### Issue: Configuration not being applied

**Check 1:** Is the `.env` file in the correct location?
```bash
# Should be in the Puter root directory
ls -la /path/to/puter/.env
```

**Check 2:** Is `PUTER_DOMAIN` set?
```bash
# Env config only applies if PUTER_DOMAIN or MAIN_DOMAIN is set
echo "PUTER_DOMAIN=$PUTER_DOMAIN"
```

**Check 3:** Check the console output during startup
```bash
# Look for: "Applying environment configuration from .env or ENV vars"
npm start 2>&1 | grep -i "environment"
```

### Issue: API not reachable

**Check:** Is `PUTER_API_ROUTING` correct for your setup?
```bash
# Subdomain mode (verify DNS/hosts file)
ping api.example.com

# Path mode (should work with main domain)
curl https://example.com/api
```

### Issue: SSL certificate warnings

**Solution:** Configure SSL properly with a reverse proxy or valid certificate:
```bash
# With reverse proxy
SSL_ENABLED=true
# Configure nginx/apache with SSL termination
```

## Environment Variable Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PUTER_DOMAIN` | `puter.localhost` | Main domain for Puter |
| `MAIN_DOMAIN` | - | Alternative to `PUTER_DOMAIN` |
| `SSL_ENABLED` | `false` | Enable HTTPS |
| `PUTER_SSL` | - | Alternative to `SSL_ENABLED` |
| `PUTER_API_ROUTING` | `subdomain` | API routing mode |
| `API_ROUTING` | - | Alternative to `PUTER_API_ROUTING` |
| `PORT` | `auto` | Listen port |
| `HTTP_PORT` | - | Alternative to `PORT` |
| `PUBLIC_PORT` | `PORT` or 80/443 | Public/exposed port |
| `PUB_PORT` | - | Alternative to `PUBLIC_PORT` |
| `NODE_ENV` | `dev` | Environment mode |
| `ENV` | - | Alternative to `NODE_ENV` |
| `SERVER_ID` | `puter-server` | Server identifier |
| `CONTACT_EMAIL` | `hey@{domain}` | Contact email |

## Technical Details

### Configuration Parser

The `EnvConfigParser` class in `src/backend/src/config/EnvConfigParser.js` handles:
1. Reading `.env` files and `process.env`
2. Validating configuration values
3. Computing derived settings (protocol, api_base_url, etc.)
4. Merging with existing configuration

### Integration Points

1. **RuntimeEnvironment.js**: Applies env config after loading config.json
2. **config.js**: Uses computed defaults based on env settings
3. **WebServerService.js**: Applies final computed configuration

### Computed Values

The following values are automatically computed:
- `origin`: `{protocol}://{domain}:{port}`
- `api_base_url`: Depends on API routing mode
- `static_hosting_domain`: `site.{domain}`
- `private_app_hosting_domain`: `app.{domain}`

## Contributing

To add new environment variables:

1. Add parsing logic in `EnvConfigParser._parse*()` method
2. Add tests in `EnvConfigParser.test.js`
3. Update `.env.example`
4. Update this documentation

## Support

For issues or questions:
- Check the troubleshooting section above
- Review the test file for usage examples
- Examine the configuration parser source code
- Consult Puter documentation or community channels
