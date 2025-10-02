Creates and displays a window.

## Syntax
```js
puter.ui.createWindow()
puter.ui.createWindow(options)
```

## Parameters

#### `options` (optional)
A set of key/value pairs that configure the window.
    
* `center` (Boolean): if set to `true`, window will be placed at the center of the screen.
* `content` (String): content of the window.
* `disable_parent_window` (Boolean): if set to `true`, the parent window will be blocked until current window is closed. 
* `has_head` (Boolean): if set to `true`, window will have a head which contains the icon and close, minimize, and maximize buttons.
* `height` (Float): height of window in pixels.
* `is_resizable` (Boolean): if set to `true`, user will be able to resize the window.
* `show_in_taskbar` (Boolean): if set to `true`, window will be represented in the taskbar.
* `title` (String): title of the window.
* `width` (Float): width of window in pixels.

## Examples
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