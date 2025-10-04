Deletes an app with the given name.

## Syntax
```js
puter.apps.delete(name)
```

## Parameters
#### `name` (required)
The name of the app to delete.

## Return value
A `Promise` that will resolve to the app that was deleted.

## Examples

<strong class="example-title">Create a random app then delete it</strong>

```html;app-delete
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name to make sure it doesn't already exist
            let appName = puter.randName();

            // (2) Create the app
            await puter.apps.create(appName, "https://example.com");
            puter.print(`"${appName}" created<br>`);

            // (3) Delete the app
            await puter.apps.delete(appName);
            puter.print(`"${appName}" deleted<br>`);

            // (4) Try to retrieve the app (should fail)
            puter.print(`Trying to retrieve "${appName}"...<br>`);
            try {
                await puter.apps.get(appName);
            } catch (e) {
                puter.print(`"${appName}" could not be retrieved<br>`);
            }
        })();
    </script>
</body>
</html>
```
