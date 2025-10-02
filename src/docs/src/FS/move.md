Moves a file or a directory from one location to another.

## Syntax

```js
puter.fs.move(source, destination)
puter.fs.move(source, destination, options)
```

## Parameters
#### `source` (String) (Required)
The path to the file or directory to move.

#### `destination` (String) (Required)
The path to the destination directory. If destination is a directory then the file or directory will be moved into that directory using the same name as the source file or directory. If the destination is a file, we overwrite if overwrite is `true`, otherwise we error.

#### `options` (Object) (Optional)
The options for the `move` operation. The following options are supported:
- `overwrite` (Boolean) - Whether to overwrite the destination file or directory if it already exists. Defaults to `false`.
- `dedupeName` (Boolean) - Whether to deduplicate the file or directory name if it already exists. Defaults to `false`.
- `createMissingParents` (Boolean) - Whether to create missing parent directories. Defaults to `false`.

## Return value
A `Promise` that will resolve to the moved file or directory. If the source file or directory does not exist, the promise will be rejected with an error.

## Examples

<strong class="example-title">Move a file</strong>

```html;fs-move
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // (1) Create a random text file
        let filename = puter.randName() + '.txt';
        await puter.fs.write(filename, 'Hello, world!');
        puter.print(`Created file: ${filename}<br>`);

        // (2) create a random directory
        let dirname = puter.randName();
        await puter.fs.mkdir(dirname);
        puter.print(`Created directory: ${dirname}<br>`);

        // (3) Move the file into the directory
        await puter.fs.move(filename, dirname);
        puter.print(`Moved file: ${filename} to directory ${dirname}<br>`);

        // (4) Delete the file and directory (cleanup)
        await puter.fs.delete(dirname + '/' + filename);
        await puter.fs.delete(dirname);
    })();
    </script>
</body>
</html>
```

<strong class="example-title">Move a file and create missing parent directories</strong>

```html;fs-move-create-missing-parents
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // (1) Create a random file
        let filename = puter.randName() + '.txt';
        await puter.fs.write(filename, 'Hello, world!');
        puter.print('Created file: ' + filename + '<br>');

        // (2) Move the file into a non-existent directory
        let dirname = puter.randName();
        await puter.fs.move(filename, dirname + '/' + filename, { createMissingParents: true });
        puter.print(`Moved ${filename} to ${dirname}<br>`);

        // (3) Delete the file and directory (cleanup)
        await puter.fs.delete('non-existent-directory/' + filename);
        await puter.fs.delete('non-existent-directory');
    })();
    </script>
</body>
</html>
```
