---
title: Push notifications for your app
description: Reach the user when they aren't looking at your app, from a website on its own domain or from an app inside the Puter desktop.
platforms: [websites, apps]
---

A push notification reaches the user when they aren't looking at your app. It shows on their phone or desktop, and a tap opens your app. Your app sends it with [`notify()`](/Notifications/notify/), the same call that puts a notification in the user's Puter notifications panel. Puter decides whether it also goes out as a push.

This page is the setup. A website on its own domain needs three steps, and an app inside the Puter desktop needs one.

## When a notification is pushed

Every notification your app sends shows in the user's Puter notifications panel. Every open page of your app, on any of the user's devices, also gets it live through [`onNotification()`](/Notifications/onNotification/) and [`onPush()`](/Notifications/onPush/).

Puter then asks those pages whether they received it. If a page answers within 5 seconds that it's visible and focused, or that it shows the notification itself, nothing is pushed. Otherwise Puter pushes the notification to the browsers where the user turned pushes on for your app.

A page of your site shows the notification itself when all of these are true:

- The page is hidden, or its window isn't focused.
- It has an [`onPush()`](/Notifications/onPush/) handler.
- The user allowed notifications for your site in this browser.
- No other tab of your site is focused.

It shows what the handler returns, or the notification's own title and text when no handler matches the notification's `channel`. Inside the Puter desktop, Puter shows it instead.

So a push goes out when no page of your app is open, or when the open pages are in the background and can't show the notification themselves. A page that loads an older version of Puter.js, such as one bundled from npm, holds the push back whenever it's open.

## Requirements

Pushes on a website need:

- HTTPS, or `localhost` while you develop.
- A browser that supports Web Push. On iOS and iPadOS that's version 16.4 or later, and only for a site the user added to their Home Screen. The site's web app manifest has to set `"display": "standalone"`.

In a browser that can't receive pushes, [`enable()`](/Notifications/enable/) resolves `false`.

## A website on its own domain

On a website, pushes arrive on your own domain through a small service worker, and the browser asks the user for permission on your domain. Puter sends your site's pushes only to browsers that turned pushes on for your site. They never show under puter.com.

### 1. Serve a service worker

Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

The worker follows the browser's service worker rules:

- **One worker per scope.** If your site already has a service worker for that scope, add the `importScripts()` line to it and pass its path as `serviceWorker` to [`onPush()`](/Notifications/onPush/), [`enable()`](/Notifications/enable/) and [`disable()`](/Notifications/disable/). Otherwise [`enable()`](/Notifications/enable/) rejects with `push_worker_conflict`.
- **One push subscription per worker.** If that worker already gets pushes from another service, such as Firebase or OneSignal, give Puter its own worker in a folder, such as `/puter/puter-sw.js`, and pass that path as `serviceWorker`. Otherwise [`enable()`](/Notifications/enable/) rejects with `push_subscription_conflict`.
- **Content-Security-Policy.** If the worker is served with a Content-Security-Policy, its `script-src` has to allow `https://js.puter.com` and `'unsafe-eval'`. The worker re-creates your handler from its source with `new Function`.
- **Updates.** A changed worker only runs once it activates. Call `self.skipWaiting()` in it, or close every tab of your site.
- **Errors.** An error your handler throws in the worker shows only in the service worker's console, not the page's. In Chrome, open it from DevTools under **Application** > **Service workers**.

### 2. Say what a push shows

On every page load, register a handler with [`onPush()`](/Notifications/onPush/) for each kind of notification you send. The key is the `channel` you pass to [`notify()`](/Notifications/notify/).

```js
puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    url: n.target ?? '/',
}));
```

The handler runs in the page as each notification arrives, and in your service worker when a push arrives. The worker runs it again from its saved source, so it has these limits:

