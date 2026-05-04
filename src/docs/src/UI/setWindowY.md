---
title: puter.ui.setWindowY()
description: Sets the y position of the window.
platforms: [apps]
---

Sets the y position of the window.

## Syntax
```js
puter.ui.setWindowY(y)
puter.ui.setWindowY(y, window_id)
```

## Parameters

#### `y` (Float) (Required)
The new y position for this window.

#### `window_id` (optional)
Targets a specific window other than the app's main window. Accepts either a window id string or a window handle returned by [`puter.ui.createWindow()`](/UI/createWindow/) (an object with an `id` property). When omitted, the app's main window is used.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // sets the position of the window to 200px from the top
        puter.ui.setWindowY(200);
    </script>
</body>
```