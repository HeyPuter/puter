---
title: Push notifications for your app
description: Set up push notifications for a website on its own domain or an app inside the Puter desktop, and see which browsers and devices can receive them.
platforms: [websites, apps]
---

A push notification reaches the user when they aren't looking at your app. It shows on their phone or computer, and a tap opens your app. Your app sends it with [`notify()`](/Notifications/notify/), the same call that delivers a notification to your app while it's open, and Puter decides whether it also goes out as a push.

A website on its own domain needs three steps, and an app inside the Puter desktop needs one. [Where pushes work](#where-pushes-work) lists what each browser and device needs.

## When a notification is pushed

Every open page of your app gets each notification live, on any of the user's devices, through [`onNotification()`](/Notifications/onNotification/) and [`onPush()`](/Notifications/onPush/). Puter then asks those pages whether they received it. If a page answers within 5 seconds that it's visible and focused, or that it shows the notification itself, nothing is pushed. Otherwise Puter pushes it. A page answers only while it has an [`onNotification()`](/Notifications/onNotification/) or [`onPush()`](/Notifications/onPush/) listener.

A page of your website shows the notification itself when all of these are true:

- The page is hidden, or its window isn't focused.
- It has an [`onPush()`](/Notifications/onPush/) handler.
- The user turned pushes on in this browser with [`enable()`](/Notifications/enable/), and hasn't turned them off with [`disable()`](/Notifications/disable/).
- The user allowed notifications for your site in this browser.
- No other window of your site is focused.

It shows what the handler returns, or the notification's own title and text when no handler matches the notification's `channel`. Inside the Puter desktop, a page doesn't show notifications itself, so a notification goes out as a push whenever your app's window isn't focused.

So a push goes out when no page of your app is open, or when the open pages are in the background and can't show the notification themselves. A page that loads an older version of Puter.js, such as one bundled from npm, holds the push back while it's visible. A page with a version from before Puter asked pages whether they received a notification holds it back whenever it's open.

## Where a push goes

A push goes to the browsers where the user turned pushes on for your website with [`enable()`](/Notifications/enable/). It shows under your domain, through your service worker.

When there's no such browser, and the user allowed your app in Puter's own prompt, the push goes to the browsers where Puter has pushes on instead. That's the case for an app inside the Puter desktop, and for a website that asked with [`requestPermission()`](/Notifications/requestPermission/) or [`enablePush()`](/Notifications/enablePush/). Puter shows these pushes with your app's name and icon, and a tap opens your app inside the Puter desktop.

The user also has to allow pushes from your app, and the [push limits](/rate-limits-and-quotas/#notifications) apply. Over a limit, the notification still reaches your app live and [`notify()`](/Notifications/notify/) still resolves.

## A website on its own domain

On a website, pushes arrive on your own domain through a small service worker, and the browser asks the user for permission on your domain.

### Requirements

- **HTTPS.** Browsers only allow service workers on `https://` pages, and on `http://localhost` for testing.
- **A worker on your own origin.** The worker file has to come from the same origin as your pages. A worker on a CDN or another subdomain can't be registered.
- **At the root of your site, by default.** [`enable()`](/Notifications/enable/) registers `/puter-sw.js`. A worker elsewhere, such as `/puter/puter-sw.js`, works when you pass its path as `serviceWorker`. A tap with no page open resolves relative URLs against the worker's folder.
- **Served as JavaScript.** The response needs a JavaScript `Content-Type`, such as `text/javascript`, and a `200` status. Browsers refuse a worker that comes back as `text/html` or through a redirect.

[Puter Hosting](/Hosting/) meets all of these when `puter-sw.js` is in the root of the folder you host. With a build tool, put the file in the folder it copies as is, such as `public/` in Vite or Next.js.

### 1. Serve the service worker

Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

The worker follows the browser's service worker rules:

- **One worker per scope.** If your site already has a service worker for that scope, add the `importScripts()` line to it and pass its path as `serviceWorker` to [`onPush()`](/Notifications/onPush/), [`enable()`](/Notifications/enable/), [`disable()`](/Notifications/disable/) and [`status()`](/Notifications/status/). Otherwise [`enable()`](/Notifications/enable/) rejects with `push_worker_conflict` and leaves your worker in place. Puter's script only adds event listeners and only handles pushes sent by Puter, so your worker's own install, fetch and push handling keep working.
- **One push subscription per worker.** If that worker already gets pushes from another service, such as Firebase or OneSignal, give Puter its own worker in a folder, such as `/puter/puter-sw.js`, and pass that path as `serviceWorker`. Otherwise [`enable()`](/Notifications/enable/) rejects with `push_subscription_conflict`.
- **Content-Security-Policy.** If the worker is served with a Content-Security-Policy, its `script-src` has to allow `https://js.puter.com` and `'unsafe-eval'`. The worker re-creates your handler from its source with `new Function`.
- **Updates.** A changed worker only runs once it activates. Call `self.skipWaiting()` in it, or close every tab of your site.
- **Errors.** An error your handler throws in the worker shows only in the service worker's console, not the page's. In Chrome, open it from DevTools under **Application** > **Service workers**.

To check the worker, open `https://<your site>/puter-sw.js` in a browser tab. It should show the `importScripts` line as plain text.

### 2. Say what a push shows

On every page load, register a handler with [`onPush()`](/Notifications/onPush/) for each kind of notification you send. The key is the `channel` you pass to [`notify()`](/Notifications/notify/).

```js
puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    url: n.target ?? '/',
}));
```

The handler runs in the page as each notification arrives, and in your service worker when a push arrives. The worker re-creates it from its source, so it has to be a plain `function` or an arrow function that uses only its argument and what's written inside it, and it has 5 seconds to return. [`onPush()`](/Notifications/onPush/#handler-limits) lists every limit and the fields a handler can return. Returning nothing shows the notification's own `title` and `text`.

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

The browser asks for permission on your domain. Puter then sends a confirmation push to that browser, which shows once as "Notifications are on", and pushes start once your worker hands it back, usually within seconds. Turning pushes on this way also allows pushes from your app, so the user answers only the browser's prompt.

The choice sticks. On later page loads, [`onPush()`](/Notifications/onPush/) keeps the registration current without asking again. To show your button only when it can help, call [`status()`](/Notifications/status/) on page load. It resolves `'off'` while [`enable()`](/Notifications/enable/) can turn pushes on.

[`enable()`](/Notifications/enable/) rejects with `push_revoked` when the user turned your app off in Puter's settings. That choice stands until the user allows your app again, so call [`requestPermission()`](/Notifications/requestPermission/) from a click, which opens Puter's permission prompt, and then call [`enable()`](/Notifications/enable/) again:

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

[`enable()`](/Notifications/enable/#return-value) lists every error it rejects with. When nobody is signed in, it opens the Puter sign-in after the browser's prompt. Sign the user in first, from its own button, so the sign-in window isn't blocked as a popup.

To turn pushes off in this browser again, call [`disable()`](/Notifications/disable/). Page loads don't turn pushes back on after [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/). Signing out also removes this browser's registration for your app.

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

The page you send from is usually open and focused. With an [`onPush()`](/Notifications/onPush/) or [`onNotification()`](/Notifications/onNotification/) listener, it gets the notification live and nothing is pushed. To reach the user while your app is closed, send from somewhere that keeps running:

- **A [Puter Worker](/Workers/)**, with [`user.puter.notifications.notify()`](/Notifications/notify/) in a route your page calls through [`puter.workers.exec()`](/Workers/exec/). It notifies the user who called the worker, from the app that called it.
- **An [events handler](/Events/handlers/)**, with [`user.notifications.notify()`](/Notifications/notify/). It notifies the user who holds the subscription, and it runs while your app is closed. Running a handler in the background needs the user's `events:background` permission, as [`onPersistent()`](/Events/onPersistent/) describes.

An app that notifies from an events handler needs the user to allow both background events and pushes. Ask for both with [`puter.perms.request()`](/Perms/request/#batching), so the user answers one prompt:

```js
const [background, pushes] = await puter.perms.request([
    { resource: 'backgroundEvents' },
    { resource: 'pushNotifications' },
]);
```

In a worker, `me.puter` is you, the worker's owner. A [`me.puter.notifications.notify()`](/Notifications/notify/) call notifies you, not the user who called the worker, and it rejects with `forbidden` when the worker doesn't run as an app.

To notify another user, share data with them with `notify: true` and send through the share's handle, as [`notify()`](/Notifications/notify/#notify-the-other-side-of-a-share) describes and [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/) shows. The push goes to the recipient's browsers and is billed to the recipient.

## When the user taps

On a website, a tap on a push, or on a notification a page of your site showed itself, focuses an open page of your site and calls its [`on('click')`](/Notifications/on/) handlers. With no page open, it opens the handler's `url`, or else the notification's `target`, and the new page's first [`on('click')`](/Notifications/on/) handler gets the click. Inside the Puter desktop, a tap opens your app and hands the click to [`on('click')`](/Notifications/on/).

## Groups and sensitive notifications

A notification with a `group` replaces your earlier one in the same group, on the device and in your app, and alerts the user again. A group can name a chat, a thread or a person, such as `dm:ana@example.com`. [`notify()`](/Notifications/notify/#groups) has the rule.

With `sensitive: true`, pushes and the notification a page shows itself name only your app instead of showing the title and text. [`onNotification()`](/Notifications/onNotification/) still gets the whole notification. [`notify()`](/Notifications/notify/#parameters) says what else a sensitive push leaves out.

## A minimal page

To try it, serve the page below from a site that has `/puter-sw.js`. It registers the handler, turns pushes on from a click, and sends a notification 5 seconds after you click Send. Switch to another tab during those 5 seconds. The page is then in the background, so it shows the notification itself and nothing is pushed.

A real push goes out only when no page of your site can show the notification. To see one, turn pushes on, close every tab of your site, and send from somewhere else, such as a [Puter Worker](/Workers/) that runs as your app or an [events handler](/Events/handlers/).

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

An app inside the Puter desktop needs no worker. Pushes go through Puter, which shows them with your app's name and icon. Ask once, from a click:

```js
const on = await puter.notifications.enable();
```

When your app doesn't hold the permission yet, Puter's permission dialog opens. When the user allows it, Puter also turns pushes on in the browser they answered in, and your notifications go out as pushes from then on. For a user who already allowed your app, in a browser where pushes aren't on yet, it shows a one-button dialog that turns them on. Inside the desktop, [`enable()`](/Notifications/enable/) is the same call as [`enablePush()`](/Notifications/enablePush/). To ask for the permission alone, call [`requestPermission()`](/Notifications/requestPermission/). [`hasPermission()`](/Notifications/hasPermission/) says whether the user allowed your app, and [`status()`](/Notifications/status/) whether pushes reach this browser, both without asking.

To turn pushes off, call [`disable()`](/Notifications/disable/). Inside the desktop it removes your app's permission, so pushes stop on every device of the user, and a later [`enable()`](/Notifications/enable/) asks again.

While the app is open, [`onPush()`](/Notifications/onPush/) and [`onNotification()`](/Notifications/onNotification/) receive its notifications live, the same as on a website. The result of an [`onPush()`](/Notifications/onPush/) handler isn't used inside the desktop.

## Where pushes work

Pushes use the browser's Web Push support. Each browser gets its own registration, so a user who wants pushes on their phone and their laptop turns them on in both.

| Device | Browsers | What the user needs |
| --- | --- | --- |
| Windows, macOS, Linux | Chrome, Edge, Firefox, Opera | Nothing extra. Works in a normal tab. |
| macOS 13 or later | Safari 16.1 or later | Nothing extra. Works in a normal tab. |
| Android | Chrome, Edge, Firefox, Samsung Internet | Nothing extra. Works in a normal tab. |
| iPhone and iPad, iOS 16.4 or later | Any | Add your site to the Home Screen and turn pushes on from there. See [iPhone and iPad](#iphone-and-ipad). |

Brave needs **Use Google services for push messaging** turned on in `brave://settings/privacy`. Private and incognito windows can't receive pushes, and [`enable()`](/Notifications/enable/) resolves `false` in them.

On a computer, the browser has to be running to receive a push. It doesn't need a tab of your site open. A push sent while the browser is closed or the device is offline waits for up to the notification's `ttl` (1 hour by default) and shows when the browser comes back.

### iPhone and iPad

On iOS and iPadOS, a website can only receive pushes once it's added to the Home Screen and opened from there. This applies to every browser on the device. Your site needs a web app manifest that opens it as a standalone app. Link it from your pages:

```html
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon.png">
```

The manifest, at `/manifest.json`:

```json
{
    "name": "Chat",
    "short_name": "Chat",
    "start_url": "/",
    "display": "standalone",
    "icons": [{ "src": "/icon.png", "sizes": "192x192", "type": "image/png" }]
}
```

The user then does this once:

1. Open your site in Safari, tap **Share**, and tap **Add to Home Screen**.
2. Open your app from its new Home Screen icon.
3. Sign in to Puter, and tap your "Turn on notifications" button, which calls [`enable()`](/Notifications/enable/).

The Home Screen app keeps its own storage, apart from Safari, so the user may have to sign in again there. Pushes then show like any other app's, and the user manages them in **Settings → Notifications →** your app's name.

To show the right instructions, check whether the page runs as a Home Screen app:

```js
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isHomeScreenApp = navigator.standalone === true
    || matchMedia('(display-mode: standalone)').matches;

if (isIOS && !isHomeScreenApp) {
    showAddToHomeScreenHelp();
}
```

### Operating system settings

The browser can be allowed to show notifications while the operating system hides them. When [`enable()`](/Notifications/enable/) resolves `true` and nothing shows, check these:

- **macOS.** **System Settings → Notifications →** the browser, with **Allow notifications** on. macOS asks the first time a browser shows a notification. A Focus mode keeps banners off the screen, and they still collect in Notification Center.
- **Windows.** **Settings → System → Notifications**, with notifications on for the browser. **Do not disturb** holds them back.
- **iPhone and iPad.** **Settings → Notifications →** your Home Screen app. A Focus mode can silence it.
- **Android.** **Settings → Apps →** the browser **→ Notifications**. Each site has its own category there, which the user can turn off by itself.

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| [`enable()`](/Notifications/enable/) resolves `false` | The user blocked notifications for your site, the page is in a private window, the browser has no Web Push, or on iOS the page isn't opened from the Home Screen. The user unblocks your site in the browser's site settings. |
| It rejects with `push_worker_unavailable` | `/puter-sw.js` isn't on your origin, returns a `404`, isn't served as JavaScript, is redirected, or throws when it loads. Open its URL in a tab to check. |
| It rejects with `push_subscribe_failed` | The browser couldn't reach its push service. In Brave, turn on Google services for push messaging. |
| It rejects with `push_revoked` | The user turned your app off in Puter's settings. Call [`requestPermission()`](/Notifications/requestPermission/) from a click first. |
| The `onError` of [`onPush()`](/Notifications/onPush/) gets `push_verification_timeout` | The worker doesn't import `push-sw.js`, or the confirmation push didn't arrive within 30 seconds. The next page load tries again. |
| A push shows the plain title and text, not your handler's result | This browser hasn't run [`onPush()`](/Notifications/onPush/) for that `channel` yet, or the handler threw, took over 5 seconds, or used an outside variable. Check the worker's console. |
| No push while your site is open in a tab | The open page received the notification live. It shows one only when it's hidden or its window isn't focused. |
| No push at all | The browser isn't running, the operating system hides its notifications ([above](#operating-system-settings)), the user reached the [push limit](/rate-limits-and-quotas/#notifications) for your app, or the user has no usage credit left. |

## Good to know

- Say who did what. "Ana shared Q3-report.pdf" reads well as a push. A push that only says there's something new can be hidden as spam on Android.
- The `data` field is handed back on click, and push services can read it, so put IDs in it and fetch the rest. Set `sensitive: true` when the title and text shouldn't leave Puter.
- A push carries about 4 KB, with `data` at most 1 KB. A push that doesn't fit has its text shortened.
- A tap opens your domain. The `url` a handler returns has to be on your origin, and a tap on one from another origin opens your worker's folder instead.
- Pushes from your app are billed to the user who receives them. See [What pushes cost](/rate-limits-and-quotas/#what-pushes-cost). Puter's own notifications are free.
