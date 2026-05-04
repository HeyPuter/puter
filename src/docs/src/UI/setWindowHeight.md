---
title: puter.ui.setWindowHeight()
description: Dynamically sets the height of the window.
platforms: [apps]
---

Allows the user to dynamically set the height of the window.

## Syntax
```js
puter.ui.setWindowHeight(height)
puter.ui.setWindowHeight(height, window_id)
```

## Parameters

#### `height` (Float)
The new height for this window. Must be a positive number. Minimum height is 200px, if a value less than 200 is provided, the height will be set to 200px.

#### `window_id` (optional)
Targets a specific window other than the app's main window. Accepts either a window id string or a window handle returned by [`puter.ui.createWindow()`](/UI/createWindow/) (an object with an `id` property). When omitted, the app's main window is used.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // sets the height of the window to 800px
        puter.ui.setWindowHeight(800);
    </script>
</body>
</html>
```