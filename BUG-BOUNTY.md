# Puter Bug Bounty Program

We at **Puter** are committed to maintaining a secure experience for our users and community. We greatly value the contributions of security researchers and welcome responsible disclosure of security issues.

## Scope

The following are in scope for this program:

* **The Puter open-source project** (available at [github.com/HeyPuter/puter](https://github.com/HeyPuter/puter))
* **`puter.com`**
* **`api.puter.com`**

Out-of-scope:

* Third-party services, applications, or libraries not maintained by Puter.
* Social engineering attacks (e.g., phishing against staff).
* Denial of Service (DoS), spam, or volumetric attacks.
* Physical security issues.

## Known Non-Issues (Please Check Before Submitting)

The following have already been reviewed and determined **not to be vulnerabilities**. Reports that only re-describe one of these are **not eligible for a reward** and will be closed as non-issues — even if they include new code references. Please review this list before submitting:

* **XSS / CORS / token issues scoped to `api.puter.com`.** The primary user session cookie lives on `puter.com`, not on the API origin, so reflected/stored XSS, CORS, or token handling on `api.puter.com` is generally out of scope. Two exceptions we *do* evaluate on their merits — please report these: (a) attacker-controlled content served **inline** (e.g. an HTML `Content-Type`) from API file/response endpoints, and (b) anything that abuses the app-scoped `puter_token_v2` companion cookie set on the API host.
* **SSRF via `secureFetch`.** Production routes outbound requests through an isolated proxy that has no access to internal/SSRF-sensitive resources.
* **Attacks that depend on guessing an `appInstanceID` or app UID.** These are random 128-bit secret values and are not considered guessable.
* **Apps invoking drivers, creating workers, or using KV.** Applications are intended to do this; worker permissions are scoped to the owning app. This is by design.
* **App metadata or app user-count "leaks".** This information is currently public by design.
* **General "token in a URL" / token-lifetime designs** — signed directory URLs exposing children, a write signature implying read, or app tokens outliving a web session. These are current intended behaviors.
* **Missing PKCE, unverified `id_token` signatures, or other OIDC hardening.** Provider tokens are obtained through a server-to-server authorization-code exchange with the provider's token endpoint over TLS, so the resulting `id_token` / userinfo claims are trusted from that channel rather than from local JWKS signature verification — the callback never accepts a caller-supplied `id_token`. Adding local signature / `aud` / `iss` / `exp` checks is welcome defense-in-depth (please open a GitHub issue/PR), but their absence is not an account-takeover vector on its own.
* **JWT "algorithm confusion" / unpinned `algorithms` in `jwt.verify`.** Puter's session tokens are HMAC-signed (HS256) with a server-side secret, and there is no asymmetric public key anywhere in the verification path, so `alg`-substitution attacks do not apply. Explicitly pinning `algorithms` is a fine hardening PR, but it is not a vulnerability.
* **Static-source "SQL injection" in internal pagination.** Findings such as `LIMIT ${limit}` in list/notification queries: the limit is numerically coerced and clamped before it reaches the query, so it is not reachable with attacker-controlled string input. Hardening PRs to the internal stores are welcome, but these are not exploitable as reported.
* **Deprecated `saveTo*` GUI app messages.** The legacy `saveToDesktop` / `saveToDocuments` / etc. app-IPC handlers can create — never overwrite — new files in standard user folders. The behavior is non-destructive, path-traversal-safe, and deprecated (slated for removal); it is not treated as a sandbox escape.
* **Best-practice suggestions** such as login/registration username enumeration (kept intentionally for UX) or unauthenticated unsubscribe links (industry norm).
* **Rate-limiting suggestions for TURN credential issuance** (intentional; not billed per tunnel).

If you believe you have a **genuinely new** exploit chain that defeats one of these rationales (for example, demonstrating a sensitive credential that really is reachable on `api.puter.com`), say so explicitly and show why the reasoning above does not apply.

## Rules of Engagement

To participate, you must:

1. **Report responsibly**: Provide detailed steps to reproduce the issue, including proof-of-concept code, screenshots, or a screen recording (see *Proof of Reproduction* below).
2. **Do no harm**: Do not exfiltrate, modify, or delete data. Only access your own account or test data.
3. **Respect availability**: Do not perform denial-of-service attacks or automated scans that degrade service.
4. **Follow disclosure policy**: Do not publicly disclose vulnerabilities until we have confirmed and patched the issue.
5. **Act in good faith**: Make every effort to avoid privacy violations, destruction of data, and interruption or degradation of services.
6. **Check the Known Non-Issues list**: Reports matching an item in the "Known Non-Issues" section above are not eligible and will be closed.

Reports that do not meet these guidelines may not be eligible for a reward.

## Proof of Reproduction

Reports must demonstrate a **working, reproducible exploit with real impact** — not a theoretical or static-source-review finding. Please include:

* Exact steps to reproduce, the relevant request/response or code path, and the commit or version you tested.
* The **observed** result versus the **expected** result.
* For client-side, UI, or authentication-flow bugs: a short screen recording (≤ 2 minutes) showing the exploit working end-to-end on a real Puter instance.
* For server-side bugs: a runnable proof-of-concept.

Reports based solely on reading the source ("source review only, not tested") or unverified AI/LLM-generated reports are the **lowest triage priority and are generally not eligible**. If you used an AI tool to help find an issue, you must personally verify that it actually reproduces before submitting.

Please submit **one issue per report**. Bundled "audit packs" of many speculative findings will be declined; send each confirmed issue separately.

## Reporting Process

To report a vulnerability, email us at: **[security@puter.com](mailto:security@puter.com)**.
Include:

* A description of the vulnerability
* Steps to reproduce
* Potential impact
* Suggested remediation (if available)

We aim to acknowledge receipt within **72 hours** and provide a resolution timeline.

## Reward Structure

We offer monetary rewards based on the severity of the vulnerability, as determined by our internal assessment (using CVSS as a guide).

* **Critical: \$1,000 – \$2,000**
* **High: \$500 – \$1,000**
* **Medium: \$200 – \$500**
* **Low: \$50 – \$100**

Non-security issues, suggestions, and best practices feedback are always welcome, but may not qualify for a reward.
If multiple researchers report the same issue, the bounty will be awarded to the first eligible report we receive.

## Payments Disclaimer

All reward amounts are **guidelines only**. Final decisions about eligibility, severity classification, and payout amount are made at the sole discretion of the Puter security team. We reserve the right to determine whether a report qualifies for a bounty, and whether any payment will be issued at all. Submitting a report does not guarantee compensation.

### Payment Method Requirement

At this time, **payments will only be made via PayPal**. To be eligible to receive a bounty, researchers must have a valid PayPal account capable of receiving payments. We are unable to process payments through other services or methods at this time.

## Legal Safe Harbor

If you make a good-faith effort to comply with this policy, we will consider your research to be authorized. If you inadvertently access data outside your own account, stop immediately and include details in your report so we can investigate and remediate.
