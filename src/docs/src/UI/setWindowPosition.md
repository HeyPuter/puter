Allows the user to set the position of the window.

## Syntax
```js
puter.ui.setWindowPosition(x, y)
```

## Parameters

#### `x` (Float)
The new x position for this window. Must be a positive number.

#### `y` (Float)
The new y position for this window. Must be a positive number.

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