---
title: puter.notifications.onPush()
description: Handle your app's notifications for one key, live while the app is open and as browser pushes while it isn't.
platforms: [websites, apps]
---

Handles the notifications your app sends with `channel: key` in [`notify()`](/Notifications/notify/). While a page of your app is open with this handler, the handler runs in the page as each one arrives, and that notification isn't pushed. When no page of your app receives a notification within 5 seconds, for example because the app is closed or the browser put the page to sleep, Puter sends a browser push instead, and the handler runs in your site's service worker to decide what the notification shows.

Puter picks the route. A page tells Puter on its own when it receives a notification, before your handler runs. The user turns pushes on once with [`enable()`](/Notifications/enable/); after that, `onPush()` keeps this browser's subscription current on every page load without asking again. Different keys share that one permission.

On a website, pushes reach your own origin, so your site has to serve a service worker that loads Puter's push script. Put this in `/puter-sw.js` at the root of your site:

```js
importScripts('https://js.puter.com/push-sw.js');
```

If your site already has a service worker, add that line to it instead and pass its path as `serviceWorker`. Inside the Puter desktop, pushes go through Puter itself and no worker is needed.

## Syntax
```js
puter.notifications.onPush(key, handler)
puter.notifications.onPush(key, handler, options)
```

## Parameters

#### `key` (String) (required)
The `channel` your notifications are sent with: 1 to 32 lowercase letters, digits or `-`.

#### `handler` (Function) (required)
Called with the notification (the same shape [`onNotification()`](/Notifications/onNotification/) delivers). It may return, or resolve to, an object that changes what the browser shows:

- `title`, `body`, `icon`, `badge`, `image`, `tag`: strings, as in the browser's `showNotification()`.
- `url`: a path or URL on your origin, opened when the notification is tapped. Defaults to the notification's `target`. Other origins are replaced with your site's root.

Returning nothing shows the notification's own `title` and `text`. In the page, the result is only shown when the tab is hidden or its window isn't focused. Inside the Puter desktop, the desktop shows the notification itself and the result isn't used.

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker that imports `push-sw.js`. Default `/puter-sw.js`.
- `onError` (Function): called when the handler throws, the live listener stops, or keeping the subscription current fails. Without it, errors go to the console. A server without a push service (`push_unavailable`) and an app the user turned off in Puter (`push_revoked`) are not reported here, since [`enable()`](/Notifications/enable/) rejects with them when called.

## Handler limits

On a website, the handler is saved as source and run again in your service worker when a push arrives with no page open. There it follows the Web Push rules:

- **Self-contained.** It is re-created from its source, so it can't use variables, functions or imports from around it. Everything it needs must come from its argument or be written inside it.
- **No page.** It runs in a service worker: no `window`, `document` or `localStorage`. `fetch`, `indexedDB` and `caches` are available.
- **Fast.** It has 5 seconds. After that, or if it throws, the notification shows with its own title and text.
- **Something always shows.** Browsers require every push to show a notification, so a handler can change what shows but can't hide it.
- **Small.** A push carries about 4 KB, and `data` at most 1 KB. Send IDs and fetch the rest if you need it.
- **`eval`.** It is re-created with `new Function`, so if your worker is served with a Content-Security-Policy it must allow `'unsafe-eval'`.

A handler that needs more, such as imported code, can be registered in the worker itself, where it wins over the saved one:

```js
importScripts('https://js.puter.com/push-sw.js', '/my-formatting.js');
puterPush.onPush('chat', (n) => ({ title: formatTitle(n) }));
```

## Return value
A `Promise` that resolves to `{ off }`. `off()` stops the handler in this page and, when no other handler for `key` is left, removes the saved one.

## Examples

<strong class="example-title">Chat messages</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="enable">Turn on notifications</button>
    <script>
        puter.notifications.onPush('chat', (n) => ({
            title: `${n.app?.name ?? 'Chat'}: ${n.title}`,
            url: n.target ?? '/',
        }));

        document.getElementById('enable').addEventListener('click', async () => {
            const on = await puter.notifications.enable();
            puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
        });
    </script>
</body>
</html>
```
