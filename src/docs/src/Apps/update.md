Updates attributes of the app with the given name.

## Syntax
```js
puter.apps.update(name, attributes)
```

## Parameters
#### `name` (required)
The name of the app to update.

#### `attributes` (required)
An object containing the attributes to update. The object can contain the following properties:
- `name` (optional): The new name of the app. This name must be unique to the user's apps. If an app with this name already exists, the promise will be rejected.
- `indexURL` (optional): The new URL of the app's index page. This URL must be accessible to the user.
- `title` (optional): The new title of the app.
- `description` (optional): The new description of the app aimed at the end user.
- `icon` (optional): The new icon of the app.
- `maximizeOnStart` (optional): Whether the app should be maximized when it is started. Defaults to `false`.
- `filetypeAssociations` (optional): An array of strings representing the filetypes that the app can open. Defaults to `[]`. File extentions and MIME types are supported; For example, `[".txt", ".md", "application/pdf"]` would allow the app to open `.txt`, `.md`, and PDF files.

## Return value
A `Promise` that will resolve to the [`app`](/Objects/app/) that was updated.

## Examples

<strong class="example-title">Create a random app then change its title</strong>

```html;app-update
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random app
            let appName = puter.randName();
            await puter.apps.create(appName, "https://example.com")
            puter.print(`"${appName}" created<br>`);

            // (2) Update the app
            let updated_app = await puter.apps.update(appName, {title: "My Updated Test App!"})
            puter.print(`Changed title to "${updated_app.title}"<br>`);

            // (3) Delete the app (cleanup)
            await puter.apps.delete(appName)
        })();
    </script>
</body>
</html>
```
