---
title: puter.events.fetch()
description: Read what a subject recorded while nothing was listening.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Reads events a subject has stored, a page at a time. A subscription only delivers while something is listening; `fetch()` catches up on what happened while the client was closed or offline.

It's a plain query: nothing is registered, no position is saved, and calling it twice returns the same result. You keep the `cursor` and pass it back as `cursor`.

A scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, reads an empty page whatever the subject, whether the account or an app created it.

Only **`notif:`** (the notification mailbox) stores events. `fs:` and `kv:` are refused with `fetch_unsupported_subject` rather than answered with an empty page.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.fetch(options)
```

## Parameters

#### `options` (Object) (required)

- `subject` (String) (required): What to read: `notif:account` (the account's notifications), `notif:app-user` (the ones belonging to the app you're running as), or `notif:<appId>:<audience>`. Audiences are `account`, `developer` (about an app, sent to its owner), and `app-user` (about your data inside an app).
- `cursor` (String): The `cursor` from the previous page. Leave it off to start from the oldest notification still kept.
- `after` (String): The older name for `cursor`, still accepted. If both are given, `cursor` is used.
- `limit` (Number): Events per page. Defaults to 50, max 200.

## Return value

A `Promise` for `{ items, cursor }`:

- `items`: the events, **oldest first**, in the same shape as live deliveries.
- `cursor`: pass it back as `cursor` to read the next page. It's absent on the last page. Treat it as opaque.

Each item is a notification event:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | The notification's uid. Live deliveries carry the same id, so you can drop duplicates. |
| `subject` | String | `notif:<appId or userId>:<audience>`: the part of the mailbox it belongs to. |
| `op` | String | Always `post`. |
| `uid` | String | The notification's uid. |
| `type` | String | The kind of notification, from the published catalog: `share.received`, `app.worker.deployed`, and so on. |
| `audience` | String | `account`, `developer`, or `app-user`. |
| `appUid` | String \| null | The app it's about, or `null` for platform notifications. |
| `notification` | Object | The stored payload. It always has `type`, and everything Puter sends has a `title`; other fields depend on `type` (below). |
| `self` | Boolean | Always `true`: a mailbox is your own. |
| `ts` | Number | When it was created, in milliseconds since the epoch. |
| `seq` | Number | Position within the page. |

Besides `type` and `title`, `notification` carries:

- `share.received`: `fields.username`, `fields.count`, `fields.senders` (`[{ username, count }]`), and `fields.target` (`{ path, name }`) for a single item.
- `share.claimed`: `fields.count`.
- `app.worker.deployed`, `app.worker.deployFailed`: nothing else.
- `app.events.ended`: `reason` (`anchor_deleted`, `permission_revoked`, or `no_credit`); `anchor_deleted` and `permission_revoked` also add `subject`, `subjects` (up to 20) and `count`.
- `app.events.suspended`: `handler` and `subscriptions`.

Other notifications can carry other fields, so read them defensively.

Apps never see `account` notifications (files shared with you, and so on), and see `developer` notifications only for apps the user owns. Asking for a slice you can't see returns an empty page rather than an error, so the call doesn't reveal what exists.

Notifications are kept for the deployment's retention window. A client away for longer starts from what's left.

The promise rejects with `{ message, code }`: `auth_canceled` if nobody was signed in and the user closed the sign-in, `fetch_unsupported_subject` for `fs:` or `kv:`, `invalid_subject` or `invalid_subject_audience` for a subject that doesn't parse, `too_many_requests` over the rate limit, `events_disabled` where events are off, and `events_failed` for a response the SDK couldn't read.

## Examples

<strong class="example-title">Catch up on everything missed</strong>

```html;events-fetch
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            let cursor;
            let seen = 0;
            do {
                const page = await puter.events.fetch({
                    subject: 'notif:account',
                    cursor,
                });
                for (const event of page.items) {
                    puter.print(`${event.type}: ${event.notification.title}<br>`);
                    seen++;
                }
                cursor = page.cursor;
            } while (cursor);

            if (!seen) puter.print('nothing missed<br>');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Read the missed ones, then keep listening</strong>

```html;events-fetch-then-listen
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const seen = new Set();

            const show = (event) => {
                if (seen.has(event.id)) return;
                seen.add(event.id);
                puter.print(`${event.notification.title}<br>`);
            };

            // Live first, so nothing arriving during the catch-up is lost —
            // `id` is what makes the overlap harmless.
            const sub = await puter.events.onLocal('notif:account',
                ({ event }) => show(event));

            const page = await puter.events.fetch({ subject: 'notif:account' });
            page.items.forEach(show);

            await sub.off();
        })();
    </script>
</body>
</html>
```
