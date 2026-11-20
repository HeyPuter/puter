---
title: puter.apps.create()
description: Create apps in the Puter desktop environment.
platforms: [websites, apps, nodejs, workers]
---

Creates a Puter app with the given name.

The app will be created in the user's apps, and will be accessible to this app. The app will be created with no permissions, and will not be able to access any data until permissions are granted to it.

## Syntax

```js
puter.apps.create(name, indexURL)
puter.apps.create(name, indexURL, title)
puter.apps.create(options)
```

## Parameters

#### `name` (required)

The name of the app to create. App names are unique across all Puter accounts. If any app already has this name, the promise will be rejected.

#### `indexURL` (required)

The URL of the app's index page. This URL must be accessible to the user. The index page is the page that will be displayed when the app is started. If this parameter is not provided, the promise will be rejected.

**IMPORTANT**: The URL _must_ start with either `http://` or `https://`. Any other protocols (including `file://`, `ftp://`, etc.) are not allowed and will result in an error. For example:

✅ `https://example.com/app/index.html` <br>
✅ `http://localhost:3000/index.html` <br>
❌ `file:///path/to/index.html` <br>
❌ `ftp://example.com/index.html` <br>

#### `title` (Optional)

The title of the app. If this parameter is not provided, the app will be created with `name` as its title.

#### `options` (required)

An object containing the options for the app to create. The object can contain the following properties:

| Option | Type | Description |
|--------|------|-------------|
| `name` | `String` | Required. The name of the app to create. App names are unique across all Puter accounts. If any app already has this name, the promise will be rejected. |
| `indexURL` | `String` | Required. The URL of the app's index page. This URL must be accessible to the user. If it's missing, the promise will be rejected. |
| `title` | `String` | The human-readable title of the app. If it's missing, the app will be created with `name` as its title. |
| `description` | `String` | The description of the app aimed at the end user. |
| `icon` | `String` | The new icon of the app. |
| `filetypeAssociations` | `Array<String>` | An array of strings representing the filetypes that the app can open. Defaults to `[]`. File extensions and MIME types are supported. For example, `[".txt", ".md", "application/pdf"]` would allow the app to open `.txt`, `.md`, and PDF files. At most 200 entries, each at most 60 characters. |
| `maximizeOnStart` | `Boolean` | Whether the app should be maximized when it is started. Defaults to `false`. |
| `background` | `Boolean` | Whether the app should run in the background. Defaults to `false`. |
| `feedbackEnabled` | `Boolean` | Whether users can send feedback to you through [`puter.ui.showFeedbackDialog()`](/UI/showFeedbackDialog/). Defaults to `false`. |
| `metadata` | `Object` | An object containing custom metadata for the app. This can be used to store arbitrary key-value pairs associated with the app. At most 16 KiB when serialized as JSON. |
| `dedupeName` | `Boolean` | Whether to deduplicate the app name if it already exists. Defaults to `false`. |

## Return value

A `Promise` that will resolve to the [`CreateAppResult`](/Objects/createappresult/) object that was created.

## Examples

### Create an app pointing to example.com

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
