---
title: Mark Notifications as Read
description: "Learn how to mark notifications as read in your app, so they close on the user's other phones and computers too."
tags: [notifications]
order: 71
---

A user who reads a new message on their laptop doesn't want its notification still waiting on their phone. With [`puter.notifications`](/Notifications/), your app dismisses a notification once the user has seen what it's about, and Puter closes it on the user's other devices. Every open page of your app also hears about it, so it can update its own list of unread items.

The examples build the unread list of a chat app. It assumes your app already sends notifications, as [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/) shows.

## Dismiss a Notification

Every notification has a `uid`. Your app gets it from [`onNotification()`](/Notifications/onNotification/), from a click in [`on('click')`](/Notifications/on/), or from [`notify()`](/Notifications/notify/) for a notification your app sent to its own user. When the user opens what a notification is about, dismiss it with [`puter.notifications.dismiss()`](/Notifications/dismiss/):

```js
puter.notifications.on('click', async ({ uid, target }) => {
    await puter.notifications.dismiss(uid);
    location.assign(target ?? '/');
});
```

It resolves `true` when the notification is dismissed, and `false` when it already was. Either way, the notification closes on this device.

## Close It on the User's Other Devices

On each of the user's other devices where a page of your app is open with a notification listener, the dismissed notification closes right away. On a device with no such page open, it stays on screen until the next time a page of your app starts a listener there. That page then closes the notifications already dismissed. Puter doesn't send a push only to close a notification. [`dismiss()`](/Notifications/dismiss/#closing-it-on-other-devices) has the exact rule.

So start a listener on every page load, even on pages that don't show notifications. An [`onNotification()`](/Notifications/onNotification/) or [`onPush()`](/Notifications/onPush/) listener counts, and so does an [`on('dismiss')`](/Notifications/on/) handler, which the next section adds.

## Keep Your Unread List in Sync

Your app's own list of unread items has to change too. Keep it from [`onNotification()`](/Notifications/onNotification/), and remove an item in [`on('dismiss')`](/Notifications/on/), which runs on every open page of your app when a notification is dismissed on any of the user's devices:

```js
const unread = new Map();

function renderUnread () {
    document.getElementById('unread-count').textContent = String(unread.size);
}

await puter.notifications.onNotification((n) => {
    unread.set(n.uid, n);
    renderUnread();
}, { catchUp: false });

puter.notifications.on('dismiss', ({ uid }) => {
    unread.delete(uid);
    renderUnread();
});
```

A notification [replaced through its group](/Notifications/notify/#groups) arrives again with the same `uid`, so setting it in the map replaces the old entry.

The notifications [`onNotification()`](/Notifications/onNotification/) catches up on don't say whether they were dismissed, so this list starts empty with `catchUp: false` and holds what arrives while the page is open. To keep an unread list across visits, store it in the user's [key-value store](/KV/) and remove items there when they're read.

## Mark All as Read

A "Mark all as read" button dismisses every item in the list:

```js
async function markAllRead () {
    for (const uid of [...unread.keys()]) {
        await puter.notifications.dismiss(uid);
    }
}

document.getElementById('mark-all-read').addEventListener('click', markAllRead);
```

Each [`dismiss()`](/Notifications/dismiss/) also runs this page's `on('dismiss')` handler, so the list empties as the calls finish.

## Start a New Notification Instead of Replacing One

A notification sent with a `group` replaces your earlier one in that group until the earlier one is shown or dismissed. When your app shows a notification in its own list without the user acting on it yet, mark it shown with [`markShown()`](/Notifications/markShown/). The next send in that group then creates a new notification, and the one on screen stays there:

```js
await puter.notifications.markShown(uid);
```

## Full Code

```js
const unread = new Map();

function renderUnread () {
    document.getElementById('unread-count').textContent = String(unread.size);
}

await puter.notifications.onNotification((n) => {
    unread.set(n.uid, n);
    renderUnread();
}, { catchUp: false });

puter.notifications.on('dismiss', ({ uid }) => {
    unread.delete(uid);
    renderUnread();
});

puter.notifications.on('click', async ({ uid, target }) => {
    await puter.notifications.dismiss(uid);
    location.assign(target ?? '/');
});

async function markAllRead () {
    for (const uid of [...unread.keys()]) {
        await puter.notifications.dismiss(uid);
    }
}

document.getElementById('mark-all-read').addEventListener('click', markAllRead);
```
