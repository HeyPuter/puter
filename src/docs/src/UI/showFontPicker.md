Presents the user with a list of fonts allowing them to preview and select a font.

## Syntax
```js
puter.ui.showFontPicker()
puter.ui.showFontPicker(defaultFont)
puter.ui.showFontPicker(options)
```

## Parameters
#### `defaultFont` (String)
The default font to select when the font picker is opened.


## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <h1>A cool Font Picker demo!</h1>

    <script>
        puter.ui.showFontPicker().then((font)=>{
            document.body.style.fontFamily = font.fontFamily;
        })
    </script>
</body>
</html>
```