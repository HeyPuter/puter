---
title: puter.ui.notify()
description: Displays a desktop notification in Puter.
platforms: [ websites, apps]
---

Displays a notification.

Use it to tell the user about an event without interrupting them.

## Syntax
```js
puter.ui.notify(options)
```

## Parameters

#### `options` (optional)
An object that configures the notification.

| Option | Type | Description |
|--------|------|-------------|
| `title` | `String` | Title shown in the notification. |
| `text` | `String` | Body text shown under the title. |
| `icon` | `String` | Icon URL or Puter icon name (for example `bell.svg`). |
| `type` | `String` | Visual style used to pick a default icon and accent color when no `icon` is provided. One of `info`, `success`, `warning`, `error`, or `default`. |
| `duration` | `Number` | Time in milliseconds before the notification auto-dismisses. Defaults to `5000`. Set it to `0` to keep the notification until it's dismissed. |
| `round_icon` | `Boolean` | If `true`, renders the icon as a circle. The `roundIcon` option is accepted as an alias. |
| `uid` | `String` | Optional ID to associate with the notification. |
| `value` | `Any` | Optional value stored on the notification element. |

## Return value
A `Promise` that resolves to the notification UID.

## Examples
### Show a notification

```html;ui-notify
<script src="https://js.puter.com/v2/"></script>
<script>
  puter.ui.notify({
    title: 'Build finished',
    text: 'Your export is ready.',
    icon: 'bell.svg',
  }).then((uid) => {
    console.log('Notification UID:', uid);
  });
</script>
```
