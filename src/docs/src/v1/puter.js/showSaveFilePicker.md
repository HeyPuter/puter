# `puter.showSaveFilePicker()`
Presents the user with a file picker dialog allowing them to specify where and with what name to save a file.

## Syntax
```js
puter.showSaveFilePicker()
puter.showSaveFilePicker(data, defaultFileName)
puter.showSaveFilePicker(url_object, defaultFileName)
puter.showSaveFilePicker(options)
```

## Parameters
#### `defaultFileName` (String)
The default file name to use.

## Examples

<a href="https://puter.com/app/showsavefilepicker-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=showSaveFilePicker&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3Dec2326ef-ce4e-42d3-adac-499ea2a49f5a%26expires%3D10001673402502%26signature%3Dd20e1b2fb04117180ef155ad50589c01d7e20d9a9e2b21d1e58e47d5d8567ce9" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Show a file picker dialog for saving files with the default file name set to Untitle.txt
        puter.showSaveFilePicker("Hello world! I'm the content of this file.", 'Untitled.txt');
    </script>
</body>
</html>
```