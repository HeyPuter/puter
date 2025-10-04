Reads the contents of a directory, returning an array of items (files and directories) within it. This method is useful for listing all items in a specified directory in the Puter cloud storage.

## Syntax
```js
puter.fs.readdir(path)
puter.fs.readdir(path, options)
puter.fs.readdir(options)
```

## Parameters

#### `path` (string)
The path to the directory to read.
If `path` is not absolute, it will be resolved relative to the app's root directory.
 

#### `options` (object) (optional)

<br>

- `options.path` (string) (optional)
The path to the directory to read.

- `options.uid` (string) (optional)
The UID of the directory to read.



## Return value
A `Promise` that resolves to an array of [`fsitem`s](/Objects/fsitem/) (files and directories) within the specified directory.

## Examples

<strong class="example-title">Read a directory</strong>

```html;fs-readdir
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.fs.readdir('./').then((items) => {
            // print the path of each item in the directory
            puter.print(`Items in the directory:<br>${items.map((item) => item.path)}<br>`);
        }).catch((error) => {
            puter.print(`Error reading directory: ${error}`);
        });
    </script>
</body>
</html>
```
