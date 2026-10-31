---
title: puter.notifications.onPush()
description: Handle your app's notifications for one channel, in the page while it's open and in your service worker when a push arrives.
platforms: [websites, apps]
---

Handles the notifications your app sends with `channel: key` in [`notify()`](/Notifications/notify/). While a page of your app is open with this handler, the handler runs in the page as each one arrives. On a website, it also runs in your service worker when a push arrives, and what it returns decides what the push shows.

A page with a handler tells Puter that it received each notification, before your handler runs. When the page is visible and focused, nothing is pushed. When it's hidden or its window isn't focused, a page of your website shows the notification itself, unless another window of your site is focused. It shows the handler's result, or the notification's own title and text when no handler matches the notification's `channel`. It does this only after the user turned pushes on in this browser with [`enable()`](/Notifications/enable/). Inside the Puter desktop, the page doesn't show it, and it goes out as a push through Puter instead. [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed) has the full rule.

The user turns pushes on once per browser with [`enable()`](/Notifications/enable/). After that, each page load's [`onPush()`](/Notifications/onPush/) call keeps this browser's subscription current without asking again. Different keys share that one subscription. After [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/), page loads don't subscribe again until your page calls [`enable()`](/Notifications/enable/) from a click.

On a website with nobody signed in, the handler starts receiving notifications once the user signs in. [`onPush()`](/Notifications/onPush/) doesn't open the sign-in itself.

## The service worker

On a website, pushes arrive on your own origin through a service worker that loads Puter's push script. By default it's `/puter-sw.js`, with this line:

```js
importScripts('https://js.puter.com/push-sw.js');
```

To use another worker, such as one your site already has, pass its path as `serviceWorker`, and pass the same path to [`enable()`](/Notifications/enable/), [`disable()`](/Notifications/disable/) and [`status()`](/Notifications/status/). [Push notifications for your app](/Notifications/push/#1-serve-the-service-worker) has the setup and the rules the worker follows. Inside the Puter desktop, pushes go through Puter and no worker is needed.

## Syntax
```js
puter.notifications.onPush(key, handler)
puter.notifications.onPush(key, handler, options)
```

## Parameters

#### `key` (String) (required)
The `channel` your notifications are sent with. 1 to 32 lowercase letters, digits or `-`.

#### `handler` (Function) (required)
A plain `function` or an arrow function. It's called with the notification, in the same shape [`onNotification()`](/Notifications/onNotification/) delivers. It may return, or resolve to, an object that changes what the browser shows:

- `title`, `body`, `icon`, `badge`, `image`, `tag` (String): As in the browser's `showNotification()`. A notification sent with a `group` gets a `tag` from it by default, so a later one in the group replaces it on screen.
- `url` (String): A path or URL on your origin, resolved against your worker's scope. Defaults to the notification's `target`. A URL on another origin is replaced with your worker's scope. When no page of your site is open, a tap opens it. When a page is open, the tap focuses that page and goes to [`on('click')`](/Notifications/on/). A page without a `click` handler goes to `url` instead.

Returning nothing shows the notification's own `title` and `text`. Inside the Puter desktop, the result isn't used, and a push shows the notification's own title and text.

A [sensitive](/Notifications/notify/#parameters) notification shows only your app's name, whatever the handler returns. Its push carries no `channel`, so no handler runs for it in the worker.

#### `options` (Object) (optional)
- `serviceWorker` (String): The path of the worker that imports `push-sw.js`. Defaults to `/puter-sw.js`.
- `onError` (Function): Called with `{ message, code }` when the handler throws in the page or runs past 5 seconds there (`push_handler_timeout`), when the live listener stops, when keeping the subscription current fails, or when the confirmation push after [`enable()`](/Notifications/enable/) doesn't arrive within 30 seconds (`push_verification_timeout`). When the handler fails, the notification shows its own title and text. Errors that [`enable()`](/Notifications/enable/) rejects with, such as `push_unavailable`, `push_disabled`, `push_revoked` and `too_many_requests`, aren't reported here. Without `onError`, errors go to the console.

## Handler limits

On a website, the handler is saved as source in this browser and run again in your service worker when a push arrives. A browser that hasn't run [`onPush()`](/Notifications/onPush/) for a key shows that key's pushes with the notification's own title and text. In the worker, the handler follows these rules:

- **Plain function.** It's re-created from its source, so it has to be a plain `function` or an arrow function. [`onPush()`](/Notifications/onPush/) refuses a method shorthand, a bound function or a class method with `invalid_handler`. On a page whose Content-Security-Policy blocks `eval`, it can't check and takes the handler as written.
- **Self-contained.** It can't use variables, functions or imports from around it. Everything it needs comes from its argument or is written inside it.
- **No page.** It runs in a service worker, with no `window`, `document` or `localStorage`. It can use `fetch`, `indexedDB` and `caches`.
- **Fast.** It has 5 seconds. After that, or if it throws, the push shows the notification's own title and text.
- **Something always shows.** Browsers show a notification for every push, so a handler can change what shows but can't hide it.
- **Small input.** A push carries about 4 KB, with `data` at most 1 KB. Put IDs in `data` and fetch the rest.
- **`eval`.** It's re-created with `new Function`, so a Content-Security-Policy on your worker has to allow `'unsafe-eval'`.
- **Errors.** An error it throws in the worker shows only in the service worker's console, not the page's.

A handler that needs more, such as imported code, can be registered in the worker itself, where it takes priority over the saved one:

```js
importScripts('https://js.puter.com/push-sw.js', '/my-formatting.js');
puterPush.onPush('chat', (n) => ({ title: formatTitle(n) }));
```

## Return value
A `Promise` that resolves to `{ off }`. Calling `off()` stops the handler in this page. When no other handler for `key` is left in the page, it also removes the saved one.

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
