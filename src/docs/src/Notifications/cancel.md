---
title: puter.notifications.cancel()
description: Cancel a notification your app stored to send later, before it goes out.
platforms: [websites, apps]
---

Cancels a notification your app stored to send later with [`notify()`](/Notifications/notify/#send-it-later) and `sendAt`. It isn't sent, and it stops counting toward the [limit on what your app has waiting](/rate-limits-and-quotas/#schedules) for the user.

It does the same thing as [`puter.events.removeSchedule()`](/Events/removeSchedule/), and shares its rate limit with it. The cancelled notification stays in [`puter.events.listSchedules()`](/Events/listSchedules/) for 7 days, with `state: 'ended'` and `endReason: 'removed'`.

A notification in `sending` can't be cancelled. If a send fails before the notification is written, it can return to `active` and be cancelled while it waits to retry. Once it's sent, it's in the user's notifications like any other.

To move it to another time or change what it says instead, use [`puter.events.updateSchedule()`](/Events/updateSchedule/).

## Syntax
```js
puter.notifications.cancel(scheduleId)
```

## Parameters

#### `scheduleId` (String) (required)
The `scheduleId` that [`notify()`](/Notifications/notify/#send-it-later) resolved with.

## Return value

A `Promise` that resolves when the notification is cancelled.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `events_schedule_not_found` | No such notification, it isn't your app's, or it was already sent or cancelled. Also for an empty `scheduleId`. |
| `events_schedule_sending` | It has started to go out, so it can't be cancelled. |
| `too_many_requests` | Over the cancel rate limit, which is shared with [`puter.events.removeSchedule()`](/Events/removeSchedule/) and [`puter.events.unsubscribe()`](/Events/unsubscribe/). |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_disabled` | Sending later isn't available on this server, as on self-hosted servers. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Store a reminder, then cancel it</strong>

```html;notifications-send-later
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Send it in 30 minutes instead of now
            const later = await puter.notifications.notify({
                title: 'Your timer is done',
                target: '/timers',
                sendAt: Date.now() + 30 * 60 * 1000,
            });
            if (typeof later !== 'object' || !later) return;    // due now, so it was sent at once
            puter.print(`stored ${later.scheduleId}, goes out ${new Date(later.sendAt).toLocaleTimeString()}<br>`);

            // (2) The user stopped the timer, so it shouldn't go out
            await puter.notifications.cancel(later.scheduleId);
            puter.print('cancelled<br>');
        })();
    </script>
</body>
</html>
```
