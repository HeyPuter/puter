---
title: puter.events.fetch()
description: Read what a subject recorded while nothing was listening.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Reads the events a subject has stored, a page at a time. A subscription only delivers while something is listening, and `fetch()` catches up on what happened while the client was closed or offline. Only `notif:` subjects (the notification mailbox) store events. Subjects for `fs:` and `kv:` are refused with `fetch_unsupported_subject`.

It's a plain query. Nothing is registered and no position is saved, so calling it twice returns the same result. You keep the `cursor` and pass it back.

To show your app's own notifications, [`puter.notifications.onNotification()`](/Notifications/onNotification/) reads the missed ones and then listens for new ones for you.

A scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, reads an empty page whatever the subject, whether the account or an app created it.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.fetch(options)
```

## Parameters

#### `options` (Object) (required)

- `subject` (String) (required): What to read. Use `notif:app-user` for your app's notifications for the user, and `notif:developer` for notifications about your app, for its owner. The full form is `notif:<appId>:<audience>`, where the audience is `account`, `developer`, or `app-user`. Apps and websites never see `account` notifications, so `notif:account` returns an empty page for them.
- `cursor` (String): The `cursor` from the previous page. Leave it off to start from the oldest notification still kept. A read from a cursor returns the notifications created after it, plus any notification [replaced](/Notifications/notify/#groups) since that page was read, even one from an earlier page.
- `after` (String): The older name for `cursor`, still accepted. If both are given, `cursor` is used.
- `limit` (Number): Events per page. Defaults to 50, max 200.

## Return value

A `Promise` for `{ items, cursor }`:

- `items`: The events, oldest first, in the same shape as live deliveries.
- `cursor`: Pass it back as `cursor` to read the next page. It's absent on the last page. Treat it as opaque.

Each item is a notification event:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | The notification's uid. Live deliveries carry the same id, so you can drop duplicates. A replacement keeps the id, so tell it apart by `replaced` and `ts`. |
| `subject` | String | `notif:<appId or userId>:<audience>`, the part of the mailbox it belongs to. |
| `op` | String | Always `post`. |
| `uid` | String | The notification's uid. |
| `type` | String | The kind of notification, such as `share.received`, `app.worker.deployed`, or `app.message`. The types are listed below. |
| `audience` | String | `account`, `developer`, or `app-user`. |
| `appUid` | String \| null | The app it's about, or `null` for one that names no app. |
| `notification` | Object | The stored payload. It always has `type`, and every type except `kv.share.received` has a `title`. Other fields depend on `type`. |
| `replaced` | Boolean | Present and `true` when the notification replaced an earlier one with the same `uid`, as an app's notification with a [`group`](/Notifications/notify/#groups) does. |
| `self` | Boolean | Always `true`, since a mailbox is your own. |
| `ts` | Number | When it was created, in milliseconds since the epoch. On a replacement, when it was replaced, and the same on its live and fetched copies. |
| `seq` | Number | Position within the page. |

Besides `type` and `title`, `notification` carries these fields for each type:

- `share.received` (`account`): `fields.username`, `fields.count`, `fields.senders` (`[{ username, count }]`), and `fields.target` (`{ path, name }`) for a single item.
- `share.claimed` (`account`): `fields.count`.
- `app.worker.deployed`, `app.worker.deployFailed` (`developer`): nothing else.
- `app.events.suspended` (`developer`): `handler` and `subscriptions`, when removing a handler or repeated failures [suspended](/Events/onPersistent/#suspended-subscriptions) subscriptions bound to it.
- `app.events.ended` (`app-user`): `reason` (`anchor_deleted`, `permission_revoked`, or `no_credit`), sent to the holder when persistent subscriptions stopped without being unsubscribed. With `anchor_deleted` or `permission_revoked`, it also has `subject`, `subjects` (up to 20), and `count`. It arrives on `notif:app-user` of the app that made the subscriptions.
- `app.message` (`app-user`): A notification your app sent with [`notify()`](/Notifications/notify/). It carries `priority`, `ttl`, and `app` (`{ uid, name, icon }`, the app that sent it), plus `text`, `icon`, `target`, `data`, `group`, `channel`, and `sensitive` when they were set.
- `kv.share.received` (`app-user`): The `handle`, `access`, `label`, and `createdAt` (in unix seconds) of a key-value share another user made with you with `notify` on, or turned `notify` on for (see [`puter.kv.share()`](/KV/share/#what-the-holder-sees)).

Notifications of type `app.message` and `kv.share.received` arrive only on `notif:app-user` of the app they belong to. An account session reads them with the full `notif:<appId>:app-user` form. Other apps never see them, and the Puter desktop doesn't show them.

Other notifications can carry other fields, so read them defensively.

Apps see `developer` notifications only for apps the user owns. Asking for a part of the mailbox you can't see returns an empty page rather than an error, so the call doesn't reveal what exists.

Notifications are kept for the server's retention window. A client away for longer starts from what's left.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | `subject` is missing or doesn't parse. |
| `invalid_subject_audience` | A `notif:` subject names an audience other than `account`, `developer`, or `app-user`. |
| `invalid_request` | `limit` isn't a number, or `cursor` or `after` isn't a string. |
| `fetch_unsupported_subject` | The subject is `fs:` or `kv:`, which store nothing to read. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the `fetch()` rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

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
                    subject: 'notif:app-user',
                    cursor,
                });
                for (const event of page.items) {
                    puter.print(`${event.type}: ${event.notification.title ?? ''}<br>`);
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
                // A replacement keeps its id, so its time tells it apart.
                const key = event.replaced ? `${event.id}@${event.ts}` : event.id;
                if (seen.has(key)) return;
                seen.add(key);
                puter.print(`${event.notification.title ?? event.type}<br>`);
            };

            const readMissed = async () => {
                let cursor;
                do {
                    const page = await puter.events.fetch({
                        subject: 'notif:app-user',
                        cursor,
                    });
                    page.items.forEach(show);
                    cursor = page.cursor;
                } while (cursor);
            };

            // Listen first, so nothing sent during the catch-up is lost.
            // show() drops the duplicates the overlap causes.
            const sub = await puter.events.onLocal('notif:app-user', ({ event }) => {
                if (event.op === 'gap') readMissed();
                else show(event);
            });
            await readMissed();

            setTimeout(() => sub.off(), 10000);
        })();
    </script>
</body>
</html>
```
