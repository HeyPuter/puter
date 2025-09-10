- Feature Name: Cloudflare Turnstile CAPTCHA
- Status: Completed
- Created: 2025-08-26

## Summary

We propose integrating **Cloudflare Turnstile** to protect our signup flow against automated bot activity, while maintaining a seamless experience for legitimate users.

## Motivation

Puter allocates resources to **free** user account — including storage, compute, and AI credits. To prevent these from being exploited by bots, we need a more robust verification mechanism. Although Puter currently includes a [custom CAPTCHA service](https://github.com/HeyPuter/puter/blob/4c3a68ee51a1b255edbe6b3c7e4c4e3b0394dae3/src/backend/src/modules/captcha/services/CaptchaService.js), it has several shortcomings:

* The text-recognition CAPTCHA creates friction and disrupts the user experience.
* Maintaining a token pool is resource-intensive and doesn’t scale well. The validation logic also requires ongoing maintenance within the codebase.

## Choose of Service Provider

We choose Cloudflare Turnstile since:

* It's free for unlimited use.
* It's easy to integrate.
* It's relative secure.

Here's a comparison of major CAPTCHA providers:


| Provider                                                  | Security (typical)                                                              | User experience (typical)                                                               | Price (publicly listed)                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Turnstile**                                  | **High** for most sites; adaptive challenges; works without image puzzles.      | **Excellent** (can be fully invisible or auto-verify; checkbox only for risky traffic). | **Free for everyone (unlimited use)**. ([The Cloudflare Blog](https://blog.cloudflare.com/turnstile-ga/?utm_source=chatgpt.com), [cloudflare.com](https://www.cloudflare.com/application-services/products/turnstile/?utm_source=chatgpt.com)) |
| **Google reCAPTCHA (Essentials / Standard / Enterprise)** | **Medium–High** (v3 score + server rules; Enterprise adds features & support). | **Good–OK** (v3 is invisible; v2 can show puzzles).                                    | **Free up to 10k assessments/mo; \$8 for up to 100k/mo; then \$1 per 1k** (Enterprise tiers). ([Google Cloud](https://cloud.google.com/recaptcha/docs/compare-tiers?utm_source=chatgpt.com))                                                    |
| **hCaptcha (Basic / Pro / Enterprise)**                   | **High** (ML signals; enterprise options).                                      | **Good** on Basic; **Very good** on Pro with “low-friction 99.9% passive mode.”       | **Basic: Free. Pro: \$99/mo annual (\$139 month-to-month) incl. 100k evals, then \$0.99/1k**; Enterprise custom. ([hcaptcha.com](https://www.hcaptcha.com/pricing?utm_source=chatgpt.com))                                                      |
| **Friendly Captcha**                                      | **Medium–High** (proof-of-work + risk signals).                                | **Excellent** (invisible/automatic challenge; no image tasks).                          | **Starter €9/mo (1k req/mo); Growth €39/mo (5k/mo); Advanced €200/mo (50k/mo); Free non-commercial 1k/mo**; Enterprise custom. ([Friendly Captcha](https://friendlycaptcha.com/))                                                            |
| **Arkose Labs (FunCaptcha / MatchKey)**                   | **Very High** (step-up, anti-farm, enterprise focus).                           | **Good–OK** (challenge can be more involved when risk is high).                        | **Enterprise pricing (contact sales)**; publicly not listed. (Product overview only.) ([Arkose Labs](https://www.arkoselabs.com/arkose-matchkey/?utm_source=chatgpt.com))                                                                       |

## Implementation

### Signup Flow

When a user submits the signup form, the client will include a **Turnstile token** alongside the other form data.
On the backend, Puter will call the **Cloudflare Turnstile verification API** to validate this token before provisioning a new account.

Only if the token is verified as valid will the signup request be processed. Invalid or missing tokens will result in a rejected signup attempt.

## Setup

1. Create a new *Widget* on the Cloudflare Turnstile dashboard.
2. Configure *Widget name* and *Hostnames*.
3. Set *Widget Mode* to **Managed** and *pre-clearance* to **Yes - Interactive**. These settings minimize friction for legitimate users while also giving suspicious users one more chance to clear the CAPTCHA. (See [Turnstile widgets · Cloudflare Turnstile docs](https://developers.cloudflare.com/turnstile/concepts/widget/) for details)
4. Add Site Key and Secret Key to the config file (default location: `volatile/config/config.json`):

    ```
    "cloudflare-turnstile": {
        "enabled": true,
        "site_key": "<your-site-key>",
        "secret_key": "<your-secret-key>"
    }
    ```
