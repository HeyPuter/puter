---
title: Rate Limits and Quotas
description: The rate limits, usage credits, and storage quotas that apply to Puter.js apps, and how to handle hitting them.
---

<div class="info">This is an advanced reference. Puter.js already handles the common cases for you — a call that runs out of credit or storage surfaces an upgrade prompt to the user automatically, and most apps never need the numbers on this page. Read on if you're designing for high request volumes or want to handle limit errors yourself.</div>

Three separate mechanisms decide whether a call succeeds. They are independent, and hitting any one of them is enough to stop a request:

| Mechanism | Bounds | Refills | Failure |
| --- | --- | --- | --- |
| **Usage credit** | what usage *costs* (AI, egress, KV capacity, storage ops, workers) | monthly, per plan | `402` `insufficient_funds` |
| **Rate limit** | how many *requests* are made per window | rolling window (10s / 1min / 1h) | `429` `too_many_requests` |
| **Storage quota** | how many *bytes* are kept in the filesystem | never — the user deletes or upgrades | `413` `storage_limit_reached` |

A credit balance does not buy rate-limit headroom, and an empty balance does not stop metadata reads that cost nothing. Design for all three.

Because of the [User-Pays Model](/user-pays-model), every limit below applies **per user**, not per app: your app's traffic is bounded by each of your users' own accounts, so one heavy user can never exhaust your app for everyone else.

## Usage credit

Usage is charged against the account's monthly credit allowance, metered per operation at real cost.

- Every account starts with a free monthly allowance ([shown in the dashboard](https://puter.com/dashboard#usage)).
- Paid plans carry a larger allowance; see the [plans page](https://puter.com/dashboard#billing) for current tiers.
- Allowances reset monthly and do not roll over. Purchased top-up credits never expire and are spent after the allowance is gone.

What usage costs (the big three):

- **Egress** — every byte sent to a client, on *all* responses, not just file downloads. This is the one developers underestimate.
- **AI** — priced per model and per token/second/character. `puter.ai.listModels()` reports models; the per-model rates are served by the API (`GET /metering/allCosts`) rather than printed here, because a single number would be wrong for every model.
- **KV and storage operations** — small per-operation costs; reads served from cache are charged a fraction of an uncached read.

A streamed AI response that stops before the model reports its token counts — an upstream error part-way through the response, say — is still charged, on an estimate of what it streamed. A request that produced no output is not charged at all.

AI requests you have in flight count against the balance while they run, at the most they could cost, and are reconciled to their real cost when they finish. Several expensive completions started at once therefore see each other's spend rather than each being told the whole balance is available — the later ones get `402 insufficient_funds` if the balance can't cover them all.

## Rate limits

Every limit is a rolling window, keyed per user. Where three numbers are shown they are **paid / free / anonymous** — "paid" is any subscription tier.

### AI

Shared by chat, image generation, video, TTS, speech and OCR:

| Limit | Paid | Free | Anonymous |
| --- | --- | --- | --- |
| Requests per 10s (per interface + method) | 200 | 30 | 20 |
| Concurrent requests (per interface + method) | 20 | 3 | 2 |

Concurrency is counted per interface, so an image generation and a chat completion do not compete for the same slots.

The OpenAI- and Anthropic-compatible endpoints (`/puterai/openai/v1/*`, `/puterai/anthropic/v1/messages`) additionally require a paid plan — a free account calling them gets `402 subscription_required`. The same models are available to every account through `puter.ai.*` and `/drivers/call`, under the limits above; the model catalogue endpoints stay open to everyone.

### Key-value store

| Limit | Paid | Free | Anonymous |
| --- | --- | --- | --- |
| `get` / `set` / etc. per 10s | 400 | 400 | 200 |
| `list` (prefix scan) per minute | 240 | 120 | 60 |
| Concurrent calls | 30 | 15 | 8 |
| Concurrent `list` | 5 | 3 | 2 |

### Filesystem

All per minute unless stated:

| Operation | Paid | Free | Anonymous |
| --- | --- | --- | --- |
| `stat` | 1,200 | 600 | 300 |
| `readdir` | 600 | 300 | 120 |
| `readdir` burst (per 10s) | 120 | 60 | 30 |
| `read` | 600 | 300 | 120 |
| `write` | 300 | 120 | 30 |
| Multipart upload calls | 2,400 | 1,200 | 600 |
| Mutations (mkdir/rename/delete/move/copy) | 1,200 | 900 | 600 |
| Mutations, sustained (per hour) | 6,000 | 3,000 | 1,800 |
| Search | 60 | 30 | 10 |
| `space()` | 60 | 30 | 15 |
| Sign a URL | 300 | 150 | 60 |

| Concurrency | Paid | Free | Anonymous |
| --- | --- | --- | --- |
| `read` | 10 | 5 | 3 |
| `write` | 15 | 6 | 3 |
| Search | 5 | 2 | 2 |

Signed-URL routes have no session to key on, so they are bounded per network rather than per account: 3,000 reads/min, 600 writes/min, 60 concurrent.

### Sites and workers

| Limit | Paid | Free | Anonymous |
| --- | --- | --- | --- |
| Subdomain reads per 10s | 200 | 200 | 100 |
| Subdomain `create` per minute | 120 | 60 | 30 |
| Concurrent subdomain calls | 20 | 10 | 5 |
| Worker metadata reads per minute | 600 | 300 | 150 |
| Worker `create` (deploy) per minute | 120 | 80 | 40 |
| Worker `destroy` per minute | 30 | 20 | 10 |
| Concurrent worker calls | 10 | 5 | 3 |
| Concurrent deploys | 5 | 2 | 2 |

### Everything at once

Every driver call also passes one shared per-account budget of **8,000 calls/min** before the per-API limits above. It exists to catch a runaway loop, not to shape normal traffic — a client that sees a 429 from it is looping.

## Storage quota

Every account has a byte quota for the filesystem (100 MiB free; paid plans add more). Storage is what the user is *keeping*, not what they transferred — deleting files frees it immediately. At the limit, writes fail with `413` `storage_limit_reached`; reads keep working. `puter.fs.space()` returns `{ capacity, used }` live.

## What happens when you hit a limit

| Status | `code` | Meaning | What to do |
| --- | --- | --- | --- |
| `429` | `too_many_requests` | Rate or concurrency limit | Back off and retry; the window is at most 60s (or 1h for the sustained FS budget) |
| `402` | `insufficient_funds` | Monthly credit spent | The user buys credit or upgrades; resets next month |
| `402` | `subscription_required` | The endpoint is limited to paid plans | The user upgrades — retrying or waiting changes nothing |
| `413` | `storage_limit_reached` | Storage quota reached | The user deletes files or upgrades |

Errors come back as JSON: `{ "error": …, "message": …, "code": … }`.

### What Puter.js already does for you

The SDK turns the money-shaped failures into prompts without any code on your part: an AI call that runs out of credit and a filesystem write that runs out of space both surface an upgrade dialog to the user (in an app via `puter.ui.requestUpgrade()`, on the web as a usage-limit dialog). Everything else rejects the promise with the shape above — an app that writes files should still handle `storage_limit_reached` explicitly rather than letting a save fail quietly, and anything running a loop should treat `429` as a signal to back off.

## Checking usage from your app

- `puter.fs.space()` → `{ capacity, used }` — bytes, live.
- `puter.auth.getMonthlyUsage()` → month-to-date spend and the remaining allowance, per API.
