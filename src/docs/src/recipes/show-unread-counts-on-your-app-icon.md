---
title: Show Unread Counts on Your App Icon
description: "Learn how to show the number of unread messages on your app's icon when users install your website as an app on their phone or computer."
tags: [notifications]
order: 71
---

Installed apps often show a count on their icon, such as the number of unread messages. A website the user installed, such as one added to the Home Screen on an iPhone or installed from the browser on a computer, can do the same with the browser's [Badging API](https://developer.chrome.com/docs/capabilities/web-apis/badging-api). Puter.js has no call for it. Your app sets the count when a push arrives, from its [`puter.notifications`](/Notifications/) push handler, and clears it when the user reads the messages.

This recipe assumes your website has push notifications set up, as [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/) shows. Browsers that don't support badges, or a website that isn't installed, show no count, and the rest of your app works the same.

## Send the Count

Put the unread count in the notification's `data`, where your push handler can read it:

```js
await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    channel: 'messages',
    data: { chatId: 42, unreadCount: 3 },
});
```

The sender works out the count, for example from the user's messages in the [key-value store](/KV/).

## Set the Badge When a Push Arrives

On every page load, register an [`onPush()`](/Notifications/onPush/) handler for the `messages` channel that sets the badge with `navigator.setAppBadge()`:

```js
await puter.notifications.onPush('messages', async (n) => {
    const count = n.data?.unreadCount;
    if (Number.isSafeInteger(count) && count >= 0) {
        try {
            await navigator.setAppBadge?.(count);
        } catch {
            // The browser refused the badge. The notification still shows.
        }
    }
    return { title: n.title, body: n.text ?? '' };
});
```

The handler runs in your service worker when a push arrives, and in the page when the notification arrives while it's open, so the badge updates in both cases. The `?.` skips the call in browsers without badges. The `badge` field a handler can return is a small image on the notification, not a count.

## Clear It When the User Reads

When the user opens your app and reads the messages, clear the count with `navigator.clearAppBadge()`. When another device marks them read with [`dismiss()`](/Notifications/dismiss/), the [`on('dismiss')`](/Notifications/on/) handler clears it here too:

```js
async function clearBadge () {
    try {
        await navigator.clearAppBadge?.();
    } catch {
        // The browser refused the badge update.
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void clearBadge();
});
puter.notifications.on('dismiss', () => { void clearBadge(); });
await clearBadge();
```

To show a count that's still above zero, call `navigator.setAppBadge(count)` with it instead. [Mark Notifications as Read](/recipes/mark-notifications-as-read/) shows how to dismiss notifications as the user reads them.

## Full Code

```js
await puter.notifications.onPush('messages', async (n) => {
    const count = n.data?.unreadCount;
    if (Number.isSafeInteger(count) && count >= 0) {
        try {
            await navigator.setAppBadge?.(count);
        } catch {
            // The browser refused the badge. The notification still shows.
        }
    }
    return { title: n.title, body: n.text ?? '' };
});

async function clearBadge () {
    try {
        await navigator.clearAppBadge?.();
    } catch {
        // The browser refused the badge update.
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void clearBadge();
});
puter.notifications.on('dismiss', () => { void clearBadge(); });
await clearBadge();

await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    channel: 'messages',
    data: { chatId: 42, unreadCount: 3 },
});
```
