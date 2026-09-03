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

`fs:` and `kv:` subjects can be subscribed to; `notif:` is reserved and still rejected.

### Key-value subjects

A `kv:` subject watches your app's key-value store. Write it with just the key and it is read against the app you are running as:

```js
await puter.events.onLocal('kv:cart', ({ event }) => refresh(event.key));   // exactly the key `cart`
await puter.events.onLocal('kv:cart*', handler);                            // every key starting with `cart`
```

> **Exact by default; add `*` to widen.** `kv:cart` matches the key `cart` and nothing else, while `kv:cart*` matches every key starting with `cart`. This is the opposite of [`puter.kv.list()`](/KV/list/), whose `pattern` is always a prefix match with or without the `*` — a subscription has to be able to tell one key from a whole subtree, and a list does not.

Only a trailing `*` is allowed. A `*` in the middle, or a `?`, is rejected with `invalid_kv_pattern`, because the server has to be able to work out an event's subjects from the key alone.

A key that contains `:` needs the fully qualified three-part form, since the second segment is always read as an app id:

```js
await puter.events.onLocal('kv:orders:pending', handler);   // app `orders`, key `pending`
```

Get your own app's id from `puter.appID` and build the subject from it when your keys are namespaced:

```js
await puter.events.onLocal(`kv:${puter.appID}:orders:pending`, handler);
```

The `subject` and `anchor` on the subscription you get back are always fully qualified, whichever form you subscribed with.

Watching **another app's** key-value data takes the same consent as reading it: that app must not have opted out of data sharing, and the user must have granted your app `app-data:<appId>:kv:read`. It is checked when you subscribe and again on every delivery, so deliveries stop the moment either goes away. Where the feature is not enabled, a cross-app subject is refused with `events_cross_app_disabled`.

### Watching something that does not exist yet

A subject is allowed to name a path that is not there. The subscription anchors on the nearest directory that *does* exist and the rest of the subject becomes a pattern, so the event you get is the one where it appears:

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

Every per-event limit truncates the delivery rather than failing anything, and sends a **gap marker** in its place: an event with `op: 'gap'`, a `reason`, and no `uid` or `path`. A gap means something happened that you were not told the details of, so treat it as "re-read what I am watching", never as "nothing changed".

```js
await puter.events.onLocal('fs:~/Documents', async ({ event }) => {
    if (event.op === 'gap') return refreshEverything();
    apply(event);
});
```

## Subscriptions live with the connection

`onLocal()` subscriptions are **session-scoped**: nothing is stored, nothing runs while the page is closed, and the server drops them when the connection goes away. Every subscription this client makes rides one connection, which opens on the first `onLocal()` and closes when the last subscription ends. In a worker that means the subscription lasts as long as the invocation that made it, and no longer.

When the connection drops and comes back — a reconnect, a sign-in, an API origin change — the SDK subscribes again for you. The handler and the subscription object stay the same; only `subId` changes, which is why nothing should be stored against it. If re-subscribing fails (the access is gone, the account signed out), or the server closes the connection outright (a revoked session, too many connections), the subscription ends and your `onError` callback is told:

```js
const sub = await puter.events.onLocal('fs:~/Documents', handler, {
    onError: (error) => console.warn('subscription ended:', error.code),
});
```

## Limits

Subscriptions per connection, subscribe calls per minute, and how much one event may fan out are all capped — see [Rate Limits and Quotas](/rate-limits-and-quotas/). Deliveries are coalesced over 250 ms per subject, so a multipart upload or a save loop arrives as one event rather than one per write.

## Functions

- **[`puter.events.onLocal()`](/Events/onLocal/)** - Subscribe to a subject for as long as this client is connected
- **[`subscription.off()`](/Events/off/)** - End a subscription
