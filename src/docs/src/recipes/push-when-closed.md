---
title: Reach a User When Your App Is Closed
description: "Learn how to send push notifications from your app with Puter.js, so users hear about a new message or a finished task after they close it."
tags: [notifications]
order: 67
---

With `puter.notifications`, your app can notify the user it runs for. Each notification shows in the user's Puter notifications panel, and while your app is open it reaches the page right away. Once the user closes your app and Puter, the same notification goes out as a push. The browser shows it on their phone or desktop, and a tap opens your site.

This recipe sets that up for a website on its own domain. An app inside the Puter desktop only needs [`requestPermission()`](/Notifications/requestPermission/). [Push notifications for your app](/Notifications/push/) covers both cases.

## Serve the Service Worker

Pushes arrive on your own domain through a service worker. Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/v2/push-sw.js');
```

If your site already has a service worker, add that line to it and pass its path as `serviceWorker` in the calls below.

## Handle Pushes

On every page load, say what a push shows with [`puter.notifications.onPush()`](/Notifications/onPush/). The key is the `channel` you send your notifications with:

```js
await puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    body: n.text ?? '',
    url: n.target ?? '/',
}));
```

While your app is open, the handler runs in the page. While it isn't, the same handler runs in your service worker, re-created from its source, so it can only use its argument and what's written inside it. It has no `window` and 5 seconds to return. The full list of limits is on [`puter.notifications.onPush()`](/Notifications/onPush/).

## Turn Pushes On

Browsers only show their permission prompt from a user gesture, so call [`puter.notifications.enable()`](/Notifications/enable/) from a click. It asks the browser's permission on your domain, confirms the browser with Puter, and resolves `true` when pushes are on:

```js
async function turnOnPushes () {
    try {
        return await puter.notifications.enable();
    } catch (error) {
        if (error.code !== 'push_revoked') throw error;
        const allowed = await puter.notifications.requestPermission();
        return allowed && await puter.notifications.enable();
    }
}

document.getElementById('enable').addEventListener('click', async () => {
    const on = await turnOnPushes();
    console.log(on ? 'Pushes are on' : 'Pushes are off');
});
```

The call rejects with `push_revoked` when the user turned your app off in Puter's settings. That choice stands until they allow your app again, which [`puter.notifications.requestPermission()`](/Notifications/requestPermission/) asks for with Puter's own prompt. After that, [`puter.notifications.enable()`](/Notifications/enable/) goes through.

On later visits, [`puter.notifications.onPush()`](/Notifications/onPush/) keeps the browser's registration current without asking again, so the button is only needed once.

## Send a Notification

Send with [`puter.notifications.notify()`](/Notifications/notify/), with the handler's key as `channel`:

```js
await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    target: '/chats/42',
    data: { chatId: 42 },
    channel: 'chat',
});
```

It works from the page and from a worker. The notification always shows in the user's Puter notifications panel. It goes out as a push only when no page of your app received it live within 5 seconds, and a user gets at most one push a minute from each app. A notification over that still shows in the panel. The other limits are on [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

Push services can read `data`, so put IDs in it and fetch the rest. For a notification whose text shouldn't leave Puter, set `sensitive: true`, and the push shows a generic line instead.

## Full Code

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/v2/push-sw.js');
```

The page:

```js
await puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    body: n.text ?? '',
    url: n.target ?? '/',
}));

async function turnOnPushes () {
    try {
        return await puter.notifications.enable();
    } catch (error) {
        if (error.code !== 'push_revoked') throw error;
        const allowed = await puter.notifications.requestPermission();
        return allowed && await puter.notifications.enable();
    }
}

document.getElementById('enable').addEventListener('click', async () => {
    const on = await turnOnPushes();
    console.log(on ? 'Pushes are on' : 'Pushes are off');
});

await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    target: '/chats/42',
    data: { chatId: 42 },
    channel: 'chat',
});
```
