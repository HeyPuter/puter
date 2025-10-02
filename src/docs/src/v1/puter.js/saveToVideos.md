# `puter.saveToVideos()`
A helper function that allows you to quickly save a file to the user's Videos folder.

## Syntax
```js
puter.saveToVideos(filename)
puter.saveToVideos(filename, data)
puter.saveToVideos(filename, url_object)
```

## Parameters
#### `filename` (String)
The name of the file to save. If the file already exists, the name will be appended with a number to make it unique.

#### `data`
The content of the file to save. If not provided, the file will be created empty.

## Examples

<a href="https://puter.com/app/savetovideos-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=saveToVideos&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D3384f3a2-6465-4a49-a191-e7204a311759%26expires%3D10001673402422%26signature%3D16f6e92ce1f3982453fbf0915a027c703c434e9a92d71217a69c19ef0dd37fc2" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Saves Example.txt to the user's Videos folder 
        puter.saveToVideos('Example.txt', "Hello world! I'm the content of this file.");
    </script>
</body>
</html>
```