# `puter.saveToPictures()`
A helper function that allows you to quickly save a file to the Pictures folder.

## Syntax
```js
puter.saveToPictures(filename)
puter.saveToPictures(filename, data)
puter.saveToPictures(filename, url_object)
```

## Parameters
#### `filename` (String)
The name of the file to save. If the file already exists, the name will be appended with a number to make it unique.

#### `data`
The content of the file to save. If not provided, the file will be created empty.

## Examples

<a href="https://puter.com/app/savetopictures-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=saveToPictures&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D6901de14-ff8f-4527-97f0-dbdd1d99ef40%26expires%3D10001673402411%26signature%3Dc38882fb81c9bc14c5364643cb48e9bc38db589d5bce84aaf0e84253420469ba" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Will save Example.txt to the user's Pictures folder
        puter.saveToPictures('Example.txt', "Hello world! I'm the content of this file.");
    </script>
</body>
</html>
```