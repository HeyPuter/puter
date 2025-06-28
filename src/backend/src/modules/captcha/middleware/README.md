# Captcha Middleware

This middleware provides captcha verification for routes that need protection against automated abuse.

## Middleware Components

The captcha system is now split into two middleware components:

1. **checkCaptcha**: Determines if captcha verification is required but doesn't perform verification.
2. **requireCaptcha**: Performs actual captcha verification based on the result from checkCaptcha.

This split allows frontend applications to know in advance whether captcha verification will be needed for a particular action.

## Usage Patterns

### Using Both Middlewares (Recommended)

For best user experience, use both middlewares together:

```javascript
const express = require('express');
const router = express.Router();

// Get both middleware components from the context
const { checkCaptcha, requireCaptcha } = context.get('captcha-middleware');

// Determine if captcha is required for this route
router.post('/login', checkCaptcha({ eventType: 'login' }), (req, res, next) => {
  // Set a flag in the response so frontend knows if captcha is needed
  res.locals.captchaRequired = req.captchaRequired;
  next();
}, requireCaptcha(), (req, res) => {
  // Handle login logic
  // If captcha was required, it has been verified at this point
});
```

### Using Individual Middlewares

You can also access each middleware separately:

```javascript
const checkCaptcha = context.get('check-captcha-middleware');
const requireCaptcha = context.get('require-captcha-middleware');
```

### Using Only requireCaptcha (Legacy Mode)

For backward compatibility, you can still use only the requireCaptcha middleware:

```javascript
const requireCaptcha = context.get('require-captcha-middleware');

// Always require captcha for this route
router.post('/sensitive-route', requireCaptcha({ always: true }), (req, res) => {
  // Route handler
});

// Conditionally require captcha based on extensions
router.post('/normal-route', requireCaptcha(), (req, res) => {
  // Route handler
});
```

## Configuration Options

### checkCaptcha Options

- `always` (boolean): Always require captcha regardless of other factors
- `strictMode` (boolean): If true, fails closed on errors (more secure)
- `eventType` (string): Type of event for extensions (e.g., 'login', 'signup')

### requireCaptcha Options

- `strictMode` (boolean): If true, fails closed on errors (more secure)

## Frontend Integration

There are two ways to integrate with the frontend:

### 1. Using the checkCaptcha Result in API Responses

You can include the captcha requirement in API responses:

```javascript
router.get('/whoarewe', checkCaptcha({ eventType: 'login' }), (req, res) => {
  res.json({
    // Other environment information
    captchaRequired: {
      login: req.captchaRequired
    }
  });
});
```

### 2. Setting GUI Parameters

For PuterHomepageService, you can add captcha requirements to GUI parameters:

```javascript
// In PuterHomepageService.js
gui_params: {
  // Other parameters
  captchaRequired: {
    login: req.captchaRequired
  }
}
```

## Client-Side Integration

To integrate with the captcha middleware, the client needs to:

1. Check if captcha is required for the action (using /whoarewe or GUI parameters)
2. If required, call the `/api/captcha/generate` endpoint to get a captcha token and image
3. Display the captcha image to the user and collect their answer
4. Include the captcha token and answer in the request body:

```javascript
// Example client-side code
async function submitWithCaptcha(formData) {
  // Check if captcha is required
  const envInfo = await fetch('/api/whoarewe').then(r => r.json());
  
  if (envInfo.captchaRequired?.login) {
    // Get and display captcha to user
    const captcha = await getCaptchaFromServer();
    showCaptchaToUser(captcha);
    
    // Add captcha token and answer to the form data
    formData.captchaToken = captcha.token;
    formData.captchaAnswer = await getUserCaptchaAnswer();
  }
  
  // Submit the form
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(formData)
  });
  
  // Handle response
  const data = await response.json();
  if (response.status === 400 && data.error === 'captcha_required') {
    // Show captcha to the user if not already shown
    showCaptcha();
  }
}
```

## Error Handling

The middleware will throw the following errors:

- `captcha_required`: When captcha verification is required but no token or answer was provided.
- `captcha_invalid`: When the provided captcha answer is incorrect.

These errors can be caught by the API error handler and returned to the client. 