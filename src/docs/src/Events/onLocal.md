---
title: puter.events.onLocal()
description: Subscribe to changes on a file, directory, key-value key, or notifications for as long as this client is connected.
platforms: [websites, apps, nodejs]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Subscribes to a subject and calls `handler` each time something matching it changes. The subscription belongs to this client's connection. Nothing is stored, nothing runs while the page is closed, and the subscription ends when the connection does. Changes from other devices and regions reach it too. A change made in another region usually arrives a few hundred milliseconds later than a local one. See [Subjects and events](/Events/subjects/) for the subject syntax and the event shape.

In a Puter worker, a subscription only lasts for one invocation. To react to changes from a worker, use [`onPersistent()`](/Events/onPersistent/) with a published handler.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.onLocal(subject, handler)
puter.events.onLocal(subject, handler, options)
```

## Parameters

#### `subject` (String) (required)
What to watch, such as `fs:~/Documents`, `kv:cart`, `kv:<handle>:*`, or `notif:app-user`. See [Subjects and events](/Events/subjects/).

#### `handler` (Function) (required)
Called with `{ event }` for each delivery. See [The event](/Events/subjects/#the-event). When `event.op` is `'gap'`, events were dropped by a limit or missed while the connection was down, so re-read what you're watching (see [Gaps](/Events/subjects/#gaps)). A handler that throws is logged to the console, and the subscription continues.

#### `options` (Object) (optional)

- `onError` (Function): Called with `{ message, code }` once the subscription is over. That happens when it can't be restored after a disconnect (see [Reconnects](#reconnects)), or when the server ends it, with `code: 'subscription_ended'` and a `reason` (see [Subscriptions the server ends](#subscriptions-the-server-ends)). The handler isn't called after that. Call `onLocal()` again to resume. Without `onError`, the error is logged to the console.
- `timeout` (Number): How long to wait for the server to confirm the subscription, in milliseconds. Defaults to `30000`.
- `includeValue` (Boolean): For a `kv:` subject, include the key's new value as `event.value`. See [Getting the new value](/Events/subjects/#getting-the-new-value) for when it's left out. Other subjects are refused with `invalid_include_value`.

## Return value

A `Promise` that resolves, once the server confirms the subscription, to a subscription object:

- `subId` (String | null): The server's id for the subscription. It changes on every reconnect, so don't store anything against it.
- `subject` (String): The subject as you passed it. A relative `fs:` path comes back resolved. In an app, `fs:inbox` comes back as `fs:~/AppData/<appId>/inbox`, and outside an app as `fs:~/inbox`.
- `anchor` (Object): What the subscription is attached to, as `{ uid, path }`.
    - For `fs:`, the node the subject names, or its nearest existing parent folder if the subject doesn't exist yet. Its `path` is the one from when you subscribed, so a later rename doesn't update it. On another user's file or folder, `path` is empty.
    - For `kv:`, `uid` is the app whose store is watched and `path` is the key prefix. Through a share handle, `uid` is the handle and `path` is empty.
    - For `notif:`, `uid` is the app the subject is about, which is your app for the two-segment form, or your user id when it names no app. Its `path` is empty.
- `match` (String | null): The pattern matched under the anchor, or `null` when there is none. For a path that didn't exist yet, it's the rest of that path, and it covers that path and everything under it.
- `op` (String | null): The one operation this subscription is limited to, or `null` for all.
- `includeValue` (Boolean): Whether `kv:` deliveries carry the new value.
- `off` (Function): Ends the subscription. See [`subscription.off()`](/Events/off/).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | The subject is empty, not a string, or can't be parsed, or it's a `notif:` subject and this server has notification events turned off. |
| `invalid_handler` | `handler` isn't a function. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `invalid_subject_op` | The `:op` suffix isn't one of the five operations. |
| `invalid_subject_audience` | A `notif:` subject names an audience other than `account`, `developer`, or `app-user`. |
| `invalid_subject_pattern` | The pattern is over 256 characters or 16 segments, or uses more than one `*` in a segment or more than one `**` in total. Through a share handle, the 256 characters are counted after the handle. |
| `invalid_kv_pattern` | A `kv:` subject has a `*` before the end, or a `?`. |
| `invalid_kv_handle_key` | A `kv:<handle>` subject names no key, a key starting with `:`, or a key with a `..` segment. |
| `invalid_include_value` | `includeValue` isn't a boolean, or the subject isn't `kv:`. |
| `events_cross_app_disabled` | The subject names another app's key-value data, and that's turned off on this server. |
| `events_kv_handles_disabled` | The subject names a share handle, and watching through share handles is turned off on this server. |
| `forbidden` | The other app doesn't share its data, or your app hasn't been granted read access to its key-value data (see [`puter.perms.request('appData')`](/Perms/appData/)). |
| `subject_does_not_exist` | The subject doesn't exist, or this account can't read it. |
| `events_subscription_limit` | This connection already has 50 subscriptions, or you already have 1,000 through this share handle across all your connections. |
| `too_many_requests` | Over the subscribe rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `reauth_required` | The session behind this connection is no longer valid. |
| `events_connection_failed` | The connection couldn't be opened, the server didn't answer in time, or it kept closing the connection. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Reconnects

All of a client's session subscriptions share one connection. The first `onLocal()` opens it, and it closes when the last subscription ends.

If the connection drops (a network blip, a sign-in, an API origin change, or the server closing it), the SDK reconnects and subscribes again. The handler and the subscription object stay the same, and only `subId` changes. Changes made while the connection was down aren't sent afterwards. Once the subscription is back, the handler gets one [gap marker](/Events/subjects/#gaps) with `reason: 'reconnect'`, so a handler that re-reads on gaps catches up by itself. For `notif:` subjects, [`fetch()`](/Events/fetch/) reads exactly what was missed.

The SDK calls `onError` only if the subscription can't be restored. That's when subscribing again fails, when the reconnect is refused (`reauth_required` after a sign-out), or when the server keeps closing the connection (`events_connection_failed`).

```js
const sub = await puter.events.onLocal('fs:~/Documents', handler, {
    onError: (error) => console.warn('subscription ended:', error.code),
});
```

## Subscriptions the server ends

The server can end a session subscription on its own, without a disconnect. The SDK calls `onError` once, and the handler isn't called after that. What was already on its way to the handler usually arrives first, but not always. A delivery held back by a limit or an empty balance, or one for a change made at about the same moment, may never arrive.

| `code` | `reason` | When |
| --- | --- | --- |
| `subscription_ended` | `anchor_deleted` | The node it was attached to was deleted, and it couldn't move up to a parent folder (see [Watching a path before it exists](/Events/subjects/#watching-a-path-before-it-exists)). |
| `subscription_ended` | `permission_revoked` | It was made through a share handle, and the share stopped (see [Sharing key-value data with another user](/Events/subjects/#sharing-key-value-data-with-another-user)). |

If the connection is down when this happens, or drops before `onError` is called, the SDK isn't told. It subscribes again with the original subject when it reconnects. A path then anchors on its nearest existing folder and keeps watching, like a path that doesn't exist yet. A uid, or a share handle that stopped, fails, and `onError` is called with `subject_does_not_exist`.

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

            // (3) Change something, and the handler runs
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

            // (2) Subscribe anyway. The subscription anchors on `dir` and
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
