---
title: puter.events.onLocal()
description: Subscribe to changes on a file, directory, or key-value key for as long as this client is connected.
platforms: [websites, apps, nodejs]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Subscribes to a subject and calls `handler` each time something matching it changes. The subscription belongs to this client's connection: nothing is stored, nothing runs while the page is closed, and it ends when the connection does. Changes from other devices and regions reach it too; one made in another region typically arrives a few hundred milliseconds later than a local one. See [Events](/Events/) for the subject grammar and the event shape.

Not for Puter workers: a subscription there only lasts for one invocation. To react to changes from a worker, use [`onPersistent()`](/Events/onPersistent/) with a published handler.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.onLocal(subject, handler)
puter.events.onLocal(subject, handler, options)
```

## Parameters

#### `subject` (String) (required)
What to watch: `fs:<path or uid>[:<op>]`, `kv:<key>`, or `notif:<audience>`. See [Subjects](#subjects).

#### `handler` (Function) (required)
Called with `{ event }` for each delivery; see [The event](#the-event). `event.op === 'gap'` means events were dropped by a limit or missed while the connection was down: re-read what you're watching (see [Gaps](#gaps)). A handler that throws is logged to the console; the subscription continues.

#### `options` (Object) (optional)

- `onError` (Function): Called with `{ message, code }` if the subscription can't be restored after a disconnect: re-subscribing failed, the reconnect was refused, or the server kept closing the connection. A single disconnect is reconnected without calling it; the handler gets a `reconnect` gap instead. After `onError`, the subscription is over; call `onLocal()` again to resume. It's also called with `code: 'subscription_ended'` and a `reason` when the server ends the subscription (see [Subscriptions the server ends](#subscriptions-the-server-ends)). Without it, the error is logged to the console.
- `timeout` (Number): How long to wait for the server to confirm the subscription, in milliseconds. Defaults to `30000`.
- `includeValue` (Boolean): For a `kv:` subject, include the key's new value as `event.value` (`null` on a `del`, absent on an `expire`). See [Getting the new value](#getting-the-new-value) for when it's left out. Refused on other subjects.

## Return value

A `Promise` that resolves, once the server confirms the subscription, to:

- `subId` (String | null): The server's id for the subscription. It changes on every reconnect, so don't store anything against it.
- `subject` (String): The subject as you passed it. For `kv:`, `anchor.uid` is the app it resolved to; for `notif:`, the app, or your user id when acting as the account.
- `anchor` (Object): The node the subscription is attached to, as `{ uid, path }`: the subject itself, or its nearest existing parent if the subject doesn't exist yet. For `kv:`, `uid` is the app whose store is watched and `path` is the key prefix. Through a share handle, `uid` is the handle and `path` is empty. `path` is the one from when you subscribed; a later rename doesn't update it.
- `match` (String | null): The pattern matched under the anchor, if the subject had one. For a path that didn't exist yet, it's the rest of that path, and it covers that path and everything under it.
- `op` (String | null): The one operation this subscription is limited to, or `null` for all.
- `includeValue` (Boolean): Whether `kv:` deliveries carry the new value.
- `off` (Function): Ends the subscription; see [`subscription.off()`](/Events/off/).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | The subject is empty, not a string, or can't be parsed, or it's a `notif:` subject and this server has notification events turned off. |
| `invalid_handler` | `handler` isn't a function. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `invalid_subject_op` | The `:op` suffix isn't one of the five operations. |
| `invalid_subject_pattern` | The pattern is over its limits: 256 characters, 16 segments, one `*` per segment, one `**` in total. |
| `invalid_kv_pattern` | A `kv:` subject has a `*` before the end, or a `?`. |
| `invalid_kv_handle_key` | A `kv:<handle>:…` subject names no key, or a key that tries to leave the shared region. |
| `invalid_include_value` | `includeValue` isn't a boolean, or the subject isn't `kv:`. |
| `events_cross_app_disabled` | The subject names another app's key-value data, and that's turned off on this server. |
| `forbidden` | The other app doesn't share its data, or your app hasn't been granted `app-data:<appId>:kv:read`. |
| `subject_does_not_exist` | The subject doesn't exist, or this account can't read it. |
| `events_subscription_limit` | This connection already has 50 subscriptions. |
| `too_many_requests` | Over the subscribe rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `reauth_required` | The session behind this connection is no longer valid. |
| `events_connection_failed` | The connection couldn't be opened, the server didn't answer in time, or it kept closing the connection. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Subjects

```
fs:<path or uid>[:<op>]
kv:<key>
kv:<appId>:<key>
notif:<audience>
notif:<appId>:<audience>
```

The same subjects work with [`onPersistent()`](/Events/onPersistent/).

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

#### Watching a path before it exists

A subject can name a path that isn't there. The subscription anchors on the nearest existing directory and matches the rest of the path, so it behaves as if the path already existed: you get the event when it appears and, for a folder, every change inside it afterwards. A pattern still matches only the paths it names.

```js
// Nothing at this path yet. The handler runs when it's created.
await puter.events.onLocal('fs:~/Documents/inbox/trigger.json:add', ({ event }) => {
    process(event.path);
});
```

If the node a subscription is attached to is deleted, a subscription made with a uid, or with a path that existed when you subscribed, ends: `onError` is called with `subscription_ended` and `reason: 'anchor_deleted'`. Call `onLocal()` again to watch the path once it's back. One made with a pattern, or with a path that didn't exist yet, moves up to the nearest folder that still exists and that you can read, and keeps watching, so recreating the path resumes delivery. If there's no such folder (for example, the owner of a folder shared with you deleted it), or the pattern would grow past its limits, it ends the same way.

### Notifications

`notif:` watches part of the account's notification mailbox:

- `notif:account`: notifications about the account itself, such as files shared with it. Only a client acting as the account, not as an app, sees them. Apps and websites never do: subscribing from one is refused with `subject_does_not_exist`.
- `notif:app-user`: notifications belonging to the app you're running as.
- `notif:developer`: notifications about an app you own.

The two-segment form is expanded to your app's id for you. Notifications are stored, so you can also read missed ones with [`fetch()`](/Events/fetch/).

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

The returned `anchor` names the app whose store is watched; `subject` stays as you passed it.

#### Getting the new value

A delivery names the key, not its value. Pass `includeValue: true` to receive the new value as `event.value` (`null` on a `del`, absent on an `expire`):

```js
await puter.events.onLocal('kv:cart', ({ event }) => render(event.value), { includeValue: true });
```

The value is left out, and you read the key yourself, when:

- it's over **16 KB** serialized, or
- more than **128** subscriptions match the change in that region (including ones that didn't ask for values), or the filter-check limit stops the count early.

#### Data from other apps

Watching another app's key-value data takes the same consent as reading it: the app must allow data sharing, and the user must grant your app `app-data:<appId>:kv:read`. Both are checked when you subscribe and on every delivery. Where cross-app watching is off, the subject is refused with `events_cross_app_disabled`.

Entries the other app wrote with `disableSharing` are never delivered. Marking a key private produces no event, so a value you already have for it may be stale.

## Sharing key-value events with another user

`kv:` always means your own data. To let another account watch part of yours, mint a **share handle** over a key prefix and give it to them. They subscribe with the handle where an app id would go:

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
- **Private entries stay private.** An entry written with `disableSharing` is never delivered through a handle: no event, key, or value.
- **Use a stable prefix.** A handle stays on the prefix it was minted on. Rename `workspace:<uuid>:` to `project:<uuid>:` and existing handles point at keys nothing writes. Prefer synthetic ids (`workspace:<uuid>:`, `thread:<uuid>:`) over names that might change (`acme-corp:`).
- **Prefixes are literal.** `*`, `?` and empty segments (`workspace::abc:`) are refused with `invalid_kv_share_prefix`. The trailing `:` is optional.
- **Keys can't leave the handle.** A handle with no key after it, or a key using `..`, is refused with `invalid_kv_handle_key`.

**Managing handles.** `GET /events/kv-handles` lists the handles the account has minted, revoked ones included. `DELETE /events/kv-handles/<handle>` revokes one, and every persistent subscription on it is suspended with `permission_revoked` and its backlog dropped. Revoking an already-revoked handle isn't an error. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for how many handles an account can hold. Temporary accounts can't mint handles (`events_kv_handle_requires_account`). Where the feature is off, minting and handle subjects fail with `events_kv_handles_disabled`.

**Apps.** An app can mint, list and revoke handles for its user, but only inside its own namespace and with the user's consent: `manage:kv-share:<userUuid>:<appId>:<prefix>`, requested with [`puter.perms.request()`](/Perms/request/). The prefix supplies its segments, so `workspace:abc:` ends the permission as `…:workspace:abc`. The consent must name a prefix; asking for the whole namespace is refused with `invalid_kv_share_prefix`. An app that lists handles sees only its own namespace.

| Refused with | When |
| --- | --- |
| `events_kv_handle_not_delegated` | Minting or revoking outside the consented prefix, or after the consent was withdrawn (the handle stays in place). |
| `events_kv_handle_outside_namespace` | Minting outside the app's own namespace. |
| `events_kv_handle_owner_only` | The caller is an access token the app issued, a different app of the same user, or the handle is outside the app's namespace. |

An app can also subscribe through a handle, but only when the shared region belongs to that same app. A different app, even for the same user, is refused as if the handle didn't exist.

## Access

Subscribing takes the same access as reading. A subject you can't read and a subject that doesn't exist both fail with `subject_does_not_exist`, so the error doesn't reveal which. Access is checked again on every delivery: when a share is revoked, deliveries stop immediately. The subscription itself stays open, so `onError` isn't called — not even if the node is later deleted.

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

A notification carries the fields listed on [`fetch()`](/Events/fetch/#return-value).

Events never say *who* made a change: on a shared folder, that would tell every subscriber who else has access.

[`puter.kv.flush()`](/KV/flush/) delivers nothing, since the keys a flush can list aren't reliably the keys it removed.

Writes to the same subject within 250 ms arrive as one event carrying the latest state, so a multipart upload or a save loop is one delivery rather than one per write.

### Gaps

Limits never make a subscription fail. Instead they send a **gap marker** in place of what was dropped: an event with `op: 'gap'`, a `reason`, and no `uid` or `path`. Treat it as "re-read what I'm watching", never as "nothing changed". A reconnect sends one too.

| `reason` | Cause |
| --- | --- |
| `matched_subscription_limit` | The event matched more subscriptions than one event may reach. |
| `filter_evaluation_limit` | The event had more subscription filters to check than one event may check. |
| `delivery_rate_limit` | This subscription went over its per-minute delivery rate. |
| `backlog_overflow` | A persistent subscription's undelivered backlog was full, so the oldest deliveries were dropped. |
| `handler_rejected` | A persistent subscription's handler refused the delivery (a `4xx`, or a thrown terminal error). |
| `suspended_backlog_expired` | A persistent subscription stayed [suspended](/Events/onPersistent/#suspended-subscriptions) past the time its backlog is kept. |
| `reconnect` | The connection dropped and came back. Changes made while it was down weren't delivered. Sent once, after the subscription is restored. |

```js
await puter.events.onLocal('fs:~/Documents', async ({ event }) => {
    if (event.op === 'gap') return refreshEverything();
    apply(event);
});
```

See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for the numbers behind each limit.

## Reconnects

All of a client's session subscriptions share one connection, opened by the first `onLocal()` and closed when the last one ends.

If the connection drops (a network blip, a sign-in, an API origin change, or the server closing it), the SDK reconnects and subscribes again. The handler and subscription object stay the same; only `subId` changes, so don't store anything against it. `onError` is called only if the subscription can't be restored: re-subscribing fails, the reconnect is refused (`reauth_required` after a sign-out), or the server keeps closing the connection (`events_connection_failed`).

Changes made while it was down aren't sent afterwards. Once the subscription is back, the handler gets one [gap marker](#gaps) with `reason: 'reconnect'`, so a handler that re-reads on gaps catches up by itself. For `notif:` subjects, [`fetch()`](/Events/fetch/) reads exactly what was missed.

```js
const sub = await puter.events.onLocal('fs:~/Documents', handler, {
    onError: (error) => console.warn('subscription ended:', error.code),
});
```

## Subscriptions the server ends

The server can end a session subscription on its own, without a disconnect. `onError` is called once, and the handler isn't called after that. What was already on its way to the handler is usually delivered first, but not always: a delivery held back by a limit or an empty balance, or one for a change made at about the same moment, may never arrive.

| `code` | `reason` | When |
| --- | --- | --- |
| `subscription_ended` | `anchor_deleted` | The node it was attached to was deleted, and it couldn't move up to a parent folder (see [Watching a path before it exists](#watching-a-path-before-it-exists)). |

If the connection is down when this happens, or drops before `onError` is called, the SDK isn't told. It subscribes again with the original subject when it reconnects: a path then anchors on its nearest existing folder and keeps watching, like a path that doesn't exist yet, while a uid fails and `onError` is called with `subject_does_not_exist` instead.

## Examples

<strong class="example-title">Watch a directory and print what changes</strong>

```html;events-watch-folder
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a directory to watch
            const dir = `~/${puter.randName()}`;
            await puter.fs.mkdir(dir);

            // (2) Subscribe to everything under it
            const sub = await puter.events.onLocal(`fs:${dir}`, ({ event }) => {
                if (event.op === 'gap') {
                    puter.print(`missed some changes (${event.reason})<br>`);
                    return;
                }
                puter.print(`${event.op}: ${event.path}<br>`);
            });

            // (3) Change something — the handler runs
            await puter.fs.write(`${dir}/hello.txt`, 'Hello!');

            // (4) Stop listening (cleanup)
            setTimeout(() => sub.off(), 2000);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">React to a file that does not exist yet</strong>

