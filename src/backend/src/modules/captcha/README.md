# Captcha Module

This module provides captcha verification functionality to protect against automated abuse, particularly for login and signup flows.

## Components

- **CaptchaModule.js**: Registers the service and middleware
- **CaptchaService.js**: Provides captcha generation and verification functionality
- **captcha-middleware.js**: Express middleware for protecting routes with captcha verification

## Integration

The CaptchaService is registered by the CaptchaModule and can be accessed by other services:

```javascript
const captchaService = services.get('captcha');
```

### Example Usage

```javascript
// Generate a captcha
const captcha = captchaService.generateCaptcha();
// captcha.token - The token to verify later
// captcha.image - SVG image data to display to the user

// Verify a captcha
const isValid = captchaService.verifyCaptcha(token, userAnswer);
```

## Configuration

The CaptchaService can be configured with the following options in the configuration file (`config.json`):

- `captcha.enabled`: Whether the captcha service is enabled (default: false)
- `captcha.expirationTime`: How long captcha tokens are valid in milliseconds (default: 10 minutes)
- `captcha.difficulty`: The difficulty level of the captcha ('easy', 'medium', 'hard') (default: 'medium')

These options are set in the main configuration file. For example:

```json
{
  "services": {
    "captcha": {
      "enabled": false,
      "expirationTime": 600000,
      "difficulty": "medium"
    }
  }
}
```

### Development Configuration

For local development, you can disable captcha by creating or modifying your local configuration file (e.g., in `volatile/config/config.json` or using a profile configuration):

```json
{
  "$version": "v1.1.0",
  "$requires": [
    "config.json"
  ],
  "config_name": "local",
  
  "services": {
    "captcha": {
      "enabled": false
    }
  }
}
```

These options are set when registering the service in CaptchaModule.js. 