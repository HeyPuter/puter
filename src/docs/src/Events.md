---
title: Events
description: Watch a user's files and key-value data, and react to changes as they happen.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

The Events API tells your app when something changes. Subscribe to a *subject* (a file, a directory, a path that doesn't exist yet, or a key-value key) and your handler runs every time it changes.

```js
const sub = await puter.events.onLocal('fs:~/Documents', ({ event }) => {
    console.log(event.op, event.path);
});

// ... later
await sub.off();
```

## Terms

#### Subject
What you watch, written as a string such as `fs:~/Documents` or `kv:cart`. See [Subjects](#subjects).

#### Anchor
The `{ uid, path }` of the node a subscription is attached to: the subject itself, or its nearest existing parent when the subject doesn't exist yet.

#### Session subscription
Made with [`onLocal()`](/Events/onLocal/). It lives on this client's connection and ends when the connection closes.

#### Persistent subscription
Made with [`onPersistent()`](/Events/onPersistent/). It's stored on the account, keeps running while your app is closed, and runs a published handler.

#### Handler
Code your app publishes under a name for persistent subscriptions to run. See [`puter.events.handlers`](/Events/handlers/).

#### Events worker
Runs an app's handlers when no client is connected to receive a delivery. Each app has one, created when it publishes its first handler. See [`puter.events.workers`](/Events/workers/).

#### Delivery class
How a persistent subscription delivers: `broadcast` (the default) sends each event to every listener, and `single` sends it to exactly one consumer, which must acknowledge it.

#### Gap marker
An event with `op: 'gap'`, sent in place of events a limit dropped. It means "something changed, re-read what you're watching", not "nothing changed". See [Gaps](#gaps).

#### Share handle
A token that lets another account watch part of your key-value data without learning whose data it is or where it sits. See [Sharing key-value data with another user](#sharing-key-value-data-with-another-user).

## Subjects

```
fs:<path or uid>[:<op>]
kv:<key>
kv:<appId>:<key>
notif:<audience>
notif:<appId>:<audience>
```

### Files

- **Path**: absolute (`/alice/Documents`) or home-relative (`~/Documents`). A directory covers everything under it, at any depth.
- **Uid**: the `uid` of a file or directory, to follow one node wherever it moves.
- **Op**: one of `add`, `write`, `move`, `remove`, `meta`. Leave it off to get all of them. Nothing emits `meta` yet.

```js
await puter.events.onLocal('fs:~/Documents', handler);                  // everything under Documents
await puter.events.onLocal('fs:~/Documents/notes.txt:write', handler);  // one file, writes only
await puter.events.onLocal('fs:~/Pictures/*.png', handler);             // wildcard within one segment
await puter.events.onLocal('fs:~/Projects/**/build.log', handler);      // across directories
```

`*` matches within one path segment, `**` crosses directories, and `?` matches one character. A subject may use one `*` per segment and one `**` in total; more is rejected with `invalid_subject_pattern`.

#### Watching something that doesn't exist yet

A subject can name a path that isn't there. The subscription anchors on the nearest existing directory and matches the rest as a pattern, so you get the event when the path appears:

```js
// Nothing at this path yet. The handler runs when it's created.
await puter.events.onLocal('fs:~/Documents/inbox/trigger.json:add', ({ event }) => {
    process(event.path);
});
```

If the anchor is deleted, a subscription made with a uid ends. One made with a path or pattern moves up to the nearest folder that still exists and keeps watching, so recreating the path resumes delivery.

### Notifications

`notif:` watches part of the account's notification mailbox:

- `notif:account`: notifications about the account.
- `notif:app-user`: notifications belonging to the app you're running as.
- `notif:developer`: notifications about an app you own.

The two-segment form is expanded to your app's id for you. Notifications are stored, which is why only `notif:` works with [`fetch()`](/Events/fetch/).

### Key-value data

A `kv:` subject watches your app's key-value store:

```js
await puter.events.onLocal('kv:cart', ({ event }) => refresh(event.key));   // exactly the key `cart`
await puter.events.onLocal('kv:cart*', handler);                            // every key starting with `cart`
```

> **Exact by default; add `*` to widen.** `kv:cart` matches only `cart`, and `kv:cart*` matches every key starting with `cart`. This is the opposite of [`puter.kv.list()`](/KV/list/), which always matches a prefix.

Only a trailing `*` is allowed. A `*` anywhere else, or a `?`, is rejected with `invalid_kv_pattern`.

The segment after `kv:` is read as an app id when there are more segments after it, so a key that contains `:` needs the full three-part form:

```js
await puter.events.onLocal('kv:orders:pending', handler);                  // app `orders`, key `pending`
await puter.events.onLocal(`kv:${puter.appID}:orders:pending`, handler);   // your app, key `orders:pending`
```

The `subject` and [anchor](#anchor) on the returned subscription are always in the full form.

#### Getting the new value

A delivery names the key, not its value. Pass `includeValue: true` to receive the new value as `event.value` (`null` on a `del`, absent on an `expire`):

```js
await puter.events.onLocal('kv:cart', ({ event }) => render(event.value), { includeValue: true });
```

The value is left out, and you read the key yourself, when:

- it's over **16 KB** serialized, or
- more than **128** subscriptions match the change in that region (including ones that didn't ask for values), or the filter-check limit stops the count early.

`includeValue` only works on `kv:` subjects; elsewhere it's refused with `invalid_include_value`.

#### Another app's data

Watching another app's key-value data takes the same consent as reading it: the app must allow data sharing, and the user must grant your app `app-data:<appId>:kv:read`. Both are checked when you subscribe and on every delivery. Where cross-app watching is off, the subject is refused with `events_cross_app_disabled`.

Entries the other app wrote with `disableSharing` are never delivered. Marking a key private produces no event, so a value you already have for it may be stale.

### Sharing key-value data with another user

`kv:` always means your own data. To let another account watch part of yours, mint a [share handle](#share-handle) over a key prefix and give it to them. They subscribe with the handle where an app id would go:

```js
// The owner shares one workspace with another account.
const res = await fetch(`${puter.APIOrigin}/events/kv-handles`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${puter.authToken}`,
    },
    body: JSON.stringify({
        granteeUsername: 'bob',
        // Use a segment you'll never rename: the handle is fixed to this prefix.
        prefix: `workspace:${workspaceId}:`,
    }),
});
const { handle } = await res.json();
```

```js
// Bob watches every key written in that workspace.
// `event.key` is relative to the handle: `messages:1`, not `workspace:<id>:messages:1`.
await puter.events.onLocal(`kv:${handle}:*`, ({ event }) => render(event.key));
```

- **The holder learns only the handle**: not whose data it is, where it sits, or anything above the prefix. `subject` and `key` in their deliveries are relative to the handle. `kv:<handle>:messages:*` narrows to part of the shared region.
- **Values:** `includeValue` works through a handle, with the same limits. A handle grants events, not reads, so when a value is left out the holder needs some other authorized way to read it.
- **Use a stable prefix.** A handle stays on the prefix it was minted on. Rename `workspace:<uuid>:` to `project:<uuid>:` and existing handles point at keys nothing writes. Prefer synthetic ids (`workspace:<uuid>:`, `thread:<uuid>:`) over names that might change (`acme-corp:`).
- **Prefixes are literal.** `*`, `?` and empty segments (`workspace::abc:`) are refused with `invalid_kv_share_prefix`. The trailing `:` is optional.
- **Keys can't leave the handle.** A handle with no key after it, or a key using `..`, is refused with `invalid_kv_handle_key`.

**Managing handles.** `GET /events/kv-handles` lists the handles the account has minted, revoked ones included. `DELETE /events/kv-handles/<handle>` revokes one, and every subscription on it is suspended with `permission_revoked` and its backlog dropped. Revoking an already-revoked handle isn't an error. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for how many handles an account can hold. Temporary accounts can't mint handles (`events_kv_handle_requires_account`). Where the feature is off, minting and handle subjects fail with `events_kv_handles_disabled`.

**Apps.** An app can mint, list and revoke handles for its user, but only inside its own namespace and with the user's consent: `manage:kv-share:<userUuid>:<appId>:<prefix>`, requested with [`puter.perms.request()`](/Perms/request/). The prefix supplies its segments, so `workspace:abc:` ends the permission as `…:workspace:abc`. The consent must name a prefix; asking for the whole namespace is refused with `invalid_kv_share_prefix`. An app that lists handles sees only its own namespace.

| Refused with | When |
| --- | --- |
| `events_kv_handle_not_delegated` | Minting or revoking outside the consented prefix, or after the consent was withdrawn (the handle stays in place). |
| `events_kv_handle_outside_namespace` | Minting outside the app's own namespace. |
| `events_kv_handle_owner_only` | The caller is an access token the app issued, a different app of the same user, or the handle is outside the app's namespace. |

An app can also subscribe through a handle, but only when the shared region belongs to that same app. A different app, even for the same user, is refused as if the handle didn't exist.

### What you're allowed to watch

Subscribing takes the same access as reading. A subject you can't read and a subject that doesn't exist both fail with `subject_does_not_exist`, so the error doesn't reveal which. Access is checked again on every delivery: when a share is revoked, deliveries stop immediately.

## The event

The handler is called with `{ event }`. A filesystem change carries:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | The node it happened to, as `fs:<uid>:<op>`. Not the subject you subscribed with. |
| `op` | String | `add` (a create, or a copy's destination), `write`, `move` (a move or a rename), or `remove`. |
| `uid` | String | The uid of the node that changed. |
| `path` | String | The path of the node that changed. |
| `from` | String | On a `move`, the path the node left. Only present when the subscription was watching that location. |
| `self` | Boolean | `true` when the account holding the subscription made the change. Use it to ignore your own writes. |
| `ts` | Number | When it happened, in milliseconds since the epoch. |
| `seq` | Number | Position within one dispatch, when a change goes to several subscriptions. |

A key-value change carries `key` instead of `uid` and `path`, and different ops:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | `kv:<appId>:<key>`, naming the key that changed. |
| `op` | String | `set` for a write, `del` for a removal, `expire` when only the key's lifetime changed. |
| `key` | String | The key that changed. |
| `value` | Any | The new value (`null` on a `del`). Only with `includeValue`, and only within the [limits above](#getting-the-new-value). Never on an `expire`. |
| `self` | Boolean | As above. |
| `ts` | Number | As above. |
| `seq` | Number | As above. |

Events never say *who* made a change: on a shared folder, that would tell every subscriber who else has access.

[`puter.kv.flush()`](/KV/flush/) delivers nothing, since the keys a flush can list aren't reliably the keys it removed.

### Gaps

Limits never make a subscription fail. Instead they send a **gap marker** in place of what was dropped: an event with `op: 'gap'`, a `reason`, and no `uid` or `path`. Treat it as "re-read what I'm watching", never as "nothing changed".

| `reason` | Cause |
| --- | --- |
| `matched_subscription_limit` | The event matched more subscriptions than one event may reach. |
| `filter_evaluation_limit` | The event had more subscription filters to check than one event may check. |
| `delivery_rate_limit` | This subscription went over its per-minute delivery rate. |
| `backlog_overflow` | The undelivered backlog was full, so the oldest deliveries were dropped. |
| `handler_rejected` | The handler refused the delivery (a `4xx`, or a thrown terminal error). |
| `suspended_backlog_expired` | The subscription stayed suspended past the time its backlog is kept. |

```js
await puter.events.onLocal('fs:~/Documents', async ({ event }) => {
    if (event.op === 'gap') return refreshEverything();
    apply(event);
});
```

## Catching up on what you missed

A subscription only delivers while something is listening. For what happened in between, [`puter.events.fetch()`](/Events/fetch/) reads a subject's stored events a page at a time:

```js
const page = await puter.events.fetch({ subject: 'notif:account' });
for (const event of page.items) show(event.notification);
if (page.cursor) { /* more pages: pass it back as `after` */ }
```

You keep the cursor; nothing is stored for you. Only `notif:` has stored events. `fs:` and `kv:` are refused rather than answered with an empty page. A notification has the same `id` live and from `fetch()`, so you can run both and drop duplicates.

## Session subscriptions

`onLocal()` subscriptions store nothing and run nothing while the page is closed. All of a client's session subscriptions share one connection, opened by the first `onLocal()` and closed when the last one ends.

In a Puter worker, a session subscription only lasts for that one invocation. To react to changes from a worker, use [`onPersistent()`](/Events/onPersistent/) with a published handler.

If the connection drops (a network blip, a sign-in, an API origin change, or the server closing it), the SDK reconnects and subscribes again. The handler and subscription object stay the same; only `subId` changes, so don't store anything against it. `onError` is called only if the subscription can't be restored: re-subscribing fails, the reconnect is refused (`reauth_required` after a sign-out), or the server keeps closing the connection (`events_connection_failed`).

```js
const sub = await puter.events.onLocal('fs:~/Documents', handler, {
    onError: (error) => console.warn('subscription ended:', error.code),
});
```

## Persistent subscriptions

[`onPersistent()`](/Events/onPersistent/) subscriptions are stored on the account. They keep matching with nothing open, survive reconnects, and end only when you call [`unsubscribe()`](/Events/unsubscribe/) or their `expiresAt` passes. Each one runs a handler your app published by name:

```js
// Once, at deploy time
await puter.events.handlers.publish('ingestUpload', async ({ event, ctx }) => {
    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
}, { appUid });

// Per user, when they opt in
await puter.events.onPersistent({
    subject: 'fs:~/inbox',
    handlerName: 'ingestUpload',
    context: { endpoint: 'https://example.com/ingest' },
});
```

A delivery goes to a connected client when there is one, and to the app's [events worker](#events-worker) when there isn't. Pass `handler` as a function to run it in this client too; it's the same code, called with the same `{ event, ctx, user, fetch, ack }`.

### Handlers can't use outside variables

A handler is serialized and run later, somewhere else, so it can't use variables from where it was defined. Pass values through **`context`** instead, which is captured once when you subscribe and capped at 4 KB. See [`puter.events.handlers`](/Events/handlers/) for the rules.

### Running in the background needs consent

Running your handler while the user isn't there needs the per-app permission **`events:background`**, requested with [`puter.perms.request()`](/Perms/request/). Without it, a subscription that targets `worker` (the default for an app) fails with `events_background_consent_required`. If the user revokes it, every worker-target subscription the app holds for them is suspended. A subscription that only wants deliveries while your app is open can pass `targets: ['socket']` and needs no consent.

The `'push'` target is reserved for future device notifications. It's accepted (except on `single` subscriptions) but delivers nothing yet.

### Suspended subscriptions

A persistent subscription can stop without being unsubscribed. It's then *suspended*, not deleted, and [`list()`](/Events/list/) shows `suspendedAt` and `suspendedReason`:

| `suspendedReason` | Cause | Resumes when |
| --- | --- | --- |
| `handler_not_found` | Its handler was removed. | A handler is published under that name again. |
| `failures` | Its handler failed 5 times in a row. | The handler is republished. |
| `no_credit` | Its holder ran out of credit. | The balance is topped up (checked every few minutes). |
| `permission_revoked` | The permission or share it relied on was withdrawn. | **Never.** Subscribe again. |

A suspended subscription stops delivering and isn't billed. Its backlog is cut to 100 deliveries and kept for 24 hours (`handler_not_found`, `failures`) or 1 hour (`no_credit`), then replaced by one gap marker. A `permission_revoked` backlog is dropped immediately. Suspended subscriptions are deleted after 30 days.

### Delivery guarantees

Clients connect to the nearest region. Events reach a client wherever it's connected, and `ack()` works on any connection.

- `single` deliveries are **at-least-once**: one may arrive twice, with the same `event.id`. Make handlers safe to run twice.
- Undelivered events are held in the region where the change happened. If that region goes down, only what it was holding is lost.
- Order is kept within a region and is best-effort across regions. Coalescing (250 ms) also runs per region, so two quick writes can arrive as one event nearby and as two farther away.

## Limits

The main ones:

- 50 session subscriptions per connection.
- 500 persistent subscriptions per paid account, 100 per free account, and a smaller share for each app.
- One KV change reaches at most 512 subscriptions per region for a paid key owner and 128 for a free one. Other events reach 50. These count subscriptions, not people.
- Writes to the same subject within 250 ms arrive as one event.

See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for every limit and what each is counted against.

## Functions

- **[`puter.events.onLocal()`](/Events/onLocal/)** - Subscribe for as long as this client is connected
- **[`subscription.off()`](/Events/off/)** - End a session subscription
- **[`puter.events.onPersistent()`](/Events/onPersistent/)** - Subscribe with a subscription that keeps running when your app is closed
- **[`puter.events.list()`](/Events/list/)** - List the persistent subscriptions this caller holds
- **[`puter.events.unsubscribe()`](/Events/unsubscribe/)** - End a persistent subscription
- **[`puter.events.fetch()`](/Events/fetch/)** - Read what a subject recorded while nothing was listening
- **[`puter.events.handlers`](/Events/handlers/)** - Publish, list and remove the named handlers persistent subscriptions run
- **[`puter.events.workers`](/Events/workers/)** - List and destroy an app's events worker
