Updates a subdomain to point to a new directory. If directory is not specified, the subdomain will be disconnected from its directory.

## Syntax

```js
puter.hosting.update(subdomain, dirPath)
```

## Parameters
#### `subdomain` (String) (required)
A string containing the name of the subdomain you want to update.

#### `dirPath` (String) (optional)
A string containing the path to the directory you want to serve. If not specified, the subdomain will be disconnected from its directory.

## Return value
A `Promise` that will resolve to a [`subdomain`](/Objects/subdomain/) object when the subdomain has been updated. If a subdomain with the given name does not exist, the promise will be rejected with an error. If the path does not exist, the promise will be rejected with an error.

## Examples

<strong class="example-title">Update a subdomain to point to a new directory</strong>

```html;hosting-update
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random website
            let subdomain = puter.randName();
            const site = await puter.hosting.create(subdomain)
            puter.print(`Website hosted at: ${site.subdomain}.puter.site<br>`);

            // (2) Create a random directory
            let dirName = puter.randName();
            let dir = await puter.fs.mkdir(dirName)
            puter.print(`Created directory "${dir.path}"<br>`);

            // (3) Update the site with the new random directory
            await puter.hosting.update(subdomain, dirName)
            puter.print(`Changed subdomain's root directory to "${dir.path}"<br>`);

            // (4) Delete the app (cleanup)
            await puter.hosting.delete(updatedSite.subdomain)
        })();
    </script>
</body>
</html>
```
