# `puter.saveToDesktop()`
A helper function that allows you to quickly save a file to the user's Desktop.

## Syntax
```js
puter.saveToDesktop(filename)
puter.saveToDesktop(filename, data)
puter.saveToDesktop(filename, url_object)
```

## Parameters
#### `filename` (String)
The name of the file to save. If the file already exists, the name will be appended with a number to make it unique.

#### `data`
The content of the file to save. If not provided, the file will be created empty.

## Examples

<a href="https://puter.com/app/savetodesktop-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=saveToDesktop&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3Dcae64c7c-a525-4806-b4b0-185ebf2d31f1%26expires%3D10001673402383%26signature%3D5b2248b62a97ea6b4ba74a210618ccef8823d1a0e3cc71dd9d3c397e83c27a39" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Will save Example.txt to the user's Desktop
        puter.saveToDesktop('Example.txt', "Hello world! I'm the content of this file.");
    </script>
</body>
</html>
```