# `puter.saveToAudio()`
A helper function that allows you to quickly save a file to the user's Audio folder.

## Syntax
```js
puter.saveToAudio(filename)
puter.saveToAudio(filename, data)
puter.saveToAudio(filename, url_object)
```

## Parameters
#### `filename` (String)
The name of the file to save. If the file already exists, the name will be appended with a number to make it unique.

#### `data`
The content of the file to save. If not provided, the file will be created empty.

## Examples

<a href="https://puter.com/app/savetoaudio-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=saveToAudio&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3De5deca1e-e359-4e47-bf4c-72f3907ebc2b%26expires%3D10001673402363%26signature%3Db36e4a22b6ce0ece39493e69e263fec078d2c8e65b64996fe2e6ee311548cbd2" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Will save Example.txt to the user's Audio folder
        puter.saveToAudio("Hello world! I'm the content of this file.", 'Example.txt');
    </script>
</body>
</html>
```