---
title: Push notifications for your app
description: Reach the user when your app isn't open, from a website on its own domain or from an app inside the Puter desktop.
platforms: [websites, apps]
---

A push notification reaches the user when your app isn't open to receive a notification live. It shows on their phone or desktop, and a tap opens your app. Your app sends it with [`notify()`](/Notifications/notify/), the same call that puts a notification in the user's Puter notifications panel. Puter decides the route. A page of your app that receives the notification through [`onNotification()`](/Notifications/onNotification/) or [`onPush()`](/Notifications/onPush/) tells Puter so on its own, and the notification isn't pushed. When no page of your app receives it within 5 seconds, it goes out as a push.

This page is the setup. A website on its own domain needs three steps, and an app inside the Puter desktop needs one.

## A website on its own domain

On a website, pushes arrive on your own domain through a small service worker, and the browser asks the user for permission on your domain.

### 1. Serve a service worker

Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/v2/push-sw.js');
```

If your site already has a service worker, add that line to it and pass its path as `serviceWorker` to [`onPush()`](/Notifications/onPush/) and [`enable()`](/Notifications/enable/).

### 2. Say what a push shows

On every page load, register a handler with [`onPush()`](/Notifications/onPush/) for each kind of notification you send. The key is the `channel` you pass to [`notify()`](/Notifications/notify/).

```js
puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    url: n.target ?? '/',
}));
```

While your app is open, the handler runs in the page as each notification arrives. While it isn't, the same handler runs in your service worker to decide what the push shows. The handler is saved as source and run again in the worker, so it has these limits:

- It can't use variables, functions or imports from around it. Everything it needs comes from its argument or is written inside it.
- It has no `window`, `document` or `localStorage`. `fetch`, `indexedDB` and `caches` are available.
- It has 5 seconds. After that, or if it throws, the push shows the notification's own title and text.
- It can change what the push shows but can't hide it. Browsers show a notification for every push.

Returning nothing shows the notification's own `title` and `text`. The fields a handler can return are listed on [`onPush()`](/Notifications/onPush/).

### 3. Let the user turn pushes on

Call [`enable()`](/Notifications/enable/) from a click. Browsers only show their permission prompt from a user gesture.

```js
document.getElementById('enable').addEventListener('click', async () => {
    const on = await puter.notifications.enable();
    puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
});
```

The browser asks for permission on your domain. Puter then sends a confirmation push to that browser, and the browser is registered once your worker hands the confirmation back. Allowing it also lets your app's notifications go out as pushes. On later visits, [`onPush()`](/Notifications/onPush/) keeps the registration current without asking again.

[`enable()`](/Notifications/enable/) resolves `true` when pushes are on in this browser, and `false` when the user didn't allow notifications or the browser can't receive pushes. It rejects with `push_revoked` when the user turned your app off in Puter's settings. That choice stands until the user allows your app again, so call [`requestPermission()`](/Notifications/requestPermission/) from a click, which opens Puter's permission prompt, and then call [`enable()`](/Notifications/enable/) again:

```js
document.getElementById('enable').addEventListener('click', async () => {
    try {
        await puter.notifications.enable();
    } catch (error) {
        if (error.code !== 'push_revoked') throw error;
        if (await puter.notifications.requestPermission()) {
            await puter.notifications.enable();
        }
    }
});
```

To turn pushes off in this browser again, call [`disable()`](/Notifications/disable/). Notifications still reach your app live while it's open.

## Sending a push

Send the notification with [`notify()`](/Notifications/notify/), with the handler's key as `channel`:

```js
await puter.notifications.notify({
    title: 'New message from Ana',
    text: 'See you at 6?',
    target: '/chats/42',
    data: { chatId: 42 },
    channel: 'chat',
});
```

It works from the page and from a worker. The notification always shows in the user's Puter notifications panel. It goes out as a push only when no page of your app received it live within 5 seconds, and a user gets at most 12 pushes a minute and 1,000 a day from each app, and fewer while the app is new. The other limits are on [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

When the user taps the push, the browser opens the handler's `url` on your domain. When the user clicks the notification in the Puter panel instead, Puter opens your app and hands the `target` and `data` back through [`on('click')`](/Notifications/on/).

## A minimal page

Serve the page below from a site that has `/puter-sw.js` to try it. It registers the handler, turns pushes on from a click, and sends a notification. The notification arrives live while the page is open, and as a push while it isn't.

```html;notifications-push
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="enable">Turn on notifications</button>
    <button id="send">Send me a notification</button>
    <script>
        // Runs in the page while it's open, and in /puter-sw.js while it isn't.
        puter.notifications.onPush('chat', (n) => ({
            title: n.title,
            body: n.text ?? '',
            url: n.target ?? '/',
        }));

        document.getElementById('enable').addEventListener('click', async () => {
            const on = await puter.notifications.enable();
            puter.print(on ? 'Pushes are on<br>' : 'Pushes are off<br>');
        });

        document.getElementById('send').addEventListener('click', async () => {
            await puter.notifications.notify({
                title: 'New message from Ana',
                text: 'See you at 6?',
                target: '/chats/42',
                channel: 'chat',
            });
            puter.print('Sent<br>');
        });
    </script>
</body>
</html>
```

## An app inside the Puter desktop

An app inside the Puter desktop needs no worker and no [`enable()`](/Notifications/enable/). Pushes go through Puter itself. Ask once, from a click:

```js
const allowed = await puter.notifications.requestPermission();
```

Puter's permission dialog opens. When the user allows it, Puter also turns pushes on in the browser they answered in, and your notifications go out as pushes from then on. For a user who already allowed your app, in a browser where pushes aren't on yet, [`enablePush()`](/Notifications/enablePush/) shows a one-button dialog that turns them on. [`hasPermission()`](/Notifications/hasPermission/) says whether the user allowed your app, without asking, so you can decide whether to show a button at all.

While the app is open, [`onPush()`](/Notifications/onPush/) and [`onNotification()`](/Notifications/onNotification/) receive its notifications live, the same as on a website.

## Good to know

- Say who did what. "Ana shared Q3-report.pdf" reads well as a push. A push that only says there's something new can be hidden as spam on Android.
- The `data` field is handed back on click, and push services can read it, so put IDs in it and fetch the rest. Set `sensitive: true` when the title and text shouldn't leave Puter. The push then shows a generic line, and the panel still shows the notification.
- A push carries about 4 KB, with `data` at most 1 KB.
- A tap opens your domain. The `url` a handler returns has to be on your origin, and other origins are replaced with your site's root.
- Pushes from your app count toward the user's usage. See [What pushes cost](/rate-limits-and-quotas/#what-pushes-cost). Puter's own notifications are free.
