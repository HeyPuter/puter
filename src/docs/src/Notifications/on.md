---
title: puter.notifications.on()
description: React when a notification is clicked or dismissed.
platforms: [websites, apps]
---

Calls `handler` when one of your app's notifications is clicked or dismissed.

For `click`, the handler can open the screen the notification is about.

Clicks reach your app in two ways:

- **On a website**, from a tap on a push, or on a notification a page of your site showed itself. When a page of your site is open, the tap focuses it and calls its `click` handlers. A page without a `click` handler goes to the notification's `url` instead, which is the `url` your [`onPush()`](/Notifications/onPush/) handler returned, or else the notification's `target`. When no page is open, the tap opens that `url`, and the new page's first `click` handler gets the click.
- **Inside the Puter desktop**, from a tap on a push that Puter shows. Puter opens your app, or brings it to the front, and delivers the click.

A click that arrives before your first `click` handler is added, such as the one that opened your app, goes to that first handler, once. Handlers added after it don't get it, so add your handler early during startup. On a website, a page a tap opened drops the click when no `click` handler is added within 10 seconds of the page loading.

For `dismiss`, the handler receives `{ uid }` when a notification is dismissed on any connected page or device, including through [`dismiss()`](/Notifications/dismiss/) on this page. Registering this event starts the app's live notification feed and needs [Events](/Events/) enabled. On a website with nobody signed in, it waits for sign-in. The SDK also closes the matching browser notification. Startup and reconnect checks close notifications already dismissed without calling the handler.

To remove a handler, call [`puter.notifications.off(eventName, handler)`](/Notifications/on/).

## Syntax
```js
puter.notifications.on('click', handler)
puter.notifications.on('dismiss', handler)
puter.notifications.off('click', handler)
puter.notifications.off('dismiss', handler)
```

## Parameters

#### `eventName` (String) (required)
Either `click` or `dismiss`.

#### `handler` (Function) (required)
For `dismiss`, called with `uid` (String), the dismissed notification's id.

For `click`, called with:

- `uid` (String): The notification's id.
- `action` (String | null): The id of the button the user pressed, from the `actions` returned by [`onPush()`](/Notifications/onPush/). A tap on the notification body gives `null`, including in browsers that show no buttons. Pressing a button opens or focuses your page before the handler acts on it.
- `target` (String | null): The `target` the notification was sent with. On a website, it's `null` for a tap on a [sensitive](/Notifications/notify/#parameters) notification.
- `data` (any): The `data` it was sent with, or `null`. On a website, it's also `null` for a tap on a sensitive notification.

## Return value
It returns `puter.notifications`, so calls can be chained.

## Examples

<strong class="example-title">Route a click to the right screen</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.notifications.on('click', ({ target, data }) => {
            if ( target?.startsWith('/chats/') ) {
                puter.print(`Opening chat ${data?.chatId}<br>`);
            }
        });
    </script>
</body>
</html>
```

<strong class="example-title">Remove a dismissed notification from your app</strong>

```js
puter.notifications.on('dismiss', ({ uid }) => {
    document.querySelector(`[data-notification-id="${CSS.escape(uid)}"]`)?.remove();
});
```
