# `puter.createWindow()`
Creates and displays a window.

## Syntax
```js
puter.createWindow()
puter.createWindow(options)
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
* `url` (String): an alternative to `content`, URL of the web page you want to load in the window.
* `width` (Float): width of window in pixels.

## Examples

<a href="https://puter.com/app/createwindow-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=createWindow&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3De7fbfbfd-6071-4a6e-926c-2ab8db6425f4%26expires%3D10001673402244%26signature%3D9e6bdbb09d9a5708f44a4cdbbbb9d815a52fd70abc90380610ebf7ccb8e7f310" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // create the window
        puter.createWindow({
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