---
title: puter.notifications.markShown()
description: Mark one of your app's notifications as shown, so the next one in its group arrives as a new notification.
platforms: [websites, apps]
---

Marks one of your app's notifications as shown, such as when your app displayed it in its own list.

After you mark the newest notification in a [group](/Notifications/notify/#groups) as shown, the next send with that group creates a new notification instead of replacing it. A notification already on screen stays there. To close it on the user's devices too, use [`dismiss()`](/Notifications/dismiss/).

## Syntax
```js
puter.notifications.markShown(uid)
```

## Parameters

#### `uid` (String) (required)
The notification's `uid`. For an immediate notification to your app's own user, [`notify()`](/Notifications/notify/) resolves with it. Notifications delivered to [`onNotification()`](/Notifications/onNotification/) and [`on('click')`](/Notifications/on/) also carry it.

## Return value

A `Promise` that resolves to `true` when the notification is marked shown. It resolves to `false` when it was already marked shown, doesn't exist, or isn't one of your app's notifications for this user.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `uid` isn't a non-empty string. |
| `too_many_requests` | Too many notification calls in a short time. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications). |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `notifications_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Start a new notification in a group</strong>

```html;notifications-mark-shown
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const first = await puter.notifications.notify({ title: '1 new message', group: 'inbox' });

            // (1) Unshown, so the next one in the group replaces it and keeps its uid
            const second = await puter.notifications.notify({ title: '2 new messages', group: 'inbox' });
            puter.print(`replaced: ${second === first}<br>`);

            // (2) Marked shown, so the next one in the group is a new notification
            await puter.notifications.markShown(second);
            const third = await puter.notifications.notify({ title: '1 new message', group: 'inbox' });
            puter.print(`new notification: ${third !== second}<br>`);
        })();
    </script>
</body>
</html>
```
