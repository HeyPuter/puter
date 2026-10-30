---
title: puter.notifications.on('click')
description: React when the user clicks one of your app's notifications, in the Puter notifications panel or on a push.
platforms: [websites, apps]
---

Calls `handler` when the user clicks one of your app's notifications, in the Puter notifications panel or on a push notification. Use it to open the screen the notification is about.

On a website, a tap on a push from [`onPush()`](/Notifications/onPush/) focuses an open tab of your site, or opens the push's `url`, and delivers the click there. Inside the Puter desktop, a click on one of your notifications opens your app and delivers it. If your app is open with a `click` handler, the click is delivered right away. A click that arrives before your first `click` handler is added (for example, the one that launched your app) is delivered to that first handler, once; handlers added after it don't receive it. Add your handler early during startup.

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
- `target` (String | null): The `target` the notification was sent with.
- `data` (any): The `data` it was sent with, or `null`.

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
