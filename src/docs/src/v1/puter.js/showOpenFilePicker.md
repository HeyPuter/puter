# `puter.showOpenFilePicker()`
Presents the user with a file picker dialog allowing them to pick a file from their Puter cloud storage.

## Syntax
```js
puter.showOpenFilePicker()
puter.showOpenFilePicker(options)
```

## Parameters

#### `options` (optional)
A set of key/value pairs that configure the file picker dialog.
* `multiple` (Boolean): if set to `true`, user will be able to select multiple files. Default is `false`.
* `accept` (String): The list of MIME types that are accepted by the file picker. Default is `*/*`.

## Return value 
A `Promise` that resolves to either one <code>CloudItem</code> or an array of <code>CloudItem</code> objects, depending on how many files were selected by the user. 

## Examples

<a href="https://puter.com/app/showopenfilepicker-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=showOpenFilePicker&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D336d0565-99ce-4143-907f-f88ea6555f61%26expires%3D10001673402486%26signature%3D2df0b56b5972c98d96590e41caa3a3b6db49370a9f6799674c08677d1210df22" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <h1 id="file-name"></h1>
    <pre><code id="file-content"></code></pre>

    <script>
        puter.showOpenFilePicker().then(async (file)=>{
            // print file name
            document.getElementById('file-name').innerHTML = file.name;
            // print file content
            document.getElementById('file-content').innerText = await file.text();
        });
    </script>
</body>
</html>
```