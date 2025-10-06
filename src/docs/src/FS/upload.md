Given a number of local items, upload them to the Puter filesystem.

## Syntax

```js
puter.fs.upload(items)
puter.fs.upload(items, dirPath)
puter.fs.upload(items, dirPath, options)
```

## Parameters
#### `items` (Array) (required)
The items to upload to the Puter filesystem. `items` can be an `InputFileList`, `FileList`, `Array` of `File` objects, or an `Array` of `Blob` objects.

#### `dirPath` (String) (optional)
The path of the directory to upload the items to. If not set, the items will be uploaded to the app's root directory.

#### `options` (Object) (optional)
A set of key/value pairs that configure the upload process. 


## Return value
Returns a promise that resolves to an array of file objects of the uploaded files.

## Examples

<strong class="example-title">Upload a file from a file input</strong>

```html;fs-upload
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input type="file" id="file-input" />
    <script>
        // File input
        let fileInput = document.getElementById('file-input');

        // Upload the file when the user selects it
        fileInput.onchange = () => {
            puter.fs.upload(fileInput.files).then((file) => {
                puter.print(`File uploaded successfully to: ${file.path}`);                
            })
        };
    </script>
</body>
</html>
```
