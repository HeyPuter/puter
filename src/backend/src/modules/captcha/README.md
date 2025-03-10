# Captcha Module

This module provides captcha verification functionality to protect against automated abuse, particularly for login and signup flows.

## Components

- **CaptchaModule.js**: Registers the service and middleware
- **CaptchaService.js**: Provides captcha generation and verification functionality
- **captcha-middleware.js**: Express middleware for protecting routes with captcha verification

## Testing

Two test scripts are provided to verify the functionality of the CaptchaService:

### 1. Direct Service Testing

This test directly instantiates the CaptchaService and tests its methods without going through API endpoints.

```bash
cd puter/src/backend/src/modules/captcha
node test-captcha-direct.js
```

This test:
- Creates an instance of the CaptchaService
- Tests captcha generation
- Tests verification with valid and invalid answers
- Tests token expiration
- Tests token cleanup

### 2. API Endpoint Testing

This test verifies that the API endpoints are working correctly.

```bash
cd puter/src/backend/src/modules/captcha
node test-captcha.js
```

This test:
- Makes HTTP requests to the captcha API endpoints
- Tests the generate endpoint
- Tests the verify endpoint with valid and invalid answers
- Tests token expiration

**Note**: For this test to work, the Puter server must be running at http://localhost:4100.

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

The CaptchaService can be configured with the following options:

- `enabled`: Whether the captcha service is enabled (default: true)
- `expirationTime`: How long captcha tokens are valid in milliseconds (default: 10 minutes)
- `difficulty`: The difficulty level of the captcha ('easy', 'medium', 'hard') (default: 'medium')

These options are set when registering the service in CaptchaModule.js. 