- It has to be a plain `function` or an arrow function. A method shorthand, a bound function or a class method can't be re-created from its source, so [`onPush()`](/Notifications/onPush/) rejects it with `invalid_handler`.
- It can't use variables, functions or imports from around it. Everything it needs comes from its argument or is written inside it.
- It has no `window`, `document` or `localStorage`. It can use `fetch`, `indexedDB` and `caches`.
- It has 5 seconds. After that, or if it throws, the push shows the notification's own title and text.
- It can change what the push shows but can't hide it. Browsers show a notification for every push.

Returning nothing shows the notification's own `title` and `text`. The fields a handler can return are listed on [`onPush()`](/Notifications/onPush/).

### 3. Let the user turn pushes on

Call [`enable()`](/Notifications/enable/) from a click. Browsers only show their permission prompt from a user gesture.

```js
document.getElementById('enable').addEventListener('click', async () => {
    try {
        const on = await puter.notifications.enable();
        puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
    } catch (error) {
        puter.print(`Could not turn on notifications: ${error.code}<br>`);
    }
});
```

The browser asks for permission on your domain. Puter then sends a confirmation push to that browser, which shows once as "Notifications are on". The browser is registered once your worker hands the confirmation back. Allowing it also lets your app's notifications go out as pushes.

The choice sticks. On later page loads, [`onPush()`](/Notifications/onPush/) keeps the registration current without asking again.

