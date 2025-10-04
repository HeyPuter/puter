Allows you to create a directory.

## Syntax
```js
puter.fs.mkdir(path)
puter.fs.mkdir(path, options)
```

## Parameters
#### `path` (string) (required)
The path to the directory to create.
If path is not absolute, it will be resolved relative to the app's root directory.

#### `options` (object)
The options for the `mkdir` operation. The following options are supported:
- `overwrite` (boolean) - Whether to overwrite the directory if it already exists. Defaults to `false`.
- `dedupeName` (boolean) - Whether to deduplicate the directory name if it already exists. Defaults to `false`.
- `createMissingParents` (boolean) - Whether to create missing parent directories. Defaults to `false`.

## Return value
Returns a promise that resolves to the directory object of the created directory.

## Examples

<strong class="example-title">Create a new directory</strong>

```html;fs-mkdir
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Create a directory with random name
        let dirName = puter.randName();
        puter.fs.mkdir(dirName).then((directory) => {
            puter.print(`"${dirName}" created at ${directory.path}`);
        }).catch((error) => {
            puter.print('Error creating directory:', error);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Create a directory with duplicate name handling</strong>

```html;fs-mkdir-dedupe
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // create a directory named 'hello'
            let dir_1 = await puter.fs.mkdir('hello');
            puter.print(`Directory 1: ${dir_1.name}<br>`);
            // create a directory named 'hello' again, it should be automatically renamed to 'hello (n)' where n is the next available number
            let dir_2 = await puter.fs.mkdir('hello', { dedupeName: true });
            puter.print(`Directory 2: ${dir_2.name}<br>`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Create a new directory with missing parent directories</strong>

```html;fs-mkdir-create-missing-parents
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Create a directory named 'hello' in a directory that does not exist
            let dir = await puter.fs.mkdir('my-directory/another-directory/hello', { createMissingParents: true });
            puter.print(`Directory created at: ${dir.path}<br>`);
        })();
    </script>
</body>
</html>
```
