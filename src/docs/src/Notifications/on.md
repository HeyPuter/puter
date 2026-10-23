---
title: puter.notifications.on('click')
description: React when the user clicks one of your app's notifications, in the Puter notifications panel or on a push.
platforms: [websites, apps]
---

Calls `handler` when the user clicks one of your app's notifications, in the Puter notifications panel or on a push notification. Use it to open the screen the notification is about.

If your app was open, the click is delivered right away. If the click launched your app, it's delivered once, to the first `click` handler you add, so add it early during startup.

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
