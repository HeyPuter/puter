---
title: puter.ui.setWindowTitle()
description: Dynamically sets the title of the window.
platforms: [apps]
---

Allows the user to dynamically set the title of the window.

## Syntax
```js
puter.ui.setWindowTitle(title)
puter.ui.setWindowTitle(title, window_id)
```

## Parameters

#### `title` (String)
The new title for this window.

#### `window_id` (optional)
Targets a specific window other than the app's main window. Accepts either a window id string or a window handle returned by [`puter.ui.createWindow()`](/UI/createWindow/) (an object with an `id` property). When omitted, the app's main window is used.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.setWindowTitle('Fancy New Title');
    </script>
</body>
</html>
```