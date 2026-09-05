---
title: Rate Limits and Quotas
description: The rate limits, usage credits, and storage quotas that apply to Puter.js apps, and how to handle hitting them.
---

<div class="info">This is an advanced reference. Puter.js already handles the common cases for you — a call that runs out of credit or storage surfaces an upgrade prompt to the user automatically, and most apps never need the numbers on this page. Read on if you're designing for high request volumes or want to handle limit errors yourself.</div>

Three separate mechanisms decide whether a call succeeds. They are independent, and hitting any one of them is enough to stop a request:

| Mechanism         | Bounds                                                             | Refills                              | Failure                       |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------ | ----------------------------- |
| **Usage credit**  | what usage _costs_ (AI, egress, KV capacity, storage ops, workers) | monthly, per plan                    | `402` `insufficient_funds`    |
| **Rate limit**    | how many _requests_ are made per window                            | rolling window (10s / 1min / 1h)     | `429` `too_many_requests`     |
| **Storage quota** | how many _bytes_ are kept in the filesystem                        | never — the user deletes or upgrades | `413` `storage_limit_reached` |

A credit balance does not buy rate-limit headroom, and an empty balance does not stop metadata reads that cost nothing. Design for all three.

Because of the [User-Pays Model](/user-pays-model), every limit below applies **per user, per app**: your app's traffic is bounded by each of your users' own accounts, so one heavy user can never exhaust your app for everyone else. Each app a user runs gets its own bucket, and each worker gets its own on top of that, so a busy worker never rate-limits the same user's other apps.

## Usage credit

Usage is charged against the account's monthly credit allowance, metered per operation at real cost.

