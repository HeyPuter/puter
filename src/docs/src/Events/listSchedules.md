---
title: puter.events.listSchedules()
description: List the schedules this caller holds, one page at a time.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Lists the schedules created with [`puter.events.onSchedule()`](/Events/onSchedule/), and the notifications your app stored to send later with [`puter.notifications.notify()`](/Notifications/notify/#send-it-later). Ended schedules stay in the list for 7 days, with the reason they ended.

An app sees only the schedules it created for the user it runs for. An account session, such as the Puter desktop, sees all of the user's schedules, including ones left by apps they no longer use, so that's where to clean up stray schedules. A scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, sees none.

Schedules aren't listed by [`puter.events.list()`](/Events/list/), which lists persistent subscriptions only.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.listSchedules()
puter.events.listSchedules(options)
```

## Parameters

#### `options` (Object) (optional)

- `limit` (Number): Maximum schedules per page. Capped at 200, and defaults to 50.
- `cursor` (String | null): The `cursor` from the previous page. Leave it out, or pass `null`, for the first page.
- `includeTotal` (Boolean): Adds `total`, the number of schedules across every page. Ask for it on the first page only.

## Return value

A `Promise` for one page, `{ items, cursor?, total? }`:

- `items` (Array): The schedules on this page, oldest first. Each one is the object [`onSchedule()`](/Events/onSchedule/#return-value) returns, without `off()`.
- `cursor` (String): Present while there are more pages to load. Pass it as `cursor` to get the next page.
- `total` (Number): The number of schedules across every page, only with `includeTotal`.

**Pages can be short.** A page with fewer than `limit` items isn't the last one. Keep going until `cursor` is absent.

The `context` a schedule was created with is never returned, since it often holds secrets. The `contextKeys` field lists its key names, and `contextHash` changes whenever a value does.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_request` | `includeTotal` isn't a boolean. |
| `bad_request` | `limit` isn't a positive number. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the listing rate limit, which is shared with [`getSchedule()`](/Events/getSchedule/) and the subscription listings. |
| `events_disabled` | Schedules aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">List every schedule, page by page</strong>

```html;events-list-schedules
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Something to list: a notification to send in an hour
            const later = await puter.notifications.notify({
                title: 'Time for a break',
                sendAt: Date.now() + 60 * 60 * 1000,
            });
            if (typeof later !== 'object' || !later) return;    // due now: sent at once

            // (2) Page through everything this app holds for the user
            let cursor = null;
            do {
                const page = await puter.events.listSchedules({ cursor, limit: 50 });
                for (const schedule of page.items) {
                    const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'nothing due';
                    puter.print(`${schedule.kind} ${schedule.state}, next: ${next}<br>`);
                }
                cursor = page.cursor ?? null;
            } while (cursor);

            // (3) Cleanup
            await puter.notifications.cancel(later.scheduleId);
        })();
    </script>
</body>
</html>
```
