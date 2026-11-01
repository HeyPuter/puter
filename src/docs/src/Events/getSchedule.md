---
title: puter.events.getSchedule()
description: Read one schedule, including one that has ended.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Reads one schedule created with [`puter.events.onSchedule()`](/Events/onSchedule/), or one notification your app stored to send later with [`puter.notifications.notify()`](/Notifications/notify/#send-it-later). An ended schedule can be read for 7 days after it ends.

An app can read only the schedules it created. An account session can read any of the user's schedules. An id this caller can't read reads as not existing, so the call doesn't reveal which schedules exist.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.getSchedule(scheduleId)
```

## Parameters

#### `scheduleId` (String) (required)
The `scheduleId` from [`onSchedule()`](/Events/onSchedule/), [`notify()`](/Notifications/notify/#send-it-later) or [`listSchedules()`](/Events/listSchedules/).

## Return value

A `Promise` that resolves to the schedule, the object [`onSchedule()`](/Events/onSchedule/#return-value) returns, without `off()`. Its `state` says whether it's `active`, `suspended`, `sending` or `ended`, and `nextRunAt` says when it's next due.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_schedule_not_found` | No such schedule, or it isn't this caller's. Also for an empty `scheduleId`. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the listing rate limit, which is shared with [`listSchedules()`](/Events/listSchedules/). |
| `events_disabled` | Schedules aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Check when a stored notification goes out</strong>

```html;events-get-schedule
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const later = await puter.notifications.notify({
                title: 'Stand-up in 10 minutes',
                sendAt: Date.now() + 10 * 60 * 1000,
            });
            if (typeof later !== 'object' || !later) return;    // due now: sent at once

            const schedule = await puter.events.getSchedule(later.scheduleId);
            const due = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleTimeString() : 'nothing due';
            puter.print(`${schedule.state}, due ${due}<br>`);

            // Ended schedules can still be read
            await puter.notifications.cancel(later.scheduleId);
            const ended = await puter.events.getSchedule(later.scheduleId);
            puter.print(`${ended.state} (${ended.endReason})<br>`);
        })();
    </script>
</body>
</html>
```
