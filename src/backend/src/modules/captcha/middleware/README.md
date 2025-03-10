# Captcha Middleware

This middleware provides captcha verification for routes that need protection against automated abuse.

## Usage

The captcha middleware can be used in two modes:

1. **Always require captcha**: This mode always requires captcha verification for the route.
2. **Conditional captcha**: This mode only requires captcha verification if the requester has been flagged to require captcha (e.g., due to rate limiting).

### Example Usage

```javascript
const express = require('express');
const router = express.Router();

// Get the captcha middleware from the context
const requireCaptcha = context.get('captcha-middleware');

// Always require captcha for this route
router.post('/sensitive-route', requireCaptcha({ always: true }), (req, res) => {
  // Route handler
});

// Conditionally require captcha for this route
router.post('/normal-route', requireCaptcha(), (req, res) => {
  // Route handler
});
```

## Client-Side Integration

To integrate with the captcha middleware, the client needs to:

1. Call the `/api/captcha/generate` endpoint to get a captcha token and image.
2. Display the captcha image to the user and collect their answer.
3. Include the captcha token and answer in the request body:

```javascript
// Example client-side code
async function submitWithCaptcha(formData) {
  // Add captcha token and answer to the form data
  formData.captchaToken = captchaToken;
  formData.captchaAnswer = userAnswer;
  
  // Submit the form
  const response = await fetch('/api/some-endpoint', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(formData)
  });
  
  // Handle response
  const data = await response.json();
  if (response.status === 400 && data.error === 'captcha_required') {
    // Show captcha to the user
    showCaptcha();
  }
}
```

## Error Handling

The middleware will throw the following errors:

- `captcha_required`: When captcha verification is required but no token or answer was provided.
- `captcha_invalid`: When the provided captcha answer is incorrect.

These errors can be caught by the API error handler and returned to the client. 