- Every account starts with a free monthly allowance ([shown in the dashboard](https://puter.com/dashboard#usage)).
- Paid plans carry a larger allowance; see the [plans page](https://puter.com/dashboard#billing) for current tiers.
- Allowances reset monthly and do not roll over. Purchased top-up credits never expire and are spent after the allowance is gone.

What usage costs (the big three):

- **Egress** — every byte sent to a client, on _all_ responses, not just file downloads. This is the one developers underestimate.
- **AI** — priced per model and per token/second/character. `puter.ai.listModels()` reports models; the per-model rates are served by the API (`GET /metering/allCosts`) rather than printed here, because a single number would be wrong for every model.
- **KV and storage operations** — small per-operation costs; reads served from cache are charged a fraction of an uncached read.

A streamed AI response that stops before the model reports its token counts — an upstream error part-way through the response, say — is still charged, on an estimate of what it streamed. A request that produced no output is not charged at all.

AI requests you have in flight count against the balance while they run, at the most they could cost, and are reconciled to their real cost when they finish. Several expensive completions started at once therefore see each other's spend rather than each being told the whole balance is available — the later ones get `402 insufficient_funds` if the balance can't cover them all.

## Rate limits

Every limit is a rolling window, keyed per user and app (and per worker, for calls made from a worker). Where three numbers are shown they are **paid / free / anonymous** — "paid" is any subscription tier.

### AI

Shared by chat, image generation, video, TTS, speech and OCR:

| Limit                                        | Paid | Free | Anonymous |
| -------------------------------------------- | ---- | ---- | --------- |
| Requests per 10s (per interface + method)    | 200  | 30   | 20        |
| Concurrent requests (per interface + method) | 20   | 3    | 2         |

Concurrency is counted per interface, so an image generation and a chat completion do not compete for the same slots.

The OpenAI- and Anthropic-compatible endpoints (`/puterai/openai/v1/*`, `/puterai/anthropic/v1/messages`) additionally require a paid plan — a free account calling them gets `402 subscription_required`. The same models are available to every account through `puter.ai.*` and `/drivers/call`, under the limits above; the model catalogue endpoints stay open to everyone.

### Key-value store

| Limit                           | Paid | Free | Anonymous |
| ------------------------------- | ---- | ---- | --------- |
| `get` / `set` / etc. per 10s    | 400  | 400  | 200       |
| `list` (prefix scan) per minute | 240  | 120  | 60        |
| Concurrent calls                | 30   | 15   | 8         |
| Concurrent `list`               | 5    | 3    | 2         |

Sizes are fixed for every account:

| Size                      | Limit                                     |
| ------------------------- | ----------------------------------------- |
| Key                       | 1 KB                                      |
| Value                     | 400 KB                                    |
| Any number inside a value | ±9,007,199,254,740,991 (2<sup>53</sup>−1) |

A key or value over its size limit is rejected outright. A number over its limit is not: it is stored clamped to the bound, and `NaN` is stored as `null` — the same thing `JSON.stringify()` does with it. This applies to numbers nested anywhere inside an object or array, so a value carrying one still keeps every other field it holds. Anything that has to stay exact past 2<sup>53</sup> — a large id, a running total — should be stored as a string.

### Filesystem

All per minute unless stated:

| Operation                                 | Paid  | Free  | Anonymous |
| ----------------------------------------- | ----- | ----- | --------- |
| `stat`                                    | 1,200 | 600   | 300       |
| `readdir`                                 | 600   | 300   | 120       |
| `readdir` burst (per 10s)                 | 120   | 60    | 30        |
| `read`                                    | 600   | 300   | 120       |
| `write`                                   | 300   | 120   | 30        |
| Multipart upload calls                    | 2,400 | 1,200 | 600       |
| Mutations (mkdir/rename/delete/move/copy) | 1,200 | 900   | 600       |
| Mutations, sustained (per hour)           | 6,000 | 3,000 | 1,800     |
| Search                                    | 60    | 30    | 10        |
| `space()`                                 | 60    | 30    | 15        |
| Sign a URL                                | 300   | 150   | 60        |

| Concurrency | Paid | Free | Anonymous |
| ----------- | ---- | ---- | --------- |
| `read`      | 10   | 5    | 3         |
| `write`     | 15   | 6    | 3         |
| Search      | 5    | 2    | 2         |

Signed-URL routes have no session to key on, so they are bounded per network rather than per account: 3,000 reads/min, 600 writes/min, 60 concurrent.

### WebDAV

The `dav` host authenticates each request itself, so its limits are bounded per network rather than per account: **600 requests/min** and **10 concurrent**, one ceiling for everyone.

A DAV client resends its credentials on every request, so that ceiling can't also bound credential guessing. Failed sign-ins are counted separately — successful ones cost nothing:

| Limit                            | Per 15 minutes |
| -------------------------------- | -------------- |
| Failed sign-ins for one account  | 10             |
| Failed sign-ins from one address | 50             |

Over either, the host answers `429` until the window rolls off — including for the right password. Ten wrong ones lock that account out of `dav` for the rest of the window, so a client left running with a stale password keeps itself locked out; fix the stored password and wait for the window rather than retrying.

This applies only to `dav`. The account is unaffected everywhere else — the desktop, the API and `puter.auth` all keep working throughout.

Mounting with a `-token` username and an API token as the password skips the per-account ceiling entirely, which is the better setup for anything long-lived: the token is revocable from the dashboard without changing the account password, and it can't be locked out by someone else guessing at your account.

### Sites and workers

| Limit                               | Paid | Free | Anonymous |
| ----------------------------------- | ---- | ---- | --------- |
| Subdomain reads per 10s             | 200  | 200  | 100       |
| Subdomain `create` per minute       | 120  | 60   | 30        |
| Concurrent subdomain calls          | 20   | 10   | 5         |
| Worker metadata reads per minute    | 600  | 300  | 150       |
| Worker `create` (deploy) per minute | 120  | 80   | 40        |
| Worker `destroy` per minute         | 30   | 20   | 10        |
| Concurrent worker calls             | 10   | 5    | 3         |
| Concurrent deploys                  | 5    | 2    | 2         |

### Sharing

Sharing is bounded twice: on the calls, and on how many people one account can reach in a day.

| Limit                                        | All accounts |
| -------------------------------------------- | ------------ |
| `share` / `revoke` calls per minute          | 60           |
| `share` / `revoke` calls per day             | 500          |
| Reads (`getShares`, `listShared`, `listSharedByMe`) per minute | 600 |
| New shares per day                           | 200          |
| Recipients per request                       | 10           |
| Items per request                            | 50           |

The read limit is one bucket shared by every share-listing call, so polling one of them spends budget the others need.

A "new share" is one that gives someone access they didn't already have. Changing the mode on an existing share, or re-sharing an item the recipient already has, costs nothing. Over the daily limit, `share` fails with `share_daily_limit_reached`.

Separately, the notification and email that tell a recipient about a share are budgeted — being told is not the same as being interrupted about it:

| Announcement                     | Limit                        |
| -------------------------------- | ---------------------------- |
| From one sender to one recipient | 1 per 15 minutes, 20 per day |
| To one recipient, from anyone    | 10 per hour, 50 per day      |

Recipients are emailed by default and opt out with the unsubscribe link the mail carries; a deployment can turn share email off entirely with `share_email_notifications: false`.

Over these, **the share still succeeds** — only the announcement is dropped. The recipient's notification is kept up to date either way, and folds several senders into one ("alice and bob shared 5 items with you"), so nothing is lost; it just doesn't interrupt them again. Emails are additionally batched: everything triggered for one recipient within a 90-second window goes as a single digest message. Recipients can also refuse shares outright — from one sender, or from everyone — which fails that sender's `share` call with `recipient_not_accepting_shares`. Both are managed from **Settings → Security → Blocked people**.

### Events

One write can reach many subscriptions, so events are bounded on both halves: how much you may register, and how much any one event may turn into.

Durable subscriptions are the ones that outlive a connection, so they are the half that varies by plan:

| Limit                                     | Paid | Free | Anonymous |
| ----------------------------------------- | ---- | ---- | --------- |
| Durable subscriptions per account         | 500  | 100  | —         |
| Durable subscriptions per app, per account | 100  | 25   | —         |

A temporary (anonymous) account cannot create durable subscriptions at all — `subscribe` fails with `events_durable_requires_account`, and session subscriptions, which live and die with the connection, are the surface it has. Past either cap the call fails with `events_subscription_limit`; unsubscribing frees a slot immediately.

| Limit                                        | All accounts |
| -------------------------------------------- | ------------ |
| Subject length                               | 4,096 characters |
| Subscriptions per connection                 | 50           |
| `subscribe` / `unsubscribe` calls per minute | 60           |
| Subscription listings per minute             | 120          |
| Subscription listing page size               | 200          |
| Key-value share-handle calls per minute      | 60           |
| Live key-value share handles per account     | 200          |
| Key-value share-handle listing page size     | 200          |
| Missed-event fetches per minute              | 120          |
| Events per fetch page                        | 200          |
| Matched subscriptions per event              | 50           |
| Filter evaluations per event                 | 200          |
| Broadcast deliveries per minute, per subscription | 600     |
| `single` deliveries per minute, per subscription | 120      |
| Handler invocations per minute, per (account, app) | 60     |
| Acknowledgements per minute                  | 600          |
| Undelivered deliveries per subscription      | 10,000       |
| Undelivered deliveries per *suspended* subscription | 100   |
| Suspended subscriptions kept for             | 30 days      |
| Handler invocation timeout                   | 30 seconds   |
| Wait before retrying a failed handler        | 2 seconds, doubling |
| Longest wait between retries                 | 5 minutes    |
| Handler failures in a row before suspension  | 5            |
| Published handlers per app                   | 100          |
| Handler source size                          | 64 KB        |
| Handlers per `publishAll` call               | 50           |
| Handler publish / remove calls per minute    | 60           |
| Handler listings per minute                  | 120          |
| Events worker listings per minute            | 120          |
| Events worker listing page size              | 200          |

`fetch()` reads a page of what a subject recorded rather than a delivery, so it is budgeted with the listings: a page defaults to 50 events and is capped at 200, and a client catching up walks pages until one comes back with no cursor. Only `notif:` has a store to read — the notification mailbox, kept for as long as the deployment's retention window (deployment-configured, no fixed number here) — and any other subject family is refused with `fetch_unsupported_subject`.

Subscriptions come in two kinds. A **session** subscription lives with the connection that made it: it is dropped when the connection closes, and a reconnecting client subscribes again. A **durable** subscription outlives every connection — it is created over the API, listed and revoked from the account, and keeps delivering until you remove it or it expires.

The 51st subscription on one connection, and the durable subscription past your plan's cap, both fail with `events_subscription_limit`. Over the call budget, `subscribe` and `unsubscribe` fail with `too_many_requests`. Subscribing to something you cannot read fails with `subject_does_not_exist` — the same answer as subscribing to something that is not there, so the call cannot be used to find out which.

A durable subscription may carry a `context`: JSON that is stored with it and handed to its handler on every delivery, capped at a hard **4 KB** and rejected over that with `events_context_too_large` — client-side, before the request. It is stored in plaintext and read only on the delivery path; listings return its **key names and a content hash**, never its values. For anything larger, store it in a file and put the path in `context`. An app sees and revokes only the subscriptions it created; a session acting for the account sees them all, including ones left behind by an app that has since been removed.

A durable subscription runs a **handler** its app published by name. An app may publish **100** of them, each up to **64 KB** of source, and a name is unique inside one app. All of an app's handlers combined may not exceed **5 MB** of source; a publish that would push the total over that is refused with `events_worker_too_large`. Publishing is a developer operation: the account has to own the app. Publishing the same source again is a no-op; publishing different source under a name whose current source the caller did not name as its base is refused with `events_handler_conflict`, so two racing build steps never silently pick a winner — `replace: true` is how a caller says it means to take the name. Handler source is never returned by any listing.

The first published handler brings up an **events worker** for that app; the last one removed, or `puter.events.workers.destroy()`, takes it down. An app's events worker may (re)deploy at most **30 times an hour**; past that, delivery stays retriable until the hour rolls over. `puter.events.workers.list()` shows every app you own that currently has one — see [`puter.events.workers`](/Events/workers/) for details, including how a hosted deployment may bill it.

**A subscription can end or stop without you unsubscribing.** Access is re-checked against the stored permission on every delivery, so a share that is taken back stops delivering immediately; the subscription is then *suspended*, with `suspendedAt` and `suspendedReason` in `list`. There are four reasons:

| `suspendedReason` | Cause | Resumes when |
| --- | --- | --- |
| `handler_not_found` | The handler it is bound to was removed | The name is published again |
| `failures` | Its handler failed or timed out repeatedly | The subscription is republished against a working handler |
| `no_credit` | Its holder ran out of credit | The balance is restored |
| `permission_revoked` | The grant it was made under was withdrawn | **Never** — subscribe again |

A suspended subscription stops delivering and stops being metered, so it cannot go on holding a full backlog for free: what it is owed is trimmed to **100** deliveries and given a deadline — **24 hours** for `handler_not_found` and `failures`, **1 hour** for `no_credit` — after which they are dropped and one `gap` marker with `reason: 'suspended_backlog_expired'` takes their place. A subscription suspended by `permission_revoked` has its backlog **purged immediately**: it names paths its holder has just lost the right to see, and holding them for a resume that by design never comes would turn a revocation into a delayed disclosure. A suspended row itself is deleted **30 days** after it stops.

Deleting the node a subscription is anchored on ends it too, unless the subject named a path or a pattern, in which case it follows that path up to the nearest folder that still exists and keeps watching, so recreating the path resumes delivery.

Match patterns are compiled once when you subscribe and are capped at **256 characters** and **16 segments**, with **one `*` per segment** and **one `**` per pattern**; anything past that is rejected with `invalid_subject_pattern`. `**` crosses directories and costs no more than `*`.

A `kv:` subject is indexed on the first **6** `:`-segments, or **160 bytes**, of its key — whichever comes first; past that the remainder becomes a match pattern, which is subject to the caps above. A key-value subject matches its key exactly unless it ends in `*`, and a `*` anywhere else — or a `?` — is rejected with `invalid_kv_pattern`. Watching another app's key-value data is refused with `events_cross_app_disabled` where that is not enabled, and otherwise takes the same consent as reading it.

**Deliveries are coalesced over 250 ms per subject.** A multipart upload, a save loop, or a recursive delete is one thing the user did, and it arrives as one event carrying the newest state rather than as one event per write. Two different files in the same window are two deliveries.

The two per-event ceilings — matched subscriptions and filter evaluations — do not fail your call: they truncate the delivery and send a `gap` marker in its place, with `reason: 'matched_subscription_limit'` or `reason: 'filter_evaluation_limit'` respectively — an event with `op: 'gap'` and no `uid` or `path`. A gap means something happened that you were not told the details of, so a client that must not miss changes should re-read the anchor when it sees one rather than treat the silence as "nothing changed".

A **background delivery** — one that runs your app's handler with nobody there — takes the user's consent, the per-app permission `events:background`, and a subscription targeting `worker` without it is refused with `events_background_consent_required`. The handler runs as your app's own session for that user — the same reach it has from a tab, not a credential cut down to this one subscription's grant — and that session is what the consent authorizes running unattended; it shows up in the user's sessions list as a worker session, and revoking it there stops every background delivery for your app the same way withdrawing the permission does. A handler has **30 seconds** to answer each invocation. Answering `2xx` takes the delivery; `4xx` refuses it, and it is dropped with a `gap` marker carrying `reason: 'handler_rejected'` rather than sent again to the same answer; `5xx`, `429` and a timeout are all "not now", and the delivery is held **2 seconds** before the next attempt, doubling each time up to **5 minutes**. **Five failures in a row** — refusals included — suspend the subscription with `failures`, hold what it is owed under the suspended-backlog rules above, and notify the app's developer. Publishing a handler is all the deployment there is: the app's events worker is brought up the first time a delivery needs it, and again if it has been idle long enough to be evicted, so the first background delivery after a publish pays a short cold start. Nothing else can invoke it — it answers one platform route, and only the platform can reach it.

A `single` subscription is delivered to exactly one consumer, which has **60 seconds** — twice the handler invocation timeout, so a slow but successful handler is never re-invoked mid-run — to acknowledge each delivery before it is offered again, twice to a connected client and then to the subscription's handler. Until it is acknowledged it is held for you, so a consumer that is away is a backlog that grows: **10,000** undelivered deliveries per subscription, after which the oldest are dropped and one `gap` marker with `reason: 'backlog_overflow'` takes their place. Each region also holds at most **1,000,000** undelivered deliveries across every subscription it serves, and sheds the oldest first — with the same marker — before it reaches that. A redelivery after a missed acknowledgement is normal and expected: deliveries are at-least-once, `event.id` is stable across them, and a handler that runs twice on the same id should do nothing the second time.

Both per-minute delivery budgets are spent per subscription and answered with a `gap` marker carrying `reason: 'delivery_rate_limit'` rather than an error. The handler budget is different: a delivery that arrives when its app has spent the minute's invocations is **not** failed and does not count as a handler failure — it stays owed and goes out on a later attempt.

#### What events cost

Deliveries are metered to the **subscription's holder** — your data, your subscriptions, your bill. A subscription that sits idle costs nothing; the plan quotas above are what bound how many you can hold.

| Line                        | Rate           | Counted per                     |
| --------------------------- | -------------- | ------------------------------- |
| `events:delivery:broadcast` | 10 µ¢          | delivered event                 |
| `events:delivery:single`    | 100 µ¢         | delivered event                 |

A `single` costs more because it is leased and acknowledged; a broadcast copy is a socket write. Handler runs bill separately through the usual worker path.

Only deliveries that actually happen are billed. An event a filter excluded, several writes the 250 ms window collapsed into one, a delivery a permission re-check stopped, and every `gap` marker are all free — a marker says something was lost, and charging for the loss would be charging you twice. Session subscriptions are billed at the broadcast rate like any other.

Deliveries stop when the holder's balance runs out: the subscription is suspended with `suspendedReason: 'no_credit'`, the holder is notified, and nothing further is metered against it. What it was owed is held for **1 hour**. Restoring the balance resumes it — checked periodically rather than the instant a payment lands, so allow a few minutes after topping up.

### Peer connections

| Limit                          | Paid | Free | Anonymous |
| ------------------------------ | ---- | ---- | --------- |
| Relay credentials per minute   | 30   | 10   | 5         |
| Guest grants issued per minute | 30   | 10   | 5         |

Signalling details are public deployment config and bounded per network instead of per account, at 3,000 reads/min.

Guests are bounded per _host_: everyone holding grants from the same account shares **60 relay-credential requests/min**. Relay traffic a guest sends is metered against the account that issued the grant, so treat a grant as something that spends your allowance — issue it for the session you meant to host, and let it expire rather than reusing one indefinitely.

### Everything at once

Every driver call also passes one shared per-account budget of **8,000 calls/min** before the per-API limits above. It exists to catch a runaway loop, not to shape normal traffic — a client that sees a 429 from it is looping.

## Storage quota

Every account has a byte quota for the filesystem (100 MiB free; paid plans add more). Storage is what the user is _keeping_, not what they transferred — deleting files frees it immediately. At the limit, writes fail with `413` `storage_limit_reached`; reads keep working. `puter.fs.space()` returns `{ capacity, used }` live.

## What happens when you hit a limit

| Status | `code`                  | Meaning                               | What to do                                                                        |
| ------ | ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `429`  | `too_many_requests`     | Rate or concurrency limit             | Back off and retry; the window is at most 60s (or 1h for the sustained FS budget) |
| `402`  | `insufficient_funds`    | Monthly credit spent                  | The user buys credit or upgrades; resets next month                               |
| `402`  | `subscription_required` | The endpoint is limited to paid plans | The user upgrades — retrying or waiting changes nothing                           |
| `413`  | `storage_limit_reached` | Storage quota reached                 | The user deletes files or upgrades                                                |

Errors come back as JSON: `{ "error": …, "message": …, "code": … }`.

### What Puter.js already does for you

The SDK turns the money-shaped failures into prompts without any code on your part: an AI call that runs out of credit and a filesystem write that runs out of space both surface an upgrade dialog to the user (in an app via `puter.ui.requestUpgrade()`, on the web as a usage-limit dialog). Everything else rejects the promise with the shape above — an app that writes files should still handle `storage_limit_reached` explicitly rather than letting a save fail quietly, and anything running a loop should treat `429` as a signal to back off.

## Checking usage from your app

- `puter.fs.space()` → `{ capacity, used }` — bytes, live.
- `puter.auth.getMonthlyUsage()` → month-to-date spend and the remaining allowance, per API.
