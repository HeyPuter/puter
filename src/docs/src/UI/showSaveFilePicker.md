---
title: puter.ui.showSaveFilePicker()
description: Presents a file picker dialog for specifying where and with what name to save a file.
platforms: [websites, apps]
---

Presents the user with a file picker dialog allowing them to specify where and with what name to save a file.

## Syntax

```js
puter.ui.showSaveFilePicker()
puter.ui.showSaveFilePicker(content, suggestedName)
puter.ui.showSaveFilePicker(content, suggestedName, type)
```

## Parameters

#### `content` (Optional)

The data to write to the chosen file. The expected value depends on `type`:
- When `type` is omitted, `content` is the file data to write.
- When `type` is `'url'`, `content` is an `http` or `https` URL (string or `URL`) whose contents are saved. See [Saving from a URL](#saving-from-a-url).
- When `type` is `'move'` or `'copy'`, `content` is the source path of an existing file to move or copy.

#### `suggestedName` (String) (Optional)

The default file name to pre-fill in the dialog.

#### `type` (String) (Optional)

How `content` should be interpreted. One of `'url'`, `'move'`, or `'copy'`. If omitted and `content` is a `URL` object, it is auto-detected as `'url'`.

## Return value

A `Promise` that resolves to an [`FSItem`](/Objects/fsitem) describing the saved file. If the user cancels, the promise stays pending.

The returned promise also has an `undefinedOnCancel` property. It holds a second promise that resolves to the same result, or to `undefined` if the user cancels:

```js
const file = await puter.ui.showSaveFilePicker('Hello world!', 'hello.txt').undefinedOnCancel;
if (file === undefined) {
    // the user closed the picker without saving
}
```

## Saving from a URL

When `type` is `'url'`, Puter downloads the URL after the user picks where to save it. The request is sent without cookies or a referrer, so the file has to be publicly readable, and its server has to allow cross-origin requests (CORS) from Puter. Other URL schemes, such as `data:` and `blob:`, aren't accepted.

A download can be up to 100 MiB, and it fails if no data arrives for 60 seconds. If the download fails, the user sees an error and nothing is saved. The call then settles the same way as a cancel once the picker closes: the promise stays pending and `undefinedOnCancel` resolves to `undefined`.

To save a file that Puter can't download, such as one your server only serves with your own cookies, fetch it yourself and pass its contents as `content`.

## Examples

### Save a file to a picked location

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <h1 id="file-name"></h1>

    <button id="save-file">Save file</button>
    <pre><code id="file-content"></code></pre>

    <script>
        document.getElementById('save-file').addEventListener('click', ()=>{
            puter.ui.showSaveFilePicker("Hello world! I'm the content of this file.", 'Untitled.txt').then(async (file)=>{
                // print file name
                document.getElementById('file-name').innerHTML = file.name;
                // print file content
                document.getElementById('file-content').innerText = await (await file.read()).text();
            });
        });
    </script>
</body>
</html>
```
