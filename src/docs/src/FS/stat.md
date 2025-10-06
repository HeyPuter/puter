This method allows you to get information about a file or directory.

## Syntax

```js
puter.fs.stat(path)
```

## Parameters
#### `path` (string) (required)
The path to the file or directory to get information about.
If `path` is not absolute, it will be resolved relative to the app's root directory.

## Return value
A `Promise` that resolves to the [`fsitem`](/Objects/fsitem/) of the specified file or directory.

## Examples

<strong class="example-title">Get information about a file</strong>

```html;fs-stat
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // () create a file
            await puter.fs.write('hello.txt', 'Hello, world!');
            puter.print('hello.txt created<br>');

            // (2) get information about hello.txt
            const file = await puter.fs.stat('hello.txt');
            puter.print(`hello.txt name: ${file.name}<br>`);
            puter.print(`hello.txt path: ${file.path}<br>`);
            puter.print(`hello.txt size: ${file.size}<br>`);
            puter.print(`hello.txt created: ${file.created}<br>`);
        })()
    </script>
</body>
</html>
```
