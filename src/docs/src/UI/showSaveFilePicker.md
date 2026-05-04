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
```

## Parameters

#### `content` (String) (Optional)

The data to write to the chosen file.

#### `suggestedName` (String) (Optional)

The default file name to pre-fill in the dialog.

## Return value

A `Promise` that resolves to an [`FSItem`](/Objects/fsitem) describing the saved file. If the user cancels, the promise stays pending.

## Examples

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
