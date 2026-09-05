---
title: puter.events.onLocal()
description: Subscribe to changes on a file, directory, or key-value key for as long as this client is connected.
platforms: [websites, apps, nodejs]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Subscribes to a subject and calls `handler` every time something matching it changes. The subscription belongs to this client's connection: nothing is stored, nothing runs while the page is closed, and it ends when the connection does. See [Events](/Events/) for the subject grammar and the event shape.

Not for a Puter worker: a worker invocation is short-lived, so a subscription here only lasts as long as that one invocation. To react to changes from a worker, use [`onPersistent()`](/Events/onPersistent/) with a `worker` target and a published handler.

## Syntax
```js
puter.events.onLocal(subject, handler)
puter.events.onLocal(subject, handler, options)
```

## Parameters

#### `subject` (String) (required)
What to watch: `fs:<path or uid>[:<op>]` or `kv:<key>`.

For `fs:`, the path may be absolute (`/alice/Documents`) or home-relative (`~/Documents`), may name something that does not exist yet, and may contain `*` (within a path segment) or `**` (across directories). The optional `op` is one of `add`, `write`, `move`, `remove`, `meta` — nothing emits `meta` yet.

For `kv:`, the key is matched **exactly** unless you end it with `*`, which widens it to a prefix — the opposite of [`puter.kv.list()`](/KV/list/), whose pattern is always a prefix. Two segments (`kv:cart`) means the app you are running as; three or more (`kv:<appId>:<key>`) names the app explicitly and is what a key containing `:` needs.

#### `handler` (Function) (required)
Called with a single `{ event }` object per delivery. `event.op === 'gap'` means events were dropped against a limit and the details are not available — re-read what you are watching. A handler that throws is reported on the console and does not end the subscription.

#### `options` (Object) (optional)

- `onError` (Function): Called with `{ message, code }` if the subscription lapses — the connection was lost and re-subscribing failed. The subscription is over at that point; call `onLocal()` again to resume. Without it, a lapse is reported on the console.
- `timeout` (Number): How long to wait for the server to confirm the subscription, in milliseconds. Defaults to `30000`.

## Return value

A `Promise` that resolves, once the server has confirmed the subscription, to a subscription object:

- `subId` (String | null): The server's id for the subscription. It changes whenever the connection is rebuilt, so don't store anything against it.
- `subject` (String): The subject you subscribed with, returned fully qualified — a `kv:` subject you wrote in the two-segment form comes back as `kv:<appId>:<key>`.
- `anchor` (Object): The subscription's [anchor](/Events/#anchor), as `{ uid, path }`. For a `kv:` subject, `uid` is the app whose store is being watched and `path` is the key prefix it is anchored at; for one made through a share handle, `uid` is the handle and `path` is empty. The path is the one the anchor had when you subscribed — a later rename or move does not update it.
- `match` (String | null): The pattern events under the anchor are matched against, if the subject had one.
- `op` (String | null): The single operation this subscription is limited to, or `null` for all of them.
- `off` (Function): Ends the subscription — see [`subscription.off()`](/Events/off/).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | The subject is not a non-empty string, or the server could not parse it. |
| `invalid_handler` | `handler` is not a function. |
| `invalid_subject_op` | The `:op` suffix is not one of the five operations. |
| `invalid_subject_pattern` | The match pattern is past its bounds: 256 characters, 16 segments, one `*` per segment, one `**` in total. |
| `invalid_kv_pattern` | A `kv:` subject has a `*` somewhere other than the end, or a `?`. |
| `invalid_kv_handle_key` | A `kv:<handle>:…` subject names no key, or one that tries to leave the handle's granted region. |
| `events_cross_app_disabled` | The subject names another app's key-value data and that is not enabled here. |
| `forbidden` | The target app does not share its data, or this app has not been granted `app-data:<appId>:kv:read` on it. |
| `subject_does_not_exist` | The subject is not there, or this account cannot read it. |
| `events_subscription_limit` | This connection already holds the maximum number of subscriptions. |
| `too_many_requests` | Over the subscribe/unsubscribe call budget. |
| `events_disabled` | Events are not enabled on this server. |
| `reauth_required` | The session backing this connection is no longer valid. |
| `events_connection_failed` | The events connection could not be established, the server did not answer in time, or the server closed the connection. |
| `events_failed` | The server answered with something the SDK could not make sense of. |

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
            const many = await puter.events.onLocal('kv:cart:*', ({ event }) =>
                puter.print(`under cart: ${event.key}<br>`));

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
