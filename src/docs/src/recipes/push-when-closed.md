---
title: Reach a User When Your App Is Closed
description: "Learn how to send push notifications from your app with Puter.js, so users hear about a new message or a finished task after they close it."
tags: [notifications]
order: 67
---

With `puter.notifications`, your app can notify the user it runs for. Each notification shows in the user's Puter notifications panel, and every open page of your app gets it right away. When no page of your app is open, the same notification goes out as a push. The browser shows it on the user's phone or desktop, and a tap opens your site.

This recipe sets that up for a website on its own domain. An app inside the Puter desktop only needs [`requestPermission()`](/Notifications/requestPermission/). [Push notifications for your app](/Notifications/push/) covers both cases.

## Serve the Service Worker

Pushes arrive on your own domain through a service worker. Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

If your site already has a service worker, add that line to it and pass its path as `serviceWorker` in the calls below. If that worker already gets pushes from another service, such as Firebase, give Puter its own worker in a folder instead, such as `/puter/puter-sw.js`, and pass that path. A Content-Security-Policy on the worker has to allow `https://js.puter.com` and `'unsafe-eval'` in `script-src`. The other worker rules are on [Push notifications for your app](/Notifications/push/#1-serve-a-service-worker).

## Handle Pushes

On every page load, say what a push shows with [`puter.notifications.onPush()`](/Notifications/onPush/). The key is the `channel` you send your notifications with:

```js
puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    body: n.text ?? '',
    url: n.target ?? '/',
}));
```

The handler runs in the page as each notification arrives, and in your service worker when a push arrives. The worker re-creates it from its source, so it has to be a plain `function` or an arrow function, and it can only use its argument and what's written inside it. It has no `window` and 5 seconds to return. The full list of limits is on [`puter.notifications.onPush()`](/Notifications/onPush/).

Once pushes are on, a page in the background shows the handler's result as a notification itself, and nothing is pushed.

## Turn Pushes On

Browsers only show their permission prompt from a user gesture, so call [`puter.notifications.enable()`](/Notifications/enable/) from a click. It asks the browser's permission on your domain, confirms the browser with Puter, and resolves `true` when pushes are on. The browser shows the confirmation once, as "Notifications are on".

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
    try {
        const on = await turnOnPushes();
        console.log(on ? 'Pushes are on' : 'Pushes are off');
    } catch (error) {
        console.log(`Could not turn on pushes: ${error.code}`);
    }
});
```

The call rejects with `push_revoked` when the user turned your app off in Puter's settings. That choice stands until they allow your app again, which [`puter.notifications.requestPermission()`](/Notifications/requestPermission/) asks for with Puter's own prompt. After that, [`puter.notifications.enable()`](/Notifications/enable/) goes through. The other errors, such as a second service worker for the same scope, are listed on [`puter.notifications.enable()`](/Notifications/enable/#return-value).

On later visits, [`puter.notifications.onPush()`](/Notifications/onPush/) keeps the browser's registration current without asking again, so the button is only needed once. After the user turns pushes off with [`puter.notifications.disable()`](/Notifications/disable/) or signs out, the button is needed again.

## Send a Notification

Send with [`puter.notifications.notify()`](/Notifications/notify/), with the handler's key as `channel`:

```js
async function sendMessageNotification () {
    await puter.notifications.notify({
        title: 'New message from Ana',
        text: 'See you at 6?',
        target: '/chats/42',
        data: { chatId: 42 },
        channel: 'chat',
    });
}

document.getElementById('send').addEventListener('click', sendMessageNotification);
```

The notification always shows in the user's Puter notifications panel. A page you send it from is open, so that page gets it live and nothing is pushed. A push goes out when no page of your site is open. To send while the user's tabs are closed, call [`notify()`](/Notifications/notify/) from somewhere that keeps running, such as a [Puter Worker](/Workers/) with `user.puter.notifications.notify()`, or an [events handler](/Events/handlers/) with `user.notifications.notify()`. [Push notifications for your app](/Notifications/push/#sending-a-notification) has the details, and [Run Code in the Background](/recipes/run-code-in-the-background/) sets up an events handler.

A website using Puter.js starts out unlisted, so it gets the lower push limits for new apps. A notification over a limit still shows in the panel. The numbers are on [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

Push services can read `data`, so put IDs in it and fetch the rest. For a notification whose text shouldn't leave Puter, set `sensitive: true`, and the push shows a generic line instead.

## Full Code

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

The page, with an `enable` button and a `send` button:

```js
puter.notifications.onPush('chat', (n) => ({
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
    try {
        const on = await turnOnPushes();
        console.log(on ? 'Pushes are on' : 'Pushes are off');
    } catch (error) {
        console.log(`Could not turn on pushes: ${error.code}`);
    }
});

async function sendMessageNotification () {
    await puter.notifications.notify({
        title: 'New message from Ana',
        text: 'See you at 6?',
        target: '/chats/42',
        data: { chatId: 42 },
        channel: 'chat',
    });
}

document.getElementById('send').addEventListener('click', sendMessageNotification);
```
