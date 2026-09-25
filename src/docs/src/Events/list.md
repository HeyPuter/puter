---
title: puter.events.list()
description: List the persistent subscriptions this caller holds.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Lists the persistent subscriptions created with [`puter.events.onPersistent()`](/Events/onPersistent/). Session subscriptions made with `onLocal()` are not listed — they live with the connection and are not stored anywhere.

An app sees only the subscriptions it created. A session acting for the account sees them all, **including ones left behind by an app that is gone** — so the account is where a stray subscription gets revoked from.

## Syntax
```js
puter.events.list()
puter.events.list(options)
```

## Parameters

#### `options` (Object) (optional)

- `limit` (Number): Maximum subscriptions per request. Capped at 200; defaults to 50.
- `cursor` (String | null): Continuation token from a previous page. Passing it — `null` included — switches the return value to a single page envelope.
- `includeTotal` (Boolean): Adds `total` to the envelope. Request it on the first page only; it costs more the more subscriptions exist.
- `stream` (Boolean): Returns an async iterator of page envelopes instead of a promise.

## Return value

With no pagination params, a `Promise` for an array of every subscription, fetched page by page under the hood. With `cursor` or `includeTotal`, a `Promise` for one page: `{ items, cursor?, total? }` — `cursor` is present only while more pages exist. With `stream: true`, an async iterator of those envelopes.

**Pages may be short.** Never read `items.length < limit` as the end of the list; iterate until `cursor` is absent.

Each subscription is the object [`onPersistent()`](/Events/onPersistent/) returns. In particular:

- `contextKeys` (Array | null) and `contextHash` (String | null) describe the stored `context`. **The values are never returned** — the context is where an API key lives, and a listing is the one surface an app can call repeatedly. The hash changes whenever any value does, which is enough to tell two subscriptions apart or to notice one was re-created.
- `suspendedAt` (Number | null) and `suspendedReason` (String | null) say whether a subscription stopped delivering without being removed, and why: `handler_not_found`, `failures`, `no_credit`, or `permission_revoked`.
- `targets` (Array) may list `'push'` — it is accepted when subscribing, but nothing delivers through it yet.

The promise rejects with `{ message, code }` — `too_many_requests` over the listing budget, `events_disabled` where events are off, `events_failed` for anything the server answered that the SDK could not make sense of.

## Examples

<strong class="example-title">List everything this account is watching</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = `~/${puter.randName()}`;
            await puter.fs.mkdir(dir);
            const sub = await puter.events.onPersistent({
                subject: `fs:${dir}`,
                context: { label: 'inbox' },
            });

            for (const row of await puter.events.list()) {
                puter.print(`${row.subject} — ${row.delivery}`);
                puter.print(` (context: ${row.contextKeys?.join(', ') ?? 'none'})<br>`);
            }

            await puter.events.unsubscribe(sub.subId);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Find the ones that stopped, and why</strong>

```html
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
