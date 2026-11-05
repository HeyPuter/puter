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

For `dismiss`, the handler runs when one of your app's notifications is dismissed with [`dismiss()`](/Notifications/dismiss/), on this page or on any page of your app on any of the user's devices. Use it to remove the notification from your app's own list. Adding a `dismiss` handler starts a live notification listener, which closes the dismissed notification on this device as [Closing it on other devices](/Notifications/dismiss/#closing-it-on-other-devices) describes. On a website with nobody signed in, the handler starts once the user signs in.

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
For `click`, called with an object with:

- `uid` (String): The notification's id.
- `action` (String | null): The id of the button the user pressed, from the `actions` your [`onPush()`](/Notifications/onPush/) handler returned. It's `null` for a tap on the notification body, which is all a browser without buttons offers.
- `target` (String | null): The `target` the notification was sent with. On a website, it's `null` for a tap on a [sensitive](/Notifications/notify/#parameters) notification.
- `data` (any): The `data` it was sent with, or `null`. On a website, it's also `null` for a tap on a sensitive notification.

For `dismiss`, called with an object with:

- `uid` (String): The dismissed notification's id.

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

<strong class="example-title">Handle a button press</strong>

```js
puter.notifications.on('click', async ({ uid, action, data }) => {
    if (action === 'accept') await puter.kv.set(`rsvp:${data.eventId}`, 'yes');
    await puter.notifications.dismiss(uid);
});
```

[Add Buttons to Push Notifications](/recipes/add-buttons-to-push-notifications/) shows the whole setup.

<strong class="example-title">Remove a dismissed notification from your app</strong>

```js
puter.notifications.on('dismiss', ({ uid }) => {
    document.querySelector(`[data-notification-id="${CSS.escape(uid)}"]`)?.remove();
});
```
