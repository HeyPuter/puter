---
title: Reach a User When Your App Is Closed
description: "Learn how to send push notifications from your app with Puter.js, so users hear about a new message or a finished task after they close it."
tags: [notifications]
order: 67
---

With [`puter.notifications`](/Notifications/), your app can notify the user it runs for. Each notification goes to your app, not the Puter desktop's notifications panel, and every open page of your app gets it right away. When no page of your app is open, or the open pages are in the background, the same notification goes out as a push. The browser shows it on the user's phone or desktop, and a tap opens your site.

This recipe sets that up for a website on its own domain. An app inside the Puter desktop only needs [`enable()`](/Notifications/enable/), called from a click. [Push notifications for your app](/Notifications/push/) covers both cases.

Pushes work in a normal tab in desktop browsers and on Android. On iPhone and iPad, the user first adds your site to the Home Screen and turns pushes on from there. [Where pushes work](/Notifications/push/#where-pushes-work) lists what each browser and device needs.

## Serve the Service Worker

Pushes arrive on your own domain through a service worker. Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

If your site already has a service worker, add that line to it and pass its path as `serviceWorker` in the calls below. If that worker already gets pushes from another service, such as Firebase, give Puter its own worker in a folder instead, such as `/puter/puter-sw.js`, and pass that path. The worker has to be on your origin and served as JavaScript over HTTPS, and [Puter Hosting](/Hosting/) does this when the file is in the root of the folder you host. A Content-Security-Policy on the worker has to allow `https://js.puter.com` and `'unsafe-eval'` in `script-src`. The other worker rules are on [Push notifications for your app](/Notifications/push/#requirements).

## Handle Pushes

On every page load, say what a push shows with [`puter.notifications.onPush()`](/Notifications/onPush/). The key is the `channel` you send your notifications with:

```js
await puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    body: n.text ?? '',
    url: n.target ?? '/',
}));
```

The handler runs in the page as each notification arrives, and in your service worker when a push arrives. The worker re-creates it from its source, so it has to be a plain `function` or an arrow function, and it can only use its argument and what's written inside it. It has no `window` and 5 seconds to return. The full list of limits is on [`puter.notifications.onPush()`](/Notifications/onPush/).

Once pushes are on, a page in the background shows the handler's result as a notification itself, and nothing is pushed.

## Turn Pushes On

Browsers only show their permission prompt from a user gesture, so call [`puter.notifications.enable()`](/Notifications/enable/) from a click. It asks the browser's permission on your domain, registers the browser with Puter, and resolves `true` when pushes are on. Puter confirms the browser with a push that shows once, as "Notifications are on", and pushes start once it arrives, usually within seconds.

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

const enableButton = document.getElementById('enable');
enableButton.hidden = await puter.notifications.status() !== 'off';

enableButton.addEventListener('click', async () => {
    try {
        const on = await turnOnPushes();
        enableButton.hidden = on;
        console.log(on ? 'Pushes are on' : 'Pushes are off');
    } catch (error) {
        console.log(`Could not turn on pushes: ${error.code}`);
    }
});
```

The call rejects with `push_revoked` when the user turned your app off in Puter's settings. That choice stands until they allow your app again, which [`puter.notifications.requestPermission()`](/Notifications/requestPermission/) asks for with Puter's own prompt. After that, [`puter.notifications.enable()`](/Notifications/enable/) goes through. The other errors, such as a second service worker for the same scope, are listed on [`puter.notifications.enable()`](/Notifications/enable/#return-value).

The [`puter.notifications.status()`](/Notifications/status/) method says whether pushes are on in this browser without asking anything, so the page shows the button only when it's `'off'`. When it's `'blocked'`, the user has to allow notifications in the browser's settings. On later visits, [`puter.notifications.onPush()`](/Notifications/onPush/) keeps the browser's registration current without asking again. After the user turns pushes off with [`puter.notifications.disable()`](/Notifications/disable/) or signs out, [`status()`](/Notifications/status/) is `'off'` again.

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
        group: 'chat:42',
    });
}

document.getElementById('send').addEventListener('click', sendMessageNotification);
```

The `group` makes a newer notification for the same chat replace this one, instead of adding another. Every open page gets the notification live, and a page that's visible and focused, or shows the notification itself, holds the push back. So a notification sent from the page the user is looking at isn't pushed. [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed) has the full rule. To send while the user's tabs are closed, call [`notify()`](/Notifications/notify/) from somewhere that keeps running, such as a [Puter Worker](/Workers/) with [`user.puter.notifications.notify()`](/Notifications/notify/), or an [events handler](/Events/handlers/) with [`user.notifications.notify()`](/Notifications/notify/). [Push notifications for your app](/Notifications/push/#sending-a-notification) has the details, and [Run Code in the Background](/recipes/run-code-in-the-background/) sets up an events handler. To notify another user, see [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/).

A website using Puter.js starts out unlisted, so it gets the lower push limits for new apps. A notification over a limit still reaches your app live. The numbers are on [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

Push services can read `data`, so put IDs in it and fetch the rest. For a notification whose text shouldn't leave Puter, set `sensitive: true`, and the push shows a generic line instead.

## Full Code

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

The page, with an `enable` button and a `send` button:

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

const enableButton = document.getElementById('enable');
enableButton.hidden = await puter.notifications.status() !== 'off';

enableButton.addEventListener('click', async () => {
    try {
        const on = await turnOnPushes();
        enableButton.hidden = on;
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
        group: 'chat:42',
    });
}

document.getElementById('send').addEventListener('click', sendMessageNotification);
```
