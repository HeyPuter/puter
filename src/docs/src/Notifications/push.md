---
title: Push notifications for your app
description: Set up push notifications for a website on its own domain or an app inside the Puter desktop, and see which browsers and devices can receive them.
platforms: [websites, apps]
---

A push notification reaches the user when your app isn't open to receive a notification live. It shows on their phone or computer, and a tap opens your app. Your app sends it with [`notify()`](/Notifications/notify/), the same call that puts a notification in the user's Puter notifications panel.

Puter decides the route. A page of your app that receives the notification through [`onNotification()`](/Notifications/onNotification/) or [`onPush()`](/Notifications/onPush/) tells Puter so on its own, and the notification isn't pushed. When no page of your app receives it within 5 seconds, it goes out as a push.

This page is the setup. A website on its own domain needs three steps, and an app inside the Puter desktop needs one. [Where pushes work](#where-pushes-work) lists what each browser and device needs.

## A website on its own domain

On a website, pushes arrive on your own domain through a small service worker, and the browser asks the user for permission on your domain.

### Requirements

- **HTTPS.** Browsers only allow service workers on `https://` pages, and on `http://localhost` for testing.
- **A worker on your own origin.** The worker file has to come from the same origin as your pages. A worker on a CDN or another subdomain can't be registered.
- **At the root of your site.** A worker only covers pages under the folder it's served from. `/puter-sw.js` covers every page, and `/js/puter-sw.js` only covers pages under `/js/`.
- **Served as JavaScript.** The response needs a JavaScript `Content-Type`, such as `text/javascript`, and a `200` status. Browsers refuse a worker that comes back as `text/html` or through a redirect.
- **One worker per scope.** Registering a second worker at the same scope replaces the first. If your site already has a service worker, add Puter's line to that one.

[Puter Hosting](/Hosting/) meets all of these when `puter-sw.js` is in the root of the folder you host. With a build tool, put the file in the folder it copies as is, such as `public/` in Vite or Next.js.

### 1. Serve the service worker

Put this file at the root of your site, as `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

To use an existing service worker instead, add that line to it, and pass its path as `serviceWorker` to [`onPush()`](/Notifications/onPush/), [`enable()`](/Notifications/enable/) and [`disable()`](/Notifications/disable/). Puter's script only adds event listeners, so your worker's own install, fetch and push handling keep working. It only handles pushes sent by Puter.

If the worker is served with a Content-Security-Policy, the policy has to allow `'unsafe-eval'`, because the worker re-creates your handler from its source.

To check the worker, open `https://<your site>/puter-sw.js` in a browser tab. It should show the `importScripts` line as plain text.

### 2. Say what a push shows

On every page load, register a handler with [`onPush()`](/Notifications/onPush/) for each kind of notification you send. The key is the `channel` you pass to [`notify()`](/Notifications/notify/).

```js
puter.notifications.onPush('chat', (n) => ({
    title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
    url: n.target ?? '/',
}));
```

While your app is open, the handler runs in the page as each notification arrives. While it isn't, the same handler runs in your service worker to decide what the push shows. The handler is saved as source in the browser that ran [`onPush()`](/Notifications/onPush/), and run again in the worker, so it has these limits:

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

When nobody is signed in, [`enable()`](/Notifications/enable/) opens the Puter sign-in after the browser's prompt. Sign the user in first, from its own button, so the sign-in window isn't blocked as a popup.

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

[`notify()`](/Notifications/notify/) sends to the user your app runs for. It works from a page, from a [worker](/Workers/) as `user.puter.notifications.notify()`, and from an [events handler](/Events/handlers/) as `user.notifications.notify()`. To notify another user, have a handler that runs for them call it, as in [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/).

The notification reaches your app, not the Puter desktop's notifications panel. It goes out as a push only when no page of your app received it live within 5 seconds. A user gets at most 12 pushes a minute and 1,000 a day from each app, and fewer while the app is new. The other limits are on [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

When the user taps the push, the browser focuses an open tab of your site or opens the handler's `url`, and the page gets the tap through [`on('click')`](/Notifications/on/). Inside the Puter desktop, a tap on the push opens your app and hands the `target` and `data` back through [`on('click')`](/Notifications/on/) as well.

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

To see a push instead of a live notification, send one and then switch to another tab or window. A page that's open but hidden or unfocused shows the notification through your worker too.

## An app inside the Puter desktop

An app inside the Puter desktop needs no worker and no [`enable()`](/Notifications/enable/). Pushes go through Puter itself. Ask once, from a click:

```js
const allowed = await puter.notifications.requestPermission();
```

Puter's permission dialog opens. When the user allows it, Puter also turns pushes on in the browser they answered in, and your notifications go out as pushes from then on. For a user who already allowed your app, in a browser where pushes aren't on yet, [`enablePush()`](/Notifications/enablePush/) shows a one-button dialog that turns them on. [`hasPermission()`](/Notifications/hasPermission/) says whether the user allowed your app, without asking, so you can decide whether to show a button at all.

While the app is open, [`onPush()`](/Notifications/onPush/) and [`onNotification()`](/Notifications/onNotification/) receive its notifications live, the same as on a website.

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

The Home Screen app keeps its own storage, apart from Safari, so the user may have to sign in again there. Pushes then show like any other app's, and the user manages them in **Settings → Notifications → your app's name**.

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
| It rejects with `push_verification_timeout` | The worker doesn't import `push-sw.js`, or the confirmation push didn't arrive within 30 seconds. Reload the page and try again. |
| It rejects with an `AbortError` from the browser | The browser couldn't reach its push service. In Brave, turn on Google services for push messaging. |
| It rejects with `push_revoked` | The user turned your app off in Puter's settings. Call [`requestPermission()`](/Notifications/requestPermission/) from a click first. |
| A push shows the plain title and text, not your handler's result | This browser hasn't run [`onPush()`](/Notifications/onPush/) for that `channel` yet, or the handler threw, took over 5 seconds, or used an outside variable. Check the worker's console. |
| No push while your site is open in a tab | The open page received the notification live. It shows one only when it's hidden or its window isn't focused. |
| No push at all | The browser isn't running, the operating system hides its notifications ([above](#operating-system-settings)), or the user reached the [push limit](/rate-limits-and-quotas/#notifications) for your app. |

## Good to know

- Say who did what. "Ana shared Q3-report.pdf" reads well as a push. A push that only says there's something new can be hidden as spam on Android.
- The `data` field is handed back on click, and push services can read it, so put IDs in it and fetch the rest. Set `sensitive: true` when the title and text shouldn't leave Puter. The push then shows a generic line, and your app still gets the notification in full.
- A push carries about 4 KB, with `data` at most 1 KB.
- A tap opens your domain. The `url` a handler returns has to be on your origin, and other origins are replaced with your site's root.
- Pushes from your app count toward the user's usage. See [What pushes cost](/rate-limits-and-quotas/#what-pushes-cost). Puter's own notifications are free.
