---
title: puter.notifications.onPush()
description: Handle your app's notifications for one key, in the page while it's open and in your service worker when a push arrives.
platforms: [websites, apps]
---

Handles the notifications your app sends with `channel: key` in [`notify()`](/Notifications/notify/). While a page of your app is open with this handler, the handler runs in the page as each one arrives. When a push arrives, the handler runs in your site's service worker to decide what the push shows.

A page with a handler tells Puter when it receives a notification, before your handler runs. When the page is visible and focused, nothing is pushed. When it's hidden or its window isn't focused, the page shows the notification itself, unless another tab of your site is focused. It shows the handler's result, or the notification's own title and text when no handler matches the notification's `channel`. Showing it needs the browser's notification permission, which [`enable()`](/Notifications/enable/) asks for. Otherwise, when no page answers within 5 seconds that it's visible and focused or that it shows the notification itself, Puter sends a push. [Push notifications for your app](/Notifications/push/#when-a-notification-is-pushed) has the full rule.

The user turns pushes on once with [`enable()`](/Notifications/enable/). After that, each page load's [`onPush()`](/Notifications/onPush/) call keeps this browser's subscription current without asking again. Different keys share that one permission. After [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/), page loads don't subscribe again until your page calls [`enable()`](/Notifications/enable/) from a click.

## The service worker

On a website, pushes reach your own origin, so your site has to serve a service worker that loads Puter's push script. Put this in `/puter-sw.js` at the root of your site:

```js
importScripts('https://js.puter.com/push-sw.js');
```

The worker has to be on your origin and served over HTTPS.

- If your site already has a service worker for that scope, add that line to it instead and pass its path as `serviceWorker`. A second worker for the same scope makes [`enable()`](/Notifications/enable/) reject with `push_worker_conflict`.
- If that worker already gets pushes from another service, such as Firebase or OneSignal, give Puter its own worker in a folder, such as `/puter/puter-sw.js`, and pass that path as `serviceWorker`.
- If the worker is served with a Content-Security-Policy, its `script-src` has to allow `https://js.puter.com` and `'unsafe-eval'`.
- A changed worker only runs once it activates. Call `self.skipWaiting()` in it, or close every tab of your site.

[Push notifications for your app](/Notifications/push/#requirements) has the full setup and the browsers that can receive pushes. Inside the Puter desktop, pushes go through Puter itself and no worker is needed.

## Syntax
```js
puter.notifications.onPush(key, handler)
puter.notifications.onPush(key, handler, options)
```

## Parameters

#### `key` (String) (required)
The `channel` your notifications are sent with: 1 to 32 lowercase letters, digits or `-`.

#### `handler` (Function) (required)
A plain `function` or an arrow function. Called with the notification (the same shape [`onNotification()`](/Notifications/onNotification/) delivers). It may return, or resolve to, an object that changes what the browser shows:

- `title`, `body`, `icon`, `badge`, `image`, `tag`: strings, as in the browser's `showNotification()`.
- `url`: a path or URL on your origin, resolved against your worker's scope. Defaults to the notification's `target`. Other origins are replaced with your site's root. When no page of your site is open, a tap opens it. When a page is open, the tap focuses that page and goes to [`on('click')`](/Notifications/on/). A page without a `click` handler goes to `url` instead.

Returning nothing shows the notification's own `title` and `text`. Inside the Puter desktop, Puter shows the notification itself, and the result is never shown as a browser notification.

A [sensitive](/Notifications/notify/#parameters) push carries no `channel`, so no handler runs for it. It shows a generic line, and a tap opens `/`.

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker that imports `push-sw.js`. Default `/puter-sw.js`.
- `onError` (Function): called when the handler throws in the page or runs past 5 seconds there (`push_handler_timeout`, and the notification's own title and text show instead), the live listener stops, or keeping the subscription current fails. Without it, errors go to the console. A server without a push service (`push_unavailable`) and an app the user turned off in Puter (`push_revoked`) are not reported here, since [`enable()`](/Notifications/enable/) rejects with them when called.

## Handler limits

On a website, the handler is saved as source in this browser and run again in your service worker when a push arrives. A browser that hasn't run `onPush()` for a key shows that key's pushes with the notification's own title and text. There it follows the Web Push rules:

- **Plain function.** It's re-created from `handler.toString()`, so it has to be a plain `function` or an arrow function. A method shorthand, a bound function or a class method is refused with `invalid_handler`.
- **Self-contained.** It can't use variables, functions or imports from around it. Everything it needs must come from its argument or be written inside it.
- **No page.** It runs in a service worker, with no `window`, `document` or `localStorage`. It can use `fetch`, `indexedDB` and `caches`.
- **Fast.** It has 5 seconds. After that, or if it throws, the notification shows with its own title and text.
- **Something always shows.** Browsers require every push to show a notification, so a handler can change what shows but can't hide it.
- **Small.** A push carries about 4 KB, and `data` at most 1 KB. Send IDs and fetch the rest if you need it.
- **`eval`.** It's re-created with `new Function`, so if your worker is served with a Content-Security-Policy it must allow `'unsafe-eval'`.
- **Errors.** An error it throws in the worker shows only in the service worker's console, not the page's.

A handler that needs more, such as imported code, can be registered in the worker itself, where it wins over the saved one:

```js
importScripts('https://js.puter.com/push-sw.js', '/my-formatting.js');
puterPush.onPush('chat', (n) => ({ title: formatTitle(n) }));
```

## Return value
A `Promise` that resolves to `{ off }`. Calling `off()` stops the handler in this page and, when no other handler for `key` is left, removes the saved one.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `key` isn't 1 to 32 lowercase letters, digits or `-`. |
| `invalid_handler` | `handler` isn't a plain function or an arrow function, for example a method shorthand, a bound function or a class method. |

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
            try {
                const on = await puter.notifications.enable();
                puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
            } catch (error) {
                puter.print(`Could not turn on notifications: ${error.code}<br>`);
            }
        });
    </script>
</body>
</html>
```
