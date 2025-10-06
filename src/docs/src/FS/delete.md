Deletes a file or directory.

## Syntax
```js
puter.fs.delete(path)
puter.fs.delete(path, options)
```

## Parameters
#### `path` (String) (required)
Path of the file or directory to delete.
If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `options` (Object) (optional)
The options for the `delete` operation. The following options are supported:
- `recursive` (Boolean) - Whether to delete the directory recursively. Defaults to `true`.
- `descendantsOnly` (Boolean) - Whether to delete only the descendants of the directory and not the directory itself. Defaults to `false`.


## Return value
A `Promise` that will resolve when the file or directory is deleted.

## Examples


<strong class="example-title">Delete a file</strong>

```html;fs-delete
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random file
            let filename = puter.randName();
            await puter.fs.write(filename, 'Hello, world!');
            puter.print('File created successfully<br>');

            // (2) Delete the file
            await puter.fs.delete(filename);
            puter.print('File deleted successfully');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Delete a directory</strong>

```html;fs-delete-directory
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random directory
            let dirname = puter.randName();
            await puter.fs.mkdir(dirname);
            puter.print('Directory created successfully<br>');

            // (2) Delete the directory
            await puter.fs.delete(dirname);
            puter.print('Directory deleted successfully');
        })();
    </script>
</body>
</html>
```
