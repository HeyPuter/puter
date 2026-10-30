---
title: puter.notifications.on('click')
description: React when the user clicks one of your app's notifications, in the Puter notifications panel or on a push.
platforms: [websites, apps]
---

Calls `handler` when the user clicks one of your app's notifications, in the Puter notifications panel or on a push notification. Use it to open the screen the notification is about.

Clicks reach your app in two ways:

- **On a website**, from a tap on a push or on a notification a page of your site showed itself. When a page of your site is open, the tap focuses it and calls its `click` handlers. A page without a `click` handler goes to the notification's `url` instead, which is the `url` your [`onPush()`](/Notifications/onPush/) handler returned or else the notification's `target`. When no page is open, the tap opens that `url`, and the new page's first `click` handler gets the click.
- **Inside the Puter desktop**, from a click in the Puter notifications panel or on a push. Puter opens your app and delivers the click.

If your app is open with a `click` handler, the click is delivered right away. A click that arrives before your first `click` handler is added, such as the one that opened your app, is delivered to that first handler, once. Handlers added after it don't receive it. Add your handler early during startup.

Remove a handler with `puter.notifications.off('click', handler)`.

## Syntax
```js
puter.notifications.on('click', handler)
puter.notifications.off('click', handler)
```

## Parameters

#### `handler` (Function) (required)
Called with:

- `uid` (String): The notification's id.
- `target` (String | null): The `target` the notification was sent with. It's `null` for a tap on a [sensitive](/Notifications/notify/#parameters) push.
- `data` (any): The `data` it was sent with, or `null`. It's also `null` for a tap on a sensitive push.

## Return value
`puter.notifications`, so calls can be chained.

## Examples

<strong class="example-title">Route a click to the right screen</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.notifications.on('click', ({ target, data }) => {
            if ( target?.startsWith('/chats/') ) {
                puter.print(`opening chat ${data?.chatId}<br>`);
            }
        });
    </script>
</body>
</html>
```
