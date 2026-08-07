---
title: puter.fs.upload()
description: Upload local files to Puter file system.
platforms: [websites, apps, nodejs, workers]
---

Given a number of local items, upload them to the Puter filesystem.

## Syntax

```js
puter.fs.upload(items)
puter.fs.upload(items, dirPath)
puter.fs.upload(items, dirPath, options)
```

## Parameters

#### `items` (Object) (required)

The items to upload to the Puter filesystem. `items` can be an `InputFileList`, `FileList`, `Array` of `File` objects, or an `Array` of `Blob` objects.

#### `dirPath` (String) (optional)

The path of the directory to upload the items to. If not set, the items will be uploaded to the app's root directory.

#### `options` (Object) (optional)

A set of key/value pairs that configure the upload process. The following options are supported:

- `overwrite` (Boolean) - Whether to overwrite the destination file if it already exists. Defaults to `false`.
- `dedupeName` (Boolean) - Whether to deduplicate the file name if it already exists. Defaults to `true`. Ignored when `overwrite` is `true`.
- `createMissingParents` (Boolean) - Whether to create missing parent directories. Defaults to `false`.

## Return value

Returns a `Promise` that resolves to:

- A single [`FSItem`](/Objects/fsitem/) object if `items` parameter contains one item
- An array of [`FSItem`](/Objects/fsitem/) objects if `items` parameter contains multiple items

If any part of the upload fails, the promise is rejected — it never resolves to a mix of items and errors. The rejection value always carries a `message`, and a `failedItems` array when individual items failed rather than the request as a whole. A partially failed upload is not rolled back: the items that were written stay written.

On `nodejs` and `workers`, where the upload goes through an older batch endpoint, the rejection value also carries a stable `code`:

- `batch_upload_failed` — every operation failed, so nothing was written.
- `batch_upload_partially_failed` — some operations succeeded and others didn't. `failedCount` and `totalCount` say how many, and `results` holds every operation's result in the order they were sent.
- `batch_upload_no_results` — the request succeeded but the server didn't report what it wrote.

## Uploading directories

Directory uploads (dropped directory entries, or `createFileParent`) are supported on `websites` and `apps`. On `nodejs` and `workers` the upload goes through an older batch endpoint that cannot create the directory tree, so a directory upload rejects with `batch_upload_failed`; create the directories with [`puter.fs.mkdir()`](/FS/mkdir/) and upload the files into them instead.

## Examples

<strong class="example-title">Upload a file from a file input</strong>

```html;fs-upload
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input type="file" id="file-input" />
    <script>
        // File input
        let fileInput = document.getElementById('file-input');

        // Upload the file when the user selects it
        fileInput.onchange = () => {
            puter.fs.upload(fileInput.files).then((file) => {
                puter.print(`File uploaded successfully to: ${file.path}`);                
            })
        };
    </script>
</body>
</html>
```
