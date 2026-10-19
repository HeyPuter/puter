# Puter Bug Bounty Program

We at **Puter** are committed to maintaining a secure experience for our users and community. We greatly value the contributions of security researchers and welcome responsible disclosure of security issues.

## Scope

The following are in scope for this program:

- **The Puter open-source project** (available at [github.com/HeyPuter/puter](https://github.com/HeyPuter/puter))
- **`puter.com`**
- **`api.puter.com`**

Out-of-scope:

- Third-party services, applications, or libraries not maintained by Puter.
- Social engineering attacks (e.g., phishing against staff).
- Denial of Service (DoS), spam, or volumetric attacks.
- Physical security issues.

## Eligibility

We pay bounties for issues that threaten user security and privacy, or the security and health of the platform. We appreciate every report, but hardening suggestions and correctness bugs are not eligible, even when we fix them. Please open a GitHub issue for those.

A report must show how an attacker can directly perform the action against another account or the system. It is not eligible if it:

- Starts from access the attacker should not already have: a stolen session or token, the victim's password, a root or full-access token, or script execution on `puter.com`.
- Needs the victim to do more than ordinary use (opening a link or an app), such as publishing their own secrets, sending a verification link to an address they don't control, or approving a prompt that accurately states what it grants.
- Gives the attacker nothing they couldn't already get through a supported API.
- Only reproduces in a non-default or development setup (SQLite, a `custom` OIDC provider, an unset outbound proxy, cookies or config planted by hand). Findings in the open-source code must affect `puter.com` or a default self-hosted install.

**Shared state.** Sharing files, KV entries, or cross-app KV access means the sharer trusts the sharee. Exploits that depend on that trust, such as a sharee misusing access the sharer granted, may be treated as hardening or lower severity.

Hardening we ship in a public PR does not make similar code paths vulnerabilities. They are judged by these same rules.

## Known Non-Issues (Please Check Before Submitting)

The following have already been reviewed and determined **not to be vulnerabilities**. Reports that only re-describe one of these are **not eligible for a reward** and will be closed as non-issues — even if they include new code references. Please review this list before submitting:

- **XSS / CORS / token issues scoped to `api.puter.com`.** The primary user session cookie lives on `puter.com`, not on the API origin, so reflected/stored XSS, CORS, or token handling on `api.puter.com` is out of scope. This explicitly includes **missing `Content-Security-Policy: sandbox` on any endpoint that serves a file inline** — `/token-read`, `/file`, `/fs/read`, WebDAV, and any MIME type the `applyInlineContentSecurity` allow-list does not cover (`text/xsl`, `image/svg+xml`, `application/xhtml+xml`, …). Script execution on the API origin has nothing to reach: there is no session cookie, no `localStorage`, and no ambient credential there. WebDAV additionally has to return an accurate MIME type for real WebDAV clients. The one exception we _do_ evaluate on its merits is anything that abuses the app-scoped `puter_token_v2` companion cookie set on the API host — if your report does not name a specific credential that is actually reachable from the API origin, it is this non-issue.
- **SSRF via `secureFetch`.** Production routes outbound requests through an isolated proxy that has no access to internal/SSRF-sensitive resources.
- **Attacks that depend on guessing an `appInstanceID` or app UID.** These are random 128-bit secret values and are not considered guessable.
- **Apps invoking drivers, creating workers, or using KV.** Applications are intended to do this; worker permissions are scoped to the owning app. This is by design.
- **App metadata or app user-count "leaks".** This information is currently public by design. This covers **private apps** too: private apps are an unreleased, admin-only beta for paid listings in the Puter App Center. Their `index_url` and other metadata are not secret, the flag is not user-settable, and no production app relies on it. Reports that a private app's metadata is reachable through a sibling route (taskbar items, `/get-launch-apps`, `index_url` drift on the hosting gate, etc.) are normalization work, not vulnerabilities.
- **Worker hot-reload driven by a share recipient.** Sharing a worker's source file with write access is how you let a collaborator change that worker's code and have it deploy live. The redeploy running as the file owner, with the owner's worker credentials, is the intended behavior of that grant — the owner chose to hand out write access to executable code. If you do not want that, do not share the source file with write access.
- **Re-claiming a site or worker name its owner deleted.** A hosted site or worker name that its owner deletes is treated as abandoned by that owner. If one of their apps still points at it, whoever claims the name next serves that app's `index_url` and receives what the app is launched with, and a new app on the same origin may share the old one's identity. Guarding app identities against being recycled this way is ongoing hardening, not a security boundary, so new ways to re-claim an abandoned name, or to inherit an app's tokens or data through one, are not eligible.
- **Share-mode downgrades that do not cascade.** Demoting a delegate does not retroactively revoke the grants that delegate already issued downstream. Shares are independent grants once issued, not a live-evaluated chain. Revoking the downstream grant is a separate, supported action.
- **Metering, credit-hold, and quota inaccuracies.** Credit holds and quota checks are up-front estimates, and actual usage is billed afterwards. Overspend that is bounded and still billed is a correctness bug, including concurrent requests that exceed a hold or quota by some margin; the per-account concurrency and rate-limit gates are the control we rely on. Report these only if you can use a service without it being billed, or overspend without bound.
- **Existence-only oracles.** A response that tells "exists but forbidden" apart from "not found" for a path or ID the caller already supplied, without revealing anything else about it, is hardening.
- **Session and credential lifecycle around 2FA enrollment.** Enrolling in 2FA is not a credential-revocation event: existing authenticated sessions stay valid, and outstanding password-reset links stay valid. Likewise, account-management actions behind the `/user-protected/*` gate are password-gated by design, not TOTP-gated. A recovery code that stops being accepted fails _closed_ — it denies access rather than granting it, so it is a bug report, not a vulnerability.
- **Group permissions** (`/auth/revoke-user-group` and siblings). The group-permission surface is unfinished and not exposed anywhere in the product. Findings there are not reachable by any user.
- **Missing Subresource Integrity (SRI) on external scripts/styles.** Accepted as hardening, not as a vulnerability, absent a demonstrated compromise of the CDN in question.
- **General "token in a URL" / token-lifetime / token-storage designs** — signed directory URLs exposing children, a write signature implying read, app tokens outliving a web session, or the session token being held in `localStorage` on `puter.com`. These are current intended behaviors. Shorter-lived tokens with a refresh flow are on the roadmap; their absence is not a vulnerability on its own. Show a reproducible attack that does not already presuppose script execution on `puter.com`.
- **Missing PKCE, unverified `id_token` signatures, or other OIDC hardening.** Provider tokens are obtained through a server-to-server authorization-code exchange with the provider's token endpoint over TLS, so the resulting `id_token` / userinfo claims are trusted from that channel rather than from local JWKS signature verification — the callback never accepts a caller-supplied `id_token`. Adding local signature / `aud` / `iss` / `exp` checks is welcome defense-in-depth (please open a GitHub issue/PR), but their absence is not an account-takeover vector on its own.
- **JWT "algorithm confusion" / unpinned `algorithms` in `jwt.verify`.** Puter's session tokens are HMAC-signed (HS256) with a server-side secret, and there is no asymmetric public key anywhere in the verification path, so `alg`-substitution attacks do not apply. Explicitly pinning `algorithms` is a fine hardening PR, but it is not a vulnerability.
- **Static-source "SQL injection" in internal pagination.** Findings such as `LIMIT ${limit}` in list/notification queries: the limit is numerically coerced and clamped before it reaches the query, so it is not reachable with attacker-controlled string input. Hardening PRs to the internal stores are welcome, but these are not exploitable as reported.
- **Deprecated `saveTo*` GUI app messages.** The legacy `saveToDesktop` / `saveToDocuments` / etc. app-IPC handlers can create — never overwrite — new files in standard user folders. The behavior is non-destructive, path-traversal-safe, and deprecated (slated for removal); it is not treated as a sandbox escape.
- **Best-practice suggestions** such as login/registration username enumeration (kept intentionally for UX) or unauthenticated unsubscribe links (industry norm).
- **Rate-limiting suggestions for TURN credential issuance** (intentional; not billed per tunnel).

If you believe you have a **genuinely new** exploit chain that defeats one of these rationales (for example, demonstrating a sensitive credential that really is reachable on `api.puter.com`), say so explicitly and show why the reasoning above does not apply.

## Rules of Engagement

To participate, you must:

1. **Report responsibly**: Provide detailed steps to reproduce the issue, including proof-of-concept code, screenshots, or a screen recording (see _Proof of Reproduction_ below).
2. **Do no harm**: Do not exfiltrate, modify, or delete data. Only access your own account or test data.
3. **Respect availability**: Do not perform denial-of-service attacks or automated scans that degrade service.
4. **Follow disclosure policy**: Do not publicly disclose vulnerabilities until we have confirmed and patched the issue.
5. **Act in good faith**: Make every effort to avoid privacy violations, destruction of data, and interruption or degradation of services.
6. **Check Eligibility and Known Non-Issues**: Reports that fall outside "Eligibility" or match an item in "Known Non-Issues" above are not eligible and will be closed.

Reports that do not meet these guidelines may not be eligible for a reward.

## Proof of Reproduction

Reports **MUST** demonstrate a **working, reproducible exploit with real impact** — not a theoretical or static-source-review finding. Please include:

- Exact steps to reproduce, the relevant request/response or code path, and the commit or version you tested.
- The **observed** result versus the **expected** result.
- For client-side, UI, or authentication-flow bugs: a short screen recording (≤ 2 minutes) showing the exploit working end-to-end on a real Puter instance.
- For server-side bugs: a runnable proof-of-concept and screenshot or video showing the attack process. A unit test or in-process harness alone does not count; show it against a running instance.

Reports based solely on reading the source ("source review only, not tested") or unverified AI/LLM-generated reports are the **lowest triage priority and not eligible for bounty**.
If you used an AI tool to help find an issue, you must personally verify that it actually reproduces before submitting. Reports sent by automated agents are not eligible.

Please submit **one issue per report**.
Bundled "audit packs" of many speculative findings will not be eligible for bounty; send each confirmed issue separately.
Additionally please **DO NOT** submit too many issues at once; these will be treated as a bundled report, and will not be eligible for bounty.

## Reporting Process

To report a vulnerability, email us at: **[security@puter.com](mailto:security@puter.com)**.
Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested remediation (if available)
- Paypal id where we can send the bounty (if eligible)

Send the full report in your first email. We don't reply to messages that only ask whether we run a bounty or where to report.

We aim to acknowledge receipt within **72 hours** and provide a resolution timeline.

## Reward Structure

We offer monetary rewards based on the severity of the vulnerability, as determined by our internal assessment (using CVSS as a guide).

- **Critical: \$1,000 – \$2,000**
- **High: \$500 – \$1,000**
- **Medium: \$200 – \$500**
- **Low: \$50 – \$100**

Non-security issues, suggestions, and best practices feedback are always welcome, but may not qualify for a reward.
If multiple researchers report the same issue, the bounty will be awarded to the first eligible report we receive. Issues we already know about, from internal review, an open ticket, or a fix already in a public commit or PR, count as duplicates.

## Payments Disclaimer

All reward amounts are **guidelines only**. Final decisions about eligibility, severity classification, and payout amount are made at the sole discretion of the Puter security team. We reserve the right to determine whether a report qualifies for a bounty, and whether any payment will be issued at all. Submitting a report does not guarantee compensation.

### Payment Method Requirement

At this time, **payments will only be made via PayPal**. To be eligible to receive a bounty, researchers must have a valid PayPal account capable of receiving payments. We are unable to process payments through other services or methods at this time.

## Legal Safe Harbor

If you make a good-faith effort to comply with this policy, we will consider your research to be authorized. If you inadvertently access data outside your own account, stop immediately and include details in your report so we can investigate and remediate.
