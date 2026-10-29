---
title: Notifications
description: Send notifications from your app to its user, as pushes too when neither Puter nor the app is open, and react when they're clicked.
platforms: [websites, apps]
---

The Notifications API lets your app notify the user it runs for: a new message, a finished export, a reminder. Each notification shows in the user's Puter notifications panel. When the user has neither Puter nor your app open, it can also reach the user's phone or browser as a push notification.

```js
await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    target: '/chats/42',
});
```

## Where a notification shows

A notification always shows in the user's Puter notifications panel. Puter then routes it one of two ways:

- **Live**, while your app is open and connected: it reaches the app through [`onNotification()`](/Notifications/onNotification/) and [`onPush()`](/Notifications/onPush/).
- **As a push**, while it isn't: to the browsers where the user turned pushes on for your app.

For a push, the user has to have turned them on. On a website, call [`enable()`](/Notifications/enable/) from a click and handle pushes with [`onPush()`](/Notifications/onPush/); they arrive on your own origin through a small service worker, and [Push notifications for your app](/Notifications/push/) has the setup step by step. Inside the Puter desktop, pushes go through Puter: ask with [`requestPermission()`](/Notifications/requestPermission/), and [`enablePush()`](/Notifications/enablePush/) offers to turn them on in the browser.

A user gets at most one push a minute from each app. A notification over that still shows in the panel; it's just not pushed.

## What a notification carries

- `title`, and optionally `text` and an `icon`.
- `target`: a path inside your app, such as `/chats/42`. When the user clicks the notification, Puter opens your app and hands the `target` back through [`on('click')`](/Notifications/on/).
- `data`: a small JSON value handed back on click. Push providers can read it, so put IDs in it, not personal content.
- `sensitive`: pushes show a generic line instead of the title and text. The panel still shows them.

See [`notify()`](/Notifications/notify/) for every field, and [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications) for the size limits and how many notifications an app can send.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="notify"><span>Send a Notification</span></div>
    <div class="example-group" data-section="click"><span>Handle a Click</span></div>
</div>

<div class="example-content" data-section="notify" style="display:block;">

#### Ask to send pushes, then notify the user

```html;notifications-notify
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Listen for this app's notifications while it's open
            const listener = await puter.notifications.onNotification((n) => {
                puter.print(`notification: ${n.title}<br>`);
            }, { catchUp: false });

            // (2) Let the user decide whether they also get pushes
            const allowed = await puter.notifications.requestPermission();
            puter.print(`pushes allowed: ${allowed}<br>`);

            // (3) Send one
            await puter.notifications.notify({
                title: 'Your export is ready',
                text: 'report.pdf finished exporting.',
                target: '/exports/report',
                data: { exportId: 'exp_123' },
            });

            setTimeout(() => listener.off(), 5000);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="click">

#### Open the right screen when a notification is clicked

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Also gets the click that launched the app.
        puter.notifications.on('click', ({ uid, target, data }) => {
            puter.print(`clicked ${uid}: open ${target}<br>`);
        });
    </script>
</body>
</html>
```

</div>

## Functions

- **[`puter.notifications.notify()`](/Notifications/notify/)** - Send the user a notification
- **[`puter.notifications.onNotification()`](/Notifications/onNotification/)** - Receive your app's notifications while it's open
- **[`puter.notifications.on('click')`](/Notifications/on/)** - React when the user clicks one of your notifications
- **[`puter.notifications.requestPermission()`](/Notifications/requestPermission/)** - Ask the user to allow pushes from your app
- **[`puter.notifications.hasPermission()`](/Notifications/hasPermission/)** - Check whether your app may send pushes
- **[`puter.notifications.enablePush()`](/Notifications/enablePush/)** - Offer to turn on pushes in the browser the user is in

For Puter's own web and mobile apps, which decide where pushes go:

- **[`puter.notifications.registerDevice()`](/Notifications/registerDevice/)** - Register a device for push notifications
- **[`puter.notifications.listDevices()`](/Notifications/listDevices/)** - List the user's registered devices
- **[`puter.notifications.removeDevice()`](/Notifications/removeDevice/)** - Stop pushes to a device

## Examples

- [Send a Notification](/playground/notifications-notify/)
