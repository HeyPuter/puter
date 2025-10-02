Reads data from a file.

## Syntax
```js
puter.fs.read(path)
puter.fs.read(path, options)
```

## Parameters
#### `path` (String) (required)
Path of the file to read.
If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `options` (Object) (optional)

An object with the following properties:

- `offset` (Number) (optional)
The offset to start reading from.

- `byte_count` (Number) (required if `offset` is provided)
The number of bytes to read from the offset.

## Return value
A `Promise` that will resolve to a `Blob` object containing the contents of the file.

## Examples

<strong class="example-title">Read a file</strong>

```html;fs-read
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random text file
            let filename = puter.randName() + ".txt";
            await puter.fs.write(filename, "Hello world! I'm a file!");
            puter.print(`"${filename}" created<br>`);

            // (2) Read the file and print its contents
            let blob = await puter.fs.read(filename);
            let content = await blob.text();
            puter.print(`"${filename}" read (content: "${content}")<br>`);
        })();
    </script>
</body>
</html>
```
