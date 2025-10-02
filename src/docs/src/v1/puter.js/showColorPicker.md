# `puter.showColorPicker()`
Presents the user with a color picker dialog allowing them to select a color.

## Syntax
```js
puter.showColorPicker()
puter.showColorPicker(defaultColor)
puter.showColorPicker(options)
```

## Examples

<a href="https://puter.com/app/showcolorpicker-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=showColorPicker&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3Dc73ddb2f-024e-49cf-a7fb-664158a7f69e%26expires%3D10001673402461%26signature%3Daf3e75cdd4620687e88cfa0bcd13a9fe4be442f64b7f85d4b81e2a56def11476" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        puter.showColorPicker().then((color)=>{
            document.body.style.backgroundColor = color;
        })
    </script>
</body>
</html>
```