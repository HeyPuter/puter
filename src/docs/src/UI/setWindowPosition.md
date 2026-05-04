---
title: puter.ui.setWindowPosition()
description: Sets the position of the window.
platforms: [apps]
---

Allows the user to set the position of the window.

## Syntax
```js
puter.ui.setWindowPosition(x, y)
puter.ui.setWindowPosition(x, y, window_id)
```

## Parameters

#### `x` (Float)
The new x position for this window. Must be a positive number.

#### `y` (Float)
The new y position for this window. Must be a positive number.

#### `window_id` (optional)
Targets a specific window other than the app's main window. Accepts either a window id string or a window handle returned by [`puter.ui.createWindow()`](/UI/createWindow/) (an object with an `id` property). When omitted, the app's main window is used.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // sets the position of the window to 100px from the left and 200px from the top
        puter.ui.setWindowPosition(100, 200);
    </script>
</body>
</html>
```