---
title: puter.events.fetch()
description: Read what a subject recorded while nothing was listening.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Reads events a subject already recorded, a page at a time. A subscription only delivers while something is listening; `fetch()` is how a client catches up on what happened while it was closed, offline, or asleep.

It is a plain query. Nothing is registered, no position is stored for you, and calling it twice returns the same answer: you keep the `cursor` and pass it back as `after`.

Only subjects with a store behind them can answer, which today means **`notif:` alone** — the notification mailbox. `fs:` and `kv:` keep no log, and asking for one is refused with `fetch_unsupported_subject` rather than answered with an empty page you would read as "nothing happened".

## Syntax
```js
puter.events.fetch(options)
```

## Parameters

#### `options` (Object) (required)

- `subject` (String) (required): What to read. `notif:account` for your account's notifications, `notif:app-user` for the ones belonging to the app you are running as, or the fully qualified `notif:<appId>:<audience>`. Audiences are `account`, `developer` (about an app, to whoever owns it), and `app-user` (about your data inside an app).
- `after` (String): The `cursor` from a previous page. Leave it off to start from the oldest notification still kept.
- `limit` (Number): Events per page. Capped at 200; defaults to 50.

## Return value

A `Promise` for `{ items, cursor }`:

- `items` — the events, **oldest first**, in the same shape a live delivery has.
- `cursor` — pass it as `after` to read the next page. It is absent when there is nothing after this page, which is how you know you are caught up.

Each item is a notification event:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | The notification's uid. The same id the live delivery of that notification carries, so a client that reconnects mid-catch-up can drop the duplicate. |
| `subject` | String | `notif:<appId or userId>:<audience>` — the slice of the mailbox it belongs to. |
| `op` | String | Always `post`. |
| `uid` | String | The notification's uid, as the mailbox names it. |
| `type` | String | What kind of notification it is, from the published catalog — `share.received`, `app.worker.deployed`, and so on. |
| `audience` | String | `account`, `developer`, or `app-user`. |
| `appUid` | String \| null | The app it is about, or `null` for one from the platform. |
| `notification` | Object | The payload — `title`, `text`, `icon`, `fields`. |
| `self` | Boolean | Always `true`: a mailbox is your own. |
| `ts` | Number | When it was created, in milliseconds since the epoch. |
| `seq` | Number | Position within the page. |

An app sees only what its audience allows: `account` notifications (email changed, credits exhausted, an account action) are never returned to an app, whatever subject it names; `developer` notifications only where the recipient owns the app. Nothing is refused for asking — a slice you may not see comes back empty, so the call cannot be used to find out what exists.

How long a notification is kept depends on the deployment's retention window, not a fixed number. A fetch reads whatever is still there, so a client away longer than the retention window starts from what is left, not from where it stopped.

The promise rejects with `{ message, code }` — `fetch_unsupported_subject` for a family with no store, `invalid_subject` or `invalid_subject_audience` for one that does not parse, `too_many_requests` over the fetch budget, `events_disabled` where events are off, `events_failed` for anything the server answered that the SDK could not make sense of.

## Examples

<strong class="example-title">Catch up on everything missed</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            let after;
            let seen = 0;
            do {
                const page = await puter.events.fetch({
                    subject: 'notif:account',
                    after,
                });
                for (const event of page.items) {
                    puter.print(`${event.type}: ${event.notification.title}<br>`);
                    seen++;
                }
                after = page.cursor;
            } while (after);

            if (!seen) puter.print('nothing missed<br>');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Read the missed ones, then keep listening</strong>

```html
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
