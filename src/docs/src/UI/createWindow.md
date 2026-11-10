---
title: puter.ui.createWindow()
description: Creates and displays a window.
platforms: [apps]
---

Creates and displays a window.

## Syntax
```js
puter.ui.createWindow()
puter.ui.createWindow(options)
```

## Parameters

#### `options` (optional)
A set of key/value pairs that configure the window.

| Option | Type | Description |
|--------|------|-------------|
| `title` | `String` | Title of the window. |
| `content` | `String` | Content of the window. |
| `width` | `Number` | Width of the window in pixels. |
| `height` | `Number` | Height of the window in pixels. |
| `center` | `Boolean` | If set to `true`, the window is placed at the center of the screen. |
| `is_resizable` | `Boolean` | If set to `true`, the user can resize the window. |
| `has_head` | `Boolean` | If set to `true`, the window has a head which contains the icon and the close, minimize, and maximize buttons. |
| `disable_parent_window` | `Boolean` | If set to `true`, the parent window is blocked until the current window is closed. |
| `show_in_taskbar` | `Boolean` | If set to `true`, the window is represented in the taskbar. |

## Return value
A `Promise` that resolves to a window handle object with an `id` (String) property identifying the created window. This `id` can be passed as the `window_id` argument to the `setWindow*` methods.

## Examples
### Create a window

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // create the window
        puter.ui.createWindow({
            title: 'Cool Title',
            content: `<h1 style="text-align:center;">My little test window!</h1>`, 
            disable_parent_window: true,
            width: 300,
            height: 300,
            is_resizable: false,
            has_head: true,
            center: true,
            show_in_taskbar: false,
        })
    </script>
</body>
</html>
```