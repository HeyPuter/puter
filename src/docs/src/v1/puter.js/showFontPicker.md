# `puter.showFontPicker()`
Presents the user with a list of fonts allowing them to preview and select a font.

## Syntax
```js
puter.showFontPicker()
puter.showFontPicker(defaultFont)
puter.showFontPicker(options)
```

## Parameters
#### `defaultFont` (String)
The default font to select.


## Examples

<a href="https://puter.com/app/showfontpicker-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=showFontPicker&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D1a7fc4de-552f-47fb-b697-f9a47b513b53%26expires%3D10001673402473%26signature%3D59eda499d167b8358d3bc39630087d226fc80346be25b26955bddc72dce140a5" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <h1>A cool Font Picker demo!</h1>

    <script>
        puter.showFontPicker().then((font)=>{
            document.body.style.fontFamily = font.fontFamily;
        })
    </script>
</body>
</html>
```