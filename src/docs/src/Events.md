---
title: Events
description: Watch a user's files and key-value data, and react to changes as they happen.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

The Events API tells your app when something changes. Subscribe to a *subject* — a file, a directory, a path that does not exist yet, a key-value key — and a handler runs every time it changes.

```js
const sub = await puter.events.onLocal('fs:~/Documents', ({ event }) => {
    console.log(event.op, event.path);
});

// ... later
await sub.off();
```

## Terms

Terms used across the Events API and its sub-pages.

#### Subject
What you are watching — a file, a directory, a key-value key, or a slice of the notification mailbox. Written as a short string, e.g. `fs:~/Documents` or `kv:cart`. See [Subjects](#subjects) below.

#### Anchor
`{ uid, path }` of the node a subscription is actually keyed to: the subject itself, or its nearest existing ancestor when the subject names something that does not exist yet. See [Watching something that does not exist yet](#watching-something-that-does-not-exist-yet).

#### Gap marker
An event with `op: 'gap'` sent in place of one or more events a limit dropped. It means "something happened, re-read what you are watching" — not "nothing changed". See [Gaps](#gaps).

#### Delivery class
Whether a persistent subscription's events go to every listener (`broadcast`, the default) or to exactly one consumer that must acknowledge each one (`single`). Set with the `delivery` option on [`onPersistent()`](/Events/onPersistent/).

#### Events worker
The background runtime that invokes an app's published handlers when no client is connected to receive the delivery directly. One per app; it stands up on that app's first published handler. See [`puter.events.workers`](/Events/workers/).

#### Share handle
An opaque token that lets one account subscribe to a slice of another account's key-value namespace without learning whose data it is or where in the namespace it sits. See [Sharing a region with another user](#sharing-a-region-with-another-user).

## Subjects

A subject names what you are watching, and optionally the one operation you care about:

```
fs:<path or uid>[:<op>]
kv:<key>
kv:<appId>:<key>
```

- **Path** — absolute (`/alice/Documents`) or home-relative (`~/Documents`). Subscribing to a directory covers everything under it, at any depth.
- **Uid** — the `uid` of a file or directory, for watching one specific node no matter where it moves to.
- **Op** — one of `add`, `write`, `move`, `remove`, `meta`. Leave it off to get all of them. Nothing emits `meta` yet, so a subscription limited to it stays quiet.

```js
await puter.events.onLocal('fs:~/Documents', handler);              // everything under Documents
await puter.events.onLocal('fs:~/Documents/notes.txt:write', handler); // one file, writes only
await puter.events.onLocal('fs:~/Pictures/*.png', handler);         // one segment of wildcard
await puter.events.onLocal('fs:~/Projects/**/build.log', handler);  // across directories
```

`*` matches within one path segment, `**` crosses directories, and `?` matches one character. A subject may use `*` once per segment and `**` once in total; anything more is rejected with `invalid_subject_pattern`.

```
notif:<audience>
notif:<appId>:<audience>
```

- **Notifications** — `notif:` names a slice of the account's notification mailbox: `notif:account` for notifications about the account, `notif:app-user` for the ones belonging to the app you are running as, `notif:developer` for the ones about an app you own. An app never names its own id; the two-segment form is expanded for you. Unlike `fs:` and `kv:`, notifications are also **stored**, which is what makes [`fetch()`](/Events/fetch/) possible for them and not for the others.

### Key-value subjects

A `kv:` subject watches your app's key-value store. Write it with just the key and it is read against the app you are running as:

```js
await puter.events.onLocal('kv:cart', ({ event }) => refresh(event.key));   // exactly the key `cart`
await puter.events.onLocal('kv:cart*', handler);                            // every key starting with `cart`
```

> **Exact by default; add `*` to widen.** `kv:cart` matches the key `cart` and nothing else, while `kv:cart*` matches every key starting with `cart`. This is the opposite of [`puter.kv.list()`](/KV/list/), whose `pattern` is always a prefix match with or without the `*`.

Only a trailing `*` is allowed. A `*` in the middle, or a `?`, is rejected with `invalid_kv_pattern`.

A key that contains `:` needs the fully qualified three-part form, since the second segment is always read as an app id:

```js
await puter.events.onLocal('kv:orders:pending', handler);   // app `orders`, key `pending`
```

Get your own app's id from `puter.appID` and build the subject from it when your keys are namespaced:

```js
await puter.events.onLocal(`kv:${puter.appID}:orders:pending`, handler);
```

The `subject` and [anchor](#anchor) on the subscription you get back are always fully qualified, whichever form you subscribed with.

Watching **another app's** key-value data takes the same consent as reading it: that app must not have opted out of data sharing, and the user must have granted your app `app-data:<appId>:kv:read`. It is checked when you subscribe and again on every delivery, so deliveries stop the moment either goes away. Where the feature is not enabled, a cross-app subject is refused with `events_cross_app_disabled`.

### Sharing a region with another user

A `kv:` subject always means your own namespace. Watching part of *someone else's* takes a [share handle](#share-handle): the owner mints one over a key prefix and gives it out, and whoever holds it subscribes with the handle where an app id would go:

```js
// The owner, sharing one workspace with another account.
const res = await fetch(`${puter.APIOrigin}/events/kv-handles`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${puter.authToken}`,
    },
    body: JSON.stringify({
        granteeUsername: 'bob',
        // Grant on a segment you will never rename. The handle pins this
        // prefix, so a later reorganization of the keys does not move it.
        prefix: `workspace:${workspaceId}:`,
    }),
});
const { handle } = await res.json();
```

```js
// Bob, watching every key written in that workspace.
// `event.key` is relative to the handle: `messages:1`, not the owner's
// `workspace:<id>:messages:1`.
await puter.events.onLocal(`kv:${handle}:*`, ({ event }) => render(event.key));
```

The handle is the whole of what the holder learns: not whose data it is, not where in the namespace it sits, and not anything above the prefix it was granted on. Events name it too: `subject` and `key` on every delivery are relative to the handle, in the same grammar the subscription was written in. `kv:<handle>:messages:*` narrows to part of the shared region, and one handle per channel gives one subscription covering every key written in that channel.

**Key layout is the access boundary.** A handle pins the prefix it was granted on, and nothing rewrites it afterwards: rename `workspace:<uuid>:` to `project:<uuid>:` and every handle already given out points at keys nothing writes any more. Grant on a **stable synthetic segment** — `workspace:<uuid>:`, `thread:<uuid>:` — rather than a semantic one like `acme-corp:` or `q3-planning:`, which is more likely to get renamed later.

`GET /events/kv-handles` lists what the account has minted, revoked ones included, and `DELETE /events/kv-handles/<handle>` takes one back — the grant goes with it, and every subscription standing on it is suspended with `permission_revoked` and its backlog dropped. Revoking is idempotent: a handle already taken back answers with the moment it stopped rather than an error. An account may hold out 200 live handles at a time; retired ones stay listed and do not count against it. Where the feature is not enabled, minting and handle subjects are refused with `events_kv_handles_disabled`.

A prefix names a region, so it is taken as written: `*` and `?` are refused (`invalid_kv_share_prefix`), and so is an empty key segment — `workspace::abc:` is not read as `workspace:abc:`. Only the trailing delimiter is optional.

An app can mint on its user's behalf, but only inside its own namespace and only where the user has granted it. The consent is `manage:kv-share:<userUuid>:<appId>:<prefix>` (the prefix contributing its segments, so `workspace:abc:` ends the string as `…:workspace:abc`), requested with [`puter.perms.request()`](/Perms/request/). The consent has to name a region: a request over the whole namespace is refused with `invalid_kv_share_prefix`. Minting outside the region it was given, or outside the app's own namespace, is refused with `events_kv_handle_not_delegated` and `events_kv_handle_outside_namespace` respectively. An app that mints a handle still cannot list or revoke it — `GET`/`DELETE /events/kv-handles` only ever answer an account session, and an app calling either is refused with `events_kv_handle_owner_only`.

A key under a handle is relative to the region it was granted on, so anything that reads as an attempt to leave it — a bare handle naming no key, or a key trying to walk out with `..` — is refused with `invalid_kv_handle_key` rather than composed into a path outside the grant.

### Watching something that does not exist yet

A subject is allowed to name a path that is not there. The subscription's [anchor](#anchor) becomes the nearest directory that *does* exist, and the rest of the subject becomes a pattern matched under it — so the event you get is the one where the path appears:

```js
// Nothing at this path yet — the handler runs when it is created.
await puter.events.onLocal('fs:~/Documents/inbox/trigger.json:add', ({ event }) => {
    process(event.path);
});
```

Wildcards work the same way: `*` matches within one path segment, `**` crosses directories, and both cost the same.

### What you are allowed to watch

Subscribing takes the same access as reading. A subject you cannot read — and a subject that is not there — both fail with `subject_does_not_exist`, so the call cannot be used to find out which one it was. Access is re-checked on every delivery too: when a share is revoked, deliveries stop immediately.

## The event

The handler is called with `{ event }`. A filesystem change carries:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | The subject the change was projected onto, naming the node it happened to (`fs:<uid>:<op>`) — not the subject string you subscribed with. |
| `op` | String | `add`, `write`, `move`, or `remove`. |
| `uid` | String | The uid of the node that changed. |
| `path` | String | The path of the node that changed. |
| `from` | String | On a `move`, the path the node left. Only present when the subscription was watching that side — a subscription on the destination folder alone is not told where the node came from. |
| `self` | Boolean | `true` when the change was made by the account holding the subscription. Check it to ignore your own writes. |
| `ts` | Number | When it happened, in milliseconds since the epoch. |
| `seq` | Number | Position within one dispatch, for changes that fan out to several subscriptions. |

A key-value change carries `key` where a filesystem change carries `uid` and `path` — there is no node to name — and a different set of ops:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | `kv:<appId>:<key>`, naming the key that changed. |
| `op` | String | `set` for a write, `del` for a removal, `expire` when only the key's lifetime changed. |
| `key` | String | The key that changed. |
| `self` | Boolean | As above. |
| `ts` | Number | As above. |
| `seq` | Number | As above. |

Nothing else is included — in particular there is no field naming *who* made the change, because on a shared folder that would tell every subscriber who else is in there, and no field carrying the new **value**, so a subscription never becomes a way to read data the delivery check has not just re-authorized.

Emptying a whole store with [`puter.kv.flush()`](/KV/flush/) delivers nothing: no subject names "everything in this namespace went", and the keys a flush can enumerate are not reliably the keys it removed.

### Gaps

Every per-event limit truncates the delivery rather than failing anything, and sends a **gap marker** in its place: an event with `op: 'gap'`, a `reason`, and no `uid` or `path`. A gap means something happened that you were not told the details of, so treat it as "re-read what I am watching", never as "nothing changed". A persistent subscription that was suspended long enough for its held backlog to lapse gets one too, with `reason: 'suspended_backlog_expired'`.

```js
await puter.events.onLocal('fs:~/Documents', async ({ event }) => {
    if (event.op === 'gap') return refreshEverything();
    apply(event);
});
```

## Catching up on what you missed

A subscription delivers while something is listening. For what happened while nothing was, [`puter.events.fetch()`](/Events/fetch/) reads the subject's own store a page at a time:

```js
const page = await puter.events.fetch({ subject: 'notif:account' });
for (const event of page.items) show(event.notification);
if (page.cursor) { /* more where that came from — pass it back as `after` */ }
```

Nothing is registered and no position is kept for you: you hold the cursor. Only `notif:` has a store behind it — `fs:` and `kv:` keep no log and refuse the call rather than answering with an empty page. A notification's `id` is the same whether it arrived live or came back from a fetch, so overlapping the two and dropping ids you have already seen is the way to catch up without missing or repeating anything.

## Two kinds of subscription

`onLocal()` subscriptions are **session-scoped**: nothing is stored, nothing runs while the page is closed, and the server drops them when the connection goes away. Every subscription this client makes rides one connection, which opens on the first `onLocal()` and closes when the last subscription ends. A Puter worker invocation is short-lived, so `onLocal()` there is only useful for the lifetime of that one invocation — a worker that wants to react to changes over time should use [`onPersistent()`](/Events/onPersistent/) with a `worker` target and a published handler instead.

When the connection drops and comes back — a reconnect, a sign-in, an API origin change — the SDK subscribes again for you. The handler and the subscription object stay the same; only `subId` changes, which is why nothing should be stored against it. If re-subscribing fails (the access is gone, the account signed out), or the server closes the connection outright (a revoked session, too many connections), the subscription ends and your `onError` callback is told:

```js
const sub = await puter.events.onLocal('fs:~/Documents', handler, {
    onError: (error) => console.warn('subscription ended:', error.code),
});
```

[`onPersistent()`](/Events/onPersistent/) subscriptions are **stored against the account**. They keep matching with nothing open, survive every reconnect, and end only when you call [`unsubscribe()`](/Events/unsubscribe/) or their `expiresAt` passes. What runs is a *handler* your app deployed by name:

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

### Handlers cannot close over anything

A handler is deployed, not called: it is serialized and run later, somewhere else, so it cannot close over any variable from where it was defined. Values reach it through **`context`** instead, evaluated once at subscribe time and capped at 4 KB. See [`puter.events.handlers`](/Events/handlers/) for the full rules and error codes, and [`onPersistent()`](/Events/onPersistent/) for how `context` is passed in.

Publishing your first handler for an app stands up an [events worker](#events-worker) for it; see [`puter.events.workers`](/Events/workers/) to list and destroy them.

### Running when nobody is there takes consent

A persistent subscription delivers to a connected client when there is one, and runs the app's handler in the background when there is not. The background half is a separate thing to agree to — your code running on the user's account with nobody watching — so it takes the per-app permission **`events:background`**, requested with [`puter.perms.request()`](/Perms/request/) and revocable wherever the user manages the app's access. Without it, subscribing with `worker` among its `targets` (the default for an app) fails with `events_background_consent_required`; taking it back suspends every worker-target subscription that app holds for that user. A subscription that only wants deliveries while your app is open asks for `targets: ['socket']` and needs no consent.

A third target, `'push'`, is reserved for a future device-notification transport. It is accepted today (except on a `single` subscription) but nothing delivers through it yet.

Pass `handler` as a **function** and it runs here too, whenever this client is the one the delivery goes to — the same body that runs in the worker, with the same `{ event, ctx, user, fetch, ack }`. See [`onPersistent()`](/Events/onPersistent/) for the acknowledgement rules; the short version is that a `single` delivery is settled by returning from the handler, and a handler that throws sees the event again.

A persistent subscription can also stop without you unsubscribing: its handler was removed, its holder ran out of credit, the handler kept failing, or the share it was made under was withdrawn. It is then *suspended* rather than deleted, and [`list()`](/Events/list/) reports `suspendedAt` and `suspendedReason`. Everything but a withdrawn grant can resume.

### Where your client is connected does not matter

Puter runs in several places, and a client connects to whichever one is nearest. An event finds the connection wherever it is, `ack()` settles the delivery on whichever connection you called it on, and the shape of everything you receive is identical either way.

The one consequence worth knowing is the one already stated: a `single` delivery is **at-least-once**. Undelivered events are held where the change happened, so a deployment going down loses only what it was still holding — the subscription itself, and everything already delivered, is unaffected. Handlers are asked to be idempotent for this reason, and `event.id` is the key to deduplicate on.

## Limits

Subscriptions per connection, persistent subscriptions per account, published handlers per app, subscribe calls per minute, and how much one event may fan out are all capped — see [Rate Limits and Quotas](/rate-limits-and-quotas/). Deliveries are coalesced over 250 ms per subject, so a multipart upload or a save loop arrives as one event rather than one per write.

## Functions

- **[`puter.events.onLocal()`](/Events/onLocal/)** - Subscribe to a subject for as long as this client is connected
- **[`subscription.off()`](/Events/off/)** - End a session subscription
- **[`puter.events.onPersistent()`](/Events/onPersistent/)** - Subscribe with a subscription that keeps running when your app is closed
- **[`puter.events.list()`](/Events/list/)** - List the persistent subscriptions this caller holds
- **[`puter.events.unsubscribe()`](/Events/unsubscribe/)** - End a persistent subscription
- **[`puter.events.fetch()`](/Events/fetch/)** - Read what a subject recorded while nothing was listening
- **[`puter.events.handlers`](/Events/handlers/)** - Publish, list and remove the named handlers a persistent subscription runs
- **[`puter.events.workers`](/Events/workers/)** - List and destroy the events worker a published handler set stands up
