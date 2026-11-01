---
title: puter.events.removeSchedule()
description: End a schedule, or cancel a notification stored to send later.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Ends a schedule created with [`puter.events.onSchedule()`](/Events/onSchedule/). It doesn't run again, and it stays in [`listSchedules()`](/Events/listSchedules/) for 7 days with `endReason: 'removed'`. A run that already started isn't stopped.

It also cancels a notification your app stored to send later with [`puter.notifications.notify()`](/Notifications/notify/#send-it-later), the same as [`puter.notifications.cancel()`](/Notifications/cancel/).

The `off()` method on the schedule [`onSchedule()`](/Events/onSchedule/) returns does the same thing.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.removeSchedule(scheduleId)
```

## Parameters

#### `scheduleId` (String) (required)
The `scheduleId` from [`onSchedule()`](/Events/onSchedule/), [`notify()`](/Notifications/notify/#send-it-later) or [`listSchedules()`](/Events/listSchedules/).

## Return value

A `Promise` that resolves when the schedule has ended.

An app can only remove schedules it created. An account session can remove any of the user's schedules, including ones left by apps they no longer use. A scoped access token can't remove any.

An id this caller doesn't hold, or a schedule that already ended, is reported as not existing, so removing a schedule twice rejects the second time. With `events_schedule_sending`, `auth_canceled`, `too_many_requests` or `events_disabled`, nothing was removed. When the call fails any other way, such as a network error or `events_failed`, the removal may still have happened: read the schedule again with [`getSchedule()`](/Events/getSchedule/) to find out. It rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_schedule_not_found` | No such schedule, it isn't this caller's, or it already ended. Also for an empty `scheduleId`. |
| `events_schedule_sending` | A notification stored to send later has started to go out, so it can't be cancelled. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the remove rate limit, which is shared with [`puter.events.unsubscribe()`](/Events/unsubscribe/). |
| `events_disabled` | Schedules aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Cancel a notification, then try again</strong>

```html;events-remove-schedule
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const later = await puter.notifications.notify({
                title: 'Your trial ends tomorrow',
                sendAt: Date.now() + 24 * 60 * 60 * 1000,
            });
            if (typeof later !== 'object' || !later) return;    // due now: sent at once

            await puter.events.removeSchedule(later.scheduleId);
            puter.print('cancelled<br>');

            // Removing it twice is refused the same way an unknown id is
            try {
                await puter.events.removeSchedule(later.scheduleId);
            } catch (error) {
                puter.print(`second attempt: ${error.code}<br>`);
            }
        })();
    </script>
</body>
</html>
```
