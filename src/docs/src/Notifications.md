---
title: Notifications
description: Send notifications from your app to its users, push them to their phone or computer when they aren't looking at your app, and react when they're clicked.
platforms: [websites, apps]
---

The Notifications API lets your app send notifications to its users, such as a new message, a finished export or a reminder. Every open page of your app gets each notification right away. When the user isn't looking at your app, it also goes out as a push notification to their phone or computer, and a tap opens your app.

```js
await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    target: '/chats/42',
});
```

## How a notification reaches the user

A notification goes to your app, and the Puter desktop's notifications panel doesn't show it. It reaches the user in two ways:

- **Live.** Every open page of your app gets it, on any of the user's devices, through [`onNotification()`](/Notifications/onNotification/) or [`onPush()`](/Notifications/onPush/). A page can also read back the ones sent while it was closed.
- **As a push.** When no page of your app is open, or the open pages are in the background, it goes out as a push to the browsers where the user turned pushes on for your app. A tap on the push calls your [`on('click')`](/Notifications/on/) handler.

The user turns pushes on once in each browser, from a click. On a website, pushes arrive on your own domain through a one-line service worker, and [`enable()`](/Notifications/enable/) turns them on. Inside the Puter desktop, pushes go through Puter, and [`enable()`](/Notifications/enable/) asks the user to allow your app. [Push notifications for your app](/Notifications/push/) has the setup and the browsers and devices that can receive pushes.

## What a notification carries

A notification has a `title`, and optionally `text` and an `icon`. A `target` path inside your app, such as `/chats/42`, and a small `data` value come back to your app when the user clicks it. A `group` replaces your earlier notification in the same group instead of adding another one, and `sensitive: true` keeps the title and text out of pushes.

[`notify()`](/Notifications/notify/) lists every field. [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications) lists the size limits and how many notifications and pushes your app can send each user.

## Who you can notify

A notification goes to the user your app runs for. To notify another user, such as a chat member, share data with them in a [key-value share](/KV/share/) made with `notify: true`, and send through the share's handle. Each side of the share can notify the other.

You can send from a page, from a [Puter Worker](/Workers/), or from an [events handler](/Events/handlers/) that runs while your app is closed.

## Notifications and Events

Your app's notifications are events on the `notif:app-user` [subject](/Events/subjects/#notifications). [`onNotification()`](/Notifications/onNotification/) catches up on them and listens for new ones for you. To page through them yourself, use [`puter.events.fetch()`](/Events/fetch/).

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="notify"><span>Send a Notification</span></div>
    <div class="example-group" data-section="click"><span>Handle a Click</span></div>
    <div class="example-group" data-section="push"><span>Push to a Website</span></div>
</div>

<div class="example-content" data-section="notify" style="display:block;">

#### Listen for your app's notifications, then send one

```html;notifications-notify
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Listen for this app's notifications while it's open
            const listener = await puter.notifications.onNotification((n) => {
                puter.print(`Received: ${n.title}<br>`);
            }, { catchUp: false });

            // (2) Send one. This page is open, so it arrives here live.
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
        // Also gets the click that opened the app.
        puter.notifications.on('click', ({ uid, target, data }) => {
            puter.print(`Clicked ${uid}, open ${target}<br>`);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="push">

#### Turn on pushes for a website, then say what they show

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="enable">Turn on notifications</button>
    <script>
        // Needs /puter-sw.js on your site. See Push notifications for your app.
        puter.notifications.onPush('chat', (n) => ({
            title: n.title,
            body: n.text ?? '',
            url: n.target ?? '/',
        }));

        document.getElementById('enable').addEventListener('click', async () => {
            try {
                const on = await puter.notifications.enable();
                puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
            } catch (error) {
                puter.print(`Could not turn on notifications: ${error.code}<br>`);
            }
        });
    </script>
</body>
</html>
```

</div>

## Functions

- **[`puter.notifications.notify()`](/Notifications/notify/)** - Send a notification to the user, or to the other side of a key-value share
- **[`puter.notifications.onNotification()`](/Notifications/onNotification/)** - Receive your app's notifications, including the ones sent while it was closed
- **[`puter.notifications.onPush()`](/Notifications/onPush/)** - Say what a push shows for one channel, and handle its notifications while the page is open
- **[`puter.notifications.on('click')`](/Notifications/on/)** - React when the user clicks one of your notifications
- **[`puter.notifications.enable()`](/Notifications/enable/)** - Turn on pushes for your app in this browser
- **[`puter.notifications.disable()`](/Notifications/disable/)** - Turn off pushes for your app
- **[`puter.notifications.status()`](/Notifications/status/)** - Check whether pushes reach this browser, without asking
- **[`puter.notifications.requestPermission()`](/Notifications/requestPermission/)** - Ask the user to allow pushes from your app
- **[`puter.notifications.hasPermission()`](/Notifications/hasPermission/)** - Check whether the user allows pushes from your app, without asking
- **[`puter.notifications.enablePush()`](/Notifications/enablePush/)** - Turn on pushes through Puter in this browser

For Puter's own apps, which manage where pushes go:

- **[`puter.notifications.listDevices()`](/Notifications/listDevices/)** - List the browsers that receive the user's pushes
- **[`puter.notifications.removeDevice()`](/Notifications/removeDevice/)** - Stop pushes to one of them

## Examples

- [Send a Notification](/playground/notifications-notify/)
- [Push notifications for a website](/Notifications/push/#a-minimal-page)

## Recipes

- [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/)
- [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/)
- [Alert Users When Shared Data Changes](/recipes/alert-users-when-shared-data-changes/)
- [Catch Up on Notifications](/recipes/catch-up-on-notifications/)
