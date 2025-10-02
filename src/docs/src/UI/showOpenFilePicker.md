Presents the user with a file picker dialog allowing them to pick a file from their Puter cloud storage.

## Syntax
```js
puter.ui.showOpenFilePicker()
puter.ui.showOpenFilePicker(options)
```

## Parameters

#### `options` (optional)
A set of key/value pairs that configure the file picker dialog.
* `multiple` (Boolean): if set to `true`, user will be able to select multiple files. Default is `false`.
* `accept` (String): The list of MIME types or file extensions that are accepted by the file picker. Default is `*/*`.
    - Example: `image/*` will allow the user to select any image file.
    - Example: `['.jpg', '.png']` will allow the user to select files with `.jpg` or `.png` extensions.

## Return value 
A `Promise` that resolves to either one <code>FSItem</code> or an array of <code>FSItem</code> objects, depending on how many files were selected by the user. 

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>

    <h1 id="file-name"></h1>

    <button id="open-file-picker">Open file picker</button>
    <pre><code id="file-content"></code></pre>

    <script>
        document.getElementById('open-file-picker').addEventListener('click', ()=>{
            puter.ui.showOpenFilePicker().then(async (file)=>{
                // print file name
                document.getElementById('file-name').innerHTML = file.name;
                // print file content
                document.getElementById('file-content').innerText = await (await file.read()).text();
            });
        });
    </script>
</body>
</html>
```