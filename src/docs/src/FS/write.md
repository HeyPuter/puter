Writes data to a specified file path. This method is useful for creating new files or modifying existing ones in the Puter cloud storage.

## Syntax

```js
puter.fs.write(path)
puter.fs.write(path, data)
puter.fs.write(path, data, options)
```

## Parameters
#### `path` (string) (required)
The path to the file to write to.
If path is not absolute, it will be resolved relative to the app's root directory.

#### `data` (string|File|Blob)
The data to write to the file.

#### `options` (object)
The options for the `write` operation. The following options are supported:
- `overwrite` (boolean) - Whether to overwrite the file if it already exists. Defaults to `true`.
- `dedupeName` (boolean) - Whether to deduplicate the file name if it already exists. Defaults to `false`.
- `createMissingParents` (boolean) - Whether to create missing parent directories. Defaults to `false`.

## Return value
Returns a promise that resolves to the file object of the written file.

## Examples

<strong class="example-title">Create a new file containing "Hello, world!"</strong>

```html;fs-write
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Create a new file called "hello.txt" containing "Hello, world!"
        puter.fs.write('hello.txt', 'Hello, world!').then(() => {
            puter.print('File written successfully');
        })
    </script>
</body>
</html>
```

<strong class="example-title">Create a new file with input coming from a file input</strong>

```html;fs-write-from-input
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input type="file" id="file-input">
    <script>
        // Example: Writing a file with input coming from a file input
        document.getElementById('file-input').addEventListener('change', (event) => {
            puter.fs.write('hello.txt', event.target.files[0]).then(() => {
                puter.print('File written successfully');
            }).catch((error) => {
                puter.print('Error writing file:', error);
            });
        });
    </script>
</body>
</html>
```

<strong class="example-title">Create a file with duplicate name handling</strong>

```html;fs-write-dedupe
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // create a file named 'hello.txt'
            let file_1 = await puter.fs.write('hello.txt', 'Hello, world!');
            puter.print(`File 1: ${file_1.name}<br>`);
            // create a file named 'hello.txt' again, it should be automatically renamed to 'hello (n).txt' where n is the next available number
            let file_2 = await puter.fs.write('hello.txt', 'Hello, world!', { dedupeName: true });
            puter.print(`File 2: ${file_2.name}<br>`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Create a new file with missing parent directories</strong>

```html;fs-write-create-missing-parents
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // create a file named 'hello.txt' in a directory that does not exist
            let file = await puter.fs.write('my-directory/another-directory/hello.txt', 'Hello, world!', { createMissingParents: true });
            puter.print(`File created at: ${file.path}<br>`);
        })();
    </script>
</body>
</html>
```