[`enable()`](/Notifications/enable/) resolves `true` when pushes are on in this browser, and `false` when the user didn't allow notifications or the browser can't receive pushes. Every error it rejects with is listed on [`enable()`](/Notifications/enable/#return-value). It rejects with `push_revoked` when the user turned your app off in Puter's settings. That choice stands until the user allows your app again, so call [`requestPermission()`](/Notifications/requestPermission/) from a click, which opens Puter's permission prompt, and then call [`enable()`](/Notifications/enable/) again:

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

To turn pushes off in this browser again, call [`disable()`](/Notifications/disable/). Notifications still reach your app live while it's open. Page loads don't turn pushes back on after [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/). Call [`enable()`](/Notifications/enable/) from a click to turn them on again. Signing out also removes this browser's registration for your app.

## Sending a notification

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

A notification goes to one user, the one the call runs for. You can send it from three places:

- **The page**, with [`puter.notifications.notify()`](/Notifications/notify/) as above.
- **A [Puter Worker](/Workers/)**, with `user.puter.notifications.notify()` in a route your page calls through [`puter.workers.exec()`](/Workers/exec/). It notifies the user who called the worker, from the app that called it.
- **An [events handler](/Events/handlers/)**, with `user.notifications.notify()`. It notifies the user who holds the subscription, and it runs while your app is closed. Running a handler in the background needs the user's `events:background` permission, as [`onPersistent()`](/Events/onPersistent/) describes.

In a worker, `me.puter` is you, the worker's owner. A `me.puter.notifications.notify()` call notifies you, not the user who called the worker, and it rejects with `forbidden` when the worker doesn't run as an app.

The notification always shows in the user's Puter notifications panel. It goes out as a push only as described in [When a notification is pushed](#when-a-notification-is-pushed). A user gets at most 12 pushes a minute and 1,000 a day from each app. An app younger than 30 days or not approved for listing gets 6 a minute and 200 a day, and a website using Puter.js starts out unlisted. Over a cap, the notification still shows in the panel and [`notify()`](/Notifications/notify/) still resolves. The other limits are on [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

## When the user taps

A tap on a push, or on a notification a page of your site showed itself, works like this:

- When no page of your site is open, the browser opens the handler's `url`, resolved against your worker's scope. The new page's first [`on('click')`](/Notifications/on/) handler gets the click.
- When a page of your site is open, the tap focuses it and calls its [`on('click')`](/Notifications/on/) handlers. A page without a `click` handler goes to `url` instead.

A click in the Puter notifications panel opens your app inside Puter and hands the `target` and `data` to [`on('click')`](/Notifications/on/).

## Groups and sensitive notifications

A newer notification with the same `group` replaces the one showing, and the device alerts the user again.

With `sensitive: true`, pushes and the notification a page shows itself show a generic line instead of the title and text. A sensitive push carries no `channel`, `target` or `data`. So no [`onPush()`](/Notifications/onPush/) handler runs for it, a tap opens `/`, and [`on('click')`](/Notifications/on/) gets `null` for `target` and `data`. The Puter notifications panel still shows the whole notification.

## A minimal page

To try it, serve the page below from a site that has `/puter-sw.js`. It registers the handler, turns pushes on from a click, and sends a notification 5 seconds after you click Send. Switch to another tab during those 5 seconds. The page is then in the background, so it shows the notification itself and nothing is pushed.

A real push goes out only when no page of your site is open. To see one, turn pushes on, close every tab of your site, and send from somewhere else, such as a [Puter Worker](/Workers/) that runs as your app or an [events handler](/Events/handlers/).

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="enable">Turn on notifications</button>
    <button id="send">Send me a notification</button>
    <script>
        // Runs in this page, and in /puter-sw.js when a push arrives.
        puter.notifications.onPush('chat', (n) => ({
            title: n.title,
            body: n.text ?? '',
            url: n.target ?? '/',
        }));

        puter.notifications.on('click', ({ target }) => {
            puter.print(`Clicked, open ${target}<br>`);
        });

        document.getElementById('enable').addEventListener('click', async () => {
            try {
                const on = await puter.notifications.enable();
                puter.print(on ? 'Pushes are on<br>' : 'Pushes are off<br>');
            } catch (error) {
                puter.print(`Could not turn on pushes: ${error.code}<br>`);
            }
        });

        document.getElementById('send').addEventListener('click', () => {
            puter.print('Sending in 5 seconds. Switch to another tab now.<br>');
            setTimeout(async () => {
                try {
                    await puter.notifications.notify({
                        title: 'New message from Ana',
                        text: 'See you at 6?',
                        target: '/chats/42',
                        channel: 'chat',
                    });
                    puter.print('Sent<br>');
                } catch (error) {
                    puter.print(`Could not send: ${error.code}<br>`);
                }
            }, 5000);
        });
    </script>
</body>
</html>
```

## An app inside the Puter desktop

An app inside the Puter desktop needs no worker and no [`enable()`](/Notifications/enable/). Pushes go through Puter itself, and Puter shows your app's name and icon on them. Ask once, from a click:

```js
const allowed = await puter.notifications.requestPermission();
```

Puter's permission dialog opens. When the user allows it, Puter also turns pushes on in the browser they answered in, and your notifications go out as pushes from then on. For a user who already allowed your app, in a browser where pushes aren't on yet, [`enablePush()`](/Notifications/enablePush/) shows a one-button dialog that turns them on. [`hasPermission()`](/Notifications/hasPermission/) says whether the user allowed your app, without asking, so you can decide whether to show a button at all.

While the app is open, [`onPush()`](/Notifications/onPush/) and [`onNotification()`](/Notifications/onNotification/) receive its notifications live, the same as on a website. Inside the desktop, the result of an [`onPush()`](/Notifications/onPush/) handler is never shown as a browser notification. Puter shows the notification itself.

## Good to know

- Say who did what. "Ana shared Q3-report.pdf" reads well as a push. A push that only says there's something new can be hidden as spam on Android.
- The `data` field is handed back on click, and push services can read it, so put IDs in it and fetch the rest. Set `sensitive: true` when the title and text shouldn't leave Puter.
- A push carries about 4 KB, with `data` at most 1 KB.
- A tap opens your domain. The `url` a handler returns has to be on your origin, and other origins are replaced with your site's root.
- Pushes from your app count toward the user's usage. See [What pushes cost](/rate-limits-and-quotas/#what-pushes-cost). Puter's own notifications are free.
