Renames a file or directory to a new name. This method allows you to change the name of a file or directory in the Puter cloud storage.

## Syntax
```js
puter.fs.rename(path, newName)
```

## Parameters
#### `path` (string)
The path to the file or directory to rename.
If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `newName` (string)
The new name of the file or directory.

## Return value
Returns a promise that resolves to the file or directory object of the renamed file or directory.

## Examples

<strong class="example-title">Rename a file</strong>

```html;fs-rename
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Create hello.txt
            await puter.fs.write('hello.txt', 'Hello, world!');
            puter.print(`"hello.txt" created<br>`);

            // Rename hello.txt to hello-world.txt
            await puter.fs.rename('hello.txt', 'hello-world.txt')
            puter.print(`"hello.txt" renamed to "hello-world.txt"<br>`);
        })();
    </script>
</body>
</html>
```
