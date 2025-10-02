Creates a Puter app with the given name. The app will be created in the user's apps, and will be accessible to this app. The app will be created with no permissions, and will not be able to access any data until permissions are granted to it.

## Syntax
```js
puter.apps.create(name, indexURL)
puter.apps.create(name, indexURL, title)
puter.apps.create(name, indexURL, title, description)
puter.apps.create(options)
```

## Parameters
#### `name` (required)
The name of the app to create. This name must be unique to the user's apps. If an app with this name already exists, the promise will be rejected.

#### `indexURL` (required)
The URL of the app's index page. This URL must be accessible to the user. If this parameter is not provided, the app will be created with no index page. The index page is the page that will be displayed when the app is started.

**IMPORTANT**: The URL *must* start with either `http://` or `https://`. Any other protocols (including `file://`, `ftp://`, etc.) are not allowed and will result in an error. For example:

✅ `https://example.com/app/index.html` <br>
✅ `http://localhost:3000/index.html` <br>
❌ `file:///path/to/index.html` <br>
❌ `ftp://example.com/index.html` <br>

#### `title` (required)
The title of the app. If this parameter is not provided, the app will be created with `name` as its title.

#### `description` (optional)
The description of the app aimed at the end user.

#### `options` (required)
An object containing the options for the app to create. The object can contain the following properties:
- `name` (required): The name of the app to create. This name must be unique to the user's apps. If an app with this name already exists, the promise will be rejected.
- `indexURL` (required): The URL of the app's index page. This URL must be accessible to the user. If this parameter is not provided, the app will be created with no index page.
- `title` (optional): The human-readable title of the app. If this parameter is not provided, the app will be created with `name` as its title.
- `description` (optional): The description of the app aimed at the end user.
- `icon` (optional): The new icon of the app.
- `maximizeOnStart` (optional): Whether the app should be maximized when it is started. Defaults to `false`.
- `filetypeAssociations` (optional): An array of strings representing the filetypes that the app can open. Defaults to `[]`. File extentions and MIME types are supported; For example, `[".txt", ".md", "application/pdf"]` would allow the app to open `.txt`, `.md`, and PDF files.

## Return value
A `Promise` that will resolve to the [`app`](/Objects/app/) that was created.

## Examples

<strong class="example-title">Create an app pointing to example.com</strong>

```html;app-create
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name
            let appName = puter.randName();

            // (2) Create the app and prints its UID to the page
            let app = await puter.apps.create(appName, "https://example.com");
            puter.print(`Created app "${app.name}". UID: ${app.uid}`);

            // (3) Delete the app (cleanup)
            await puter.apps.delete(appName);
        })();
    </script>
</body>
</html>
```
