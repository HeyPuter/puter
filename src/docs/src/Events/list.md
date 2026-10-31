---
title: puter.events.list()
description: List the persistent subscriptions this caller holds.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Lists the persistent subscriptions created with [`puter.events.onPersistent()`](/Events/onPersistent/). Session subscriptions from [`onLocal()`](/Events/onLocal/) aren't stored, so they aren't listed.

An app sees only the subscriptions it created. Outside an app, such as in Node.js with an account token, you see all of them. Deleting an app deletes its subscriptions. A scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, sees none, whether the account or an app created it.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.list()
puter.events.list(options)
```

## Parameters

#### `options` (Object) (optional)

- `limit` (Number): Maximum subscriptions per request. Defaults to 50, max 200.
- `cursor` (String | null): The cursor from a previous page. Passing it, even as `null`, returns a single page instead of the full list.
- `includeTotal` (Boolean): Adds `total` to the page. Ask for it on the first page only, since it gets slower as the count grows.
- `stream` (Boolean): Returns an async iterator of pages instead of a promise.

## Return value

- Without `cursor`, `includeTotal`, or `stream`, a `Promise` for an array of every subscription, fetched page by page for you.
- With `cursor` or `includeTotal`, a `Promise` for one page, `{ items, cursor?, total? }`. It includes a `cursor` if there are more pages to load.
- With `stream: true`, an async iterator of pages.

Pages can be shorter than `limit` before the last one, so keep going until `cursor` is absent.

Each subscription is the object [`onPersistent()`](/Events/onPersistent/#return-value) returns, without `off()`. In particular:

- `contextKeys` (Array | null) and `contextHash` (String | null) describe the stored `context`. The values are never returned, since context often holds secrets. The hash changes whenever a value does.
- `suspendedAt` (Number | null) and `suspendedReason` (String | null) are set when a subscription is [suspended](/Events/onPersistent/#suspended-subscriptions), with `handler_not_found`, `failures`, `no_credit`, or `permission_revoked`.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the listing rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">List everything this account is watching</strong>

```html;events-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = puter.randName();
            await puter.fs.mkdir(dir);
            const sub = await puter.events.onPersistent({
                subject: `fs:${dir}`,
                context: { label: 'inbox' },
            });

            for (const row of await puter.events.list()) {
                puter.print(`${row.subject}: ${row.queue ? 'queue' : 'every listener'}`);
                puter.print(` (context: ${row.contextKeys?.join(', ') ?? 'none'})<br>`);
            }

            await puter.events.unsubscribe(sub.subId);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Find the ones that stopped, and why</strong>

```html;events-list-suspended
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            for await (const page of puter.events.list({ stream: true })) {
                for (const row of page.items) {
                    if (!row.suspendedAt) continue;
                    puter.print(`${row.subject} stopped: ${row.suspendedReason}<br>`);
                }
            }
            puter.print('done<br>');
        })();
    </script>
</body>
</html>
```
