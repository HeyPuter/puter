Deletes a subdomain from your account. The subdomain will no longer be served by the hosting service. If the subdomain has a directory, it will be disconnected from the subdomain. The associated directory will not be deleted.

## Syntax

```js
puter.hosting.delete(subdomain)
```

## Parameters
#### `subdomain` (String) (required)
A string containing the name of the subdomain you want to delete.

## Return value
A `Promise` that will resolve to `true` when the subdomain has been deleted. If a subdomain with the given name does not exist, the promise will be rejected with an error.

## Examples

<strong class="example-title">Create a random website then delete it</strong>

```html;hosting-delete
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random website
            let subdomain = puter.randName();
            const site = await puter.hosting.create(subdomain)
            puter.print(`Website hosted at: ${site.subdomain}.puter.site (This is an empty website with no files)<br>`);

            // (2) Delete the website using delete()
            const site2 = await puter.hosting.delete(site.subdomain);
            puter.print('Website deleted<br>');

            // (3) Try to retrieve the website (should fail)
            puter.print('Trying to retrieve website... (should fail)<br>');
            try {
                await puter.hosting.get(site.subdomain);
            } catch (e) {
                puter.print('Website could not be retrieved<br>');
            }
        })();
    </script>
</body>
</html>
```
