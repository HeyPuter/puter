---
title: puter.events.onLocal()
description: Subscribe to changes on a file, directory, or key-value key for as long as this client is connected.
platforms: [websites, apps, nodejs]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Subscribes to a subject and calls `handler` each time something matching it changes. The subscription belongs to this client's connection: nothing is stored, nothing runs while the page is closed, and it ends when the connection does. Changes from other devices and regions reach it too; one made in another region typically arrives a few hundred milliseconds later than a local one. See [Subjects and events](/Events/subjects/) for the subject syntax and the event shape.

Not for Puter workers: a subscription there only lasts for one invocation. To react to changes from a worker, use [`onPersistent()`](/Events/onPersistent/) with a published handler.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.onLocal(subject, handler)
puter.events.onLocal(subject, handler, options)
```

## Parameters

#### `subject` (String) (required)
What to watch: `fs:<path or uid>[:<op>]`, `kv:<key>`, or `notif:<audience>`. See [Subjects](/Events/subjects/).

#### `handler` (Function) (required)
Called with `{ event }` for each delivery; see [The event](/Events/subjects/#the-event). `event.op === 'gap'` means events were dropped by a limit or missed while the connection was down: re-read what you're watching (see [Gaps](/Events/subjects/#gaps)). A handler that throws is logged to the console; the subscription continues.

#### `options` (Object) (optional)

- `onError` (Function): Called with `{ message, code }` if the subscription can't be restored after a disconnect: re-subscribing failed, the reconnect was refused, or the server kept closing the connection. A single disconnect is reconnected without calling it; the handler gets a `reconnect` gap instead. After `onError`, the subscription is over; call `onLocal()` again to resume. It's also called with `code: 'subscription_ended'` and a `reason` when the server ends the subscription (see [Subscriptions the server ends](#subscriptions-the-server-ends)). Without it, the error is logged to the console.
- `timeout` (Number): How long to wait for the server to confirm the subscription, in milliseconds. Defaults to `30000`.
- `includeValue` (Boolean): For a `kv:` subject, include the key's new value as `event.value` (`null` on a `del`, absent on an `expire`). See [Getting the new value](/Events/subjects/#getting-the-new-value) for when it's left out. Refused on other subjects.

## Return value

A `Promise` that resolves, once the server confirms the subscription, to:

- `subId` (String | null): The server's id for the subscription. It changes on every reconnect, so don't store anything against it.
- `subject` (String): The subject as you passed it. A relative `fs:` path comes back resolved: `fs:inbox` returns as `fs:~/AppData/<appId>/inbox` in an app, `fs:~/inbox` otherwise. For `kv:`, `anchor.uid` is the app it resolved to; for `notif:`, the app, or your user id when acting as the account.
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

## Reconnects

All of a client's session subscriptions share one connection, opened by the first `onLocal()` and closed when the last one ends.

If the connection drops (a network blip, a sign-in, an API origin change, or the server closing it), the SDK reconnects and subscribes again. The handler and subscription object stay the same; only `subId` changes, so don't store anything against it. `onError` is called only if the subscription can't be restored: re-subscribing fails, the reconnect is refused (`reauth_required` after a sign-out), or the server keeps closing the connection (`events_connection_failed`).

Changes made while it was down aren't sent afterwards. Once the subscription is back, the handler gets one [gap marker](/Events/subjects/#gaps) with `reason: 'reconnect'`, so a handler that re-reads on gaps catches up by itself. For `notif:` subjects, [`fetch()`](/Events/fetch/) reads exactly what was missed.

```js
const sub = await puter.events.onLocal('fs:~/Documents', handler, {
    onError: (error) => console.warn('subscription ended:', error.code),
});
```

## Subscriptions the server ends

The server can end a session subscription on its own, without a disconnect. `onError` is called once, and the handler isn't called after that. What was already on its way to the handler is usually delivered first, but not always: a delivery held back by a limit or an empty balance, or one for a change made at about the same moment, may never arrive.

| `code` | `reason` | When |
| --- | --- | --- |
| `subscription_ended` | `anchor_deleted` | The node it was attached to was deleted, and it couldn't move up to a parent folder (see [Watching a path before it exists](/Events/subjects/#watching-a-path-before-it-exists)). |

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
            const dir = puter.randName();
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
            const dir = puter.randName();
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
