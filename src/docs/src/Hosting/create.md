Will create a new subdomain that will be served by the hosting service. Optionally, you can specify a path to a directory that will be served by the subdomain.

## Syntax

```js
puter.hosting.create(subdomain, dirPath)
```

## Parameters
#### `subdomain` (String) (required)
A string containing the name of the subdomain you want to create.

#### `dirPath` (String) (optional)
A string containing the path to the directory you want to serve. If not specified, the subdomain will be created without a directory.

## Return value
A `Promise` that will resolve to a [`subdomain`](/Objects/subdomain/) object when the subdomain has been created. If a subdomain with the given name already exists, the promise will be rejected with an error. If the path does not exist, the promise will be rejected with an error.

## Examples

<strong class="example-title">Create a simple website displaying "Hello world!"</strong>

```html;hosting-create
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random directory
            let dirName = puter.randName();
            await puter.fs.mkdir(dirName)

            // (2) Create 'index.html' in the directory with the contents "Hello, world!"
            await puter.fs.write(`${dirName}/index.html`, '<h1>Hello, world!</h1>');

            // (3) Host the directory under a random subdomain
            let subdomain = puter.randName();
            const site = await puter.hosting.create(subdomain, dirName)

            puter.print(`Website hosted at: <a href="https://${site.subdomain}.puter.site" target="_blank">https://${site.subdomain}.puter.site</a>`);
        })();
    </script>
</body>
</html>
```