```html;events-watch-missing
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) A directory to work in. `inbox/` below it does not exist yet.
            const dir = `~/${puter.randName()}`;
            await puter.fs.mkdir(dir);

            // (2) Subscribe anyway — the subscription anchors on `dir` and
            //     matches the rest of the path as it appears.
            const sub = await puter.events.onLocal(
                `fs:${dir}/inbox/trigger.json:add`,
                ({ event }) => puter.print(`appeared: ${event.path}<br>`),
                { onError: (error) => puter.print(`subscription ended: ${error.code}<br>`) },
            );
            puter.print(`anchored on ${sub.anchor.path}, matching ${sub.match}<br>`);

            // (3) Create it, several directories deep
            await puter.fs.write(`${dir}/inbox/trigger.json`, '{}', {
                createMissingParents: true,
            });

            setTimeout(() => sub.off(), 2000);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Watch this app's key-value store</strong>

```html;events-watch-kv
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Exactly one key, and separately every key under a prefix.
            const one = await puter.events.onLocal('kv:cart', ({ event }) =>
                puter.print(`${event.op}: ${event.key}<br>`));
            const many = await puter.events.onLocal(
                `kv:${puter.appID}:cart:*`,
                ({ event }) => puter.print(`under cart: ${event.key}<br>`));

            // (2) `cart` reaches the first, `cart:items` only the second.
            await puter.kv.set('cart', { total: 0 });
            await puter.kv.set('cart:items', ['apple']);

            // (3) Cleanup
            setTimeout(async () => {
                await one.off();
                await many.off();
                await puter.kv.del('cart');
                await puter.kv.del('cart:items');
            }, 2000);
        })();
    </script>
</body>
</html>
```
