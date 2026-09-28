---
title: puter.events.onLocal()
description: Subscribe to changes on a file, directory, or key-value key for as long as this client is connected.
platforms: [websites, apps, nodejs]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Subscribes to a subject and calls `handler` each time something matching it changes. The subscription belongs to this client's connection: nothing is stored, nothing runs while the page is closed, and it ends when the connection does. Changes from other devices and regions reach it too; one made in another region typically arrives a few hundred milliseconds later than a local one. See [Events](/Events/) for the subject grammar and the event shape.

Not for Puter workers: a subscription there only lasts for one invocation. To react to changes from a worker, use [`onPersistent()`](/Events/onPersistent/) with a published handler.

## Syntax
```js
puter.events.onLocal(subject, handler)
puter.events.onLocal(subject, handler, options)
```

## Parameters

#### `subject` (String) (required)
What to watch: `fs:<path or uid>[:<op>]`, `kv:<key>`, or `notif:<audience>`.

For `fs:`, the path can be absolute (`/alice/Documents`) or home-relative (`~/Documents`), can name something that doesn't exist yet, and can use `*` (within a segment) or `**` (across directories). The optional `op` is one of `add`, `write`, `move`, `remove`, `meta`; nothing emits `meta` yet.

For `kv:`, the key matches **exactly** unless it ends in `*`, which makes it a prefix (the opposite of [`puter.kv.list()`](/KV/list/)). `kv:cart` means the app you're running as; `kv:<appId>:<key>` names the app and is required for keys that contain `:`.

#### `handler` (Function) (required)
Called with `{ event }` for each delivery. `event.op === 'gap'` means events were dropped by a limit: re-read what you're watching. A handler that throws is logged to the console; the subscription continues.

#### `options` (Object) (optional)

- `onError` (Function): Called with `{ message, code }` if the subscription can't be restored after a disconnect: re-subscribing failed, the reconnect was refused, or the server kept closing the connection. A single disconnect is reconnected without calling it. After `onError`, the subscription is over; call `onLocal()` again to resume. Without it, the error is logged to the console.
- `timeout` (Number): How long to wait for the server to confirm the subscription, in milliseconds. Defaults to `30000`.
- `includeValue` (Boolean): For a `kv:` subject, include the key's new value as `event.value` (`null` on a `del`, absent on an `expire`). The value is left out when it's over 16 KB, or when more than 128 subscriptions match the change in that region. Refused on other subjects.

## Return value

A `Promise` that resolves, once the server confirms the subscription, to:

- `subId` (String | null): The server's id for the subscription. It changes on every reconnect, so don't store anything against it.
- `subject` (String): The subject, in full form. `kv:cart` comes back as `kv:<appId>:cart`.
- `anchor` (Object): The [anchor](/Events/#anchor), as `{ uid, path }`. For `kv:`, `uid` is the app whose store is watched and `path` is the key prefix. Through a share handle, `uid` is the handle and `path` is empty. `path` is the one from when you subscribed; a later rename doesn't update it.
- `match` (String | null): The pattern matched under the anchor, if the subject had one.
- `op` (String | null): The one operation this subscription is limited to, or `null` for all.
- `includeValue` (Boolean): Whether `kv:` deliveries carry the new value.
- `off` (Function): Ends the subscription; see [`subscription.off()`](/Events/off/).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | The subject is empty, not a string, or can't be parsed. |
| `invalid_handler` | `handler` isn't a function. |
| `invalid_subject_op` | The `:op` suffix isn't one of the five operations. |
| `invalid_subject_pattern` | The pattern is over its limits: 256 characters, 16 segments, one `*` per segment, one `**` in total. |
| `invalid_kv_pattern` | A `kv:` subject has a `*` before the end, or a `?`. |
| `invalid_kv_handle_key` | A `kv:<handle>:…` subject names no key, or a key that tries to leave the shared region. |
| `invalid_include_value` | `includeValue` isn't a boolean, or the subject isn't `kv:`. |
| `events_cross_app_disabled` | The subject names another app's key-value data, and that's turned off on this server. |
| `forbidden` | The other app doesn't share its data, or your app hasn't been granted `app-data:<appId>:kv:read`. |
| `subject_does_not_exist` | The subject doesn't exist, or this account can't read it. |
| `events_subscription_limit` | This connection already has 50 subscriptions. |
| `too_many_requests` | Over the subscribe/unsubscribe rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `reauth_required` | The session behind this connection is no longer valid. |
| `events_connection_failed` | The connection couldn't be opened, the server didn't answer in time, or it kept closing the connection. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Watch a directory and print what changes</strong>

```html
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

```html
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

```html
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
