Allows the user to dynamically set the width of the window.

## Syntax
```js
puter.ui.setWindowWidth(width)
```

## Parameters

#### `width` (Float)
The new width for this window. Must be a positive number. Minimum width is 200px, if a value less than 200 is provided, the width will be set to 200px.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // sets the width of the window to 800px
        puter.ui.setWindowWidth(800);
    </script>
</body>
</html>
```