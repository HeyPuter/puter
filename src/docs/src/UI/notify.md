---
title: puter.ui.notify()
description: Displays a desktop notification in Puter.
platforms: [apps]
---

Displays a desktop notification in Puter. Use this to surface app events without interrupting the user.

## Syntax
```js
puter.ui.notify(options)
```

## Parameters

#### `options` (optional)
An object that configures the notification.

- `title` (string): Title shown in the notification.
- `text` (string): Body text shown under the title.
- `icon` (string): Icon URL or Puter icon name (for example `bell.svg`).
- `round_icon` (boolean): If `true`, renders the icon as a circle. `roundIcon` is accepted as an alias.
- `uid` (string): Optional ID to associate with the notification.
- `value` (any): Optional value stored on the notification element.

## Return value
A `Promise` that resolves to the notification UID.

## Examples
```html
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
