---
title: puter.notifications.on('click')
description: React when the user clicks one of your app's push notifications.
platforms: [websites, apps]
---

Calls `handler` when the user clicks one of your app's notifications, so you can open the screen it's about.

Clicks reach your app in two ways:

- **On a website**, from a tap on a push, or on a notification a page of your site showed itself. When a page of your site is open, the tap focuses it and calls its `click` handlers. A page without a `click` handler goes to the notification's `url` instead, which is the `url` your [`onPush()`](/Notifications/onPush/) handler returned, or else the notification's `target`. When no page is open, the tap opens that `url`, and the new page's first `click` handler gets the click.
- **Inside the Puter desktop**, from a tap on a push that Puter shows. Puter opens your app, or brings it to the front, and delivers the click.

A click that arrives before your first `click` handler is added, such as the one that opened your app, goes to that first handler, once. Handlers added after it don't get it, so add your handler early during startup.

To remove a handler, call [`puter.notifications.off('click', handler)`](/Notifications/on/).

## Syntax
```js
puter.notifications.on('click', handler)
puter.notifications.off('click', handler)
```

## Parameters

#### `handler` (Function) (required)
Called with:

- `uid` (String): The notification's id.
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
