# `puter.saveToDocuments()`
A helper function that allows you to quickly save a file to the user's Documents folder.

## Syntax
```js
puter.saveToDocuments(filename)
puter.saveToDocuments(filename, data)
puter.saveToDocuments(filename, url_object)
```

## Parameters
#### `filename` (String)
The name of the file to save. If the file already exists, the name will be appended with a number to make it unique.

#### `data`
The content of the file to save. If not provided, the file will be created empty.

## Examples

<a href="https://puter.com/app/savetodocuments-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=saveToDocuments&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D32a94630-39b2-4026-8a20-719e08e08c21%26expires%3D10001673402393%26signature%3Df8a3aa7f8fcbc5e22df7bc6eefd1f02b49cf0c502d96164f91f9b2402b5f0d7f" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Will save Example.txt to the user's Documents folder
        puter.saveToDocuments('Example.txt', "Hello world! I'm the content of this file.");
    </script>
</body>
</html>
```