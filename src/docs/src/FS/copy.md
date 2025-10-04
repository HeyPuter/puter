Copies a file or directory from one location to another. 

## Syntax

```js
puter.fs.copy(source, destination)
puter.fs.copy(source, destination, options)
```

## Parameters
#### `source` (String) (Required)
The path to the file or directory to copy.

#### `destination` (String) (Required)
The path to the destination directory. If destination is a directory then the file or directory will be copied into that directory using the same name as the source file or directory. If the destination is a file, we overwrite if overwrite is `true`, otherwise we error.

#### `options` (Object) (Optional)
The options for the `copy` operation. The following options are supported:
- `overwrite` (Boolean) - Whether to overwrite the destination file or directory if it already exists. Defaults to `false`.
- `dedupeName` (Boolean) - Whether to deduplicate the file or directory name if it already exists. Defaults to `false`.
- `newName` (String) - The new name to use for the copied file or directory. Defaults to `undefined`.


## Return value
A `Promise` that will resolve to the copied file or directory. If the source file or directory does not exist, the promise will be rejected with an error.

## Examples

<strong class="example-title"> Copy a file</strong>

```html;fs-copy
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // (1) Create a random text file
        let filename = puter.randName() + '.txt';
        await puter.fs.write(filename, 'Hello, world!');
        puter.print(`Created file: "${filename}"<br>`);

        // (2) create a random directory
        let dirname = puter.randName();
        await puter.fs.mkdir(dirname);
        puter.print(`Created directory: "${dirname}"<br>`);

        // (3) Copy the file into the directory
        puter.fs.copy(filename, dirname).then((file)=>{
            puter.print(`Copied file: "${filename}" to directory "${dirname}"<br>`);
        }).catch((error)=>{
            puter.print(`Error copying file: "${error}"<br>`);
        });
    })()
    </script>
</body>
</html>
```
