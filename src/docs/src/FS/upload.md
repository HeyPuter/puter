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
- `dedupeName` (Boolean) - Whether to deduplicate the file name if it already exists. Defaults to `false`.
- `createMissingParents` (Boolean) - Whether to create missing parent directories. Defaults to `false`.
- `useSignedUploads` (Boolean) - Enable/disable signed URL uploads for eligible file uploads. Defaults to `true`.
- `disableSignedFallback` (Boolean) - If `true`, do not fallback to legacy upload when signed upload is unsupported or transiently unavailable. Defaults to `false`.
- `phase(operationId, phase)` (Function) - Optional callback for high-level upload phases where `phase` is one of: `preparing`, `uploading`, `finalizing`.

## Signed Upload Flow

When possible, `puter.fs.upload()` uses signed upload URLs:

1. Client sends metadata (`name`, `size`, `content_type`, optional `checksum_sha256`) to the server.
2. Server validates filesystem permissions/capacity and returns signed upload instructions.
3. Client uploads directly to storage using those signed instructions.
4. Client calls the completion endpoint, and the filesystem entry is finalized.

If signed uploads are unsupported for the current storage backend, the SDK may fallback to the legacy upload endpoint unless `disableSignedFallback` is set.

## Return value

Returns a `Promise` that resolves to:

- A single [`FSItem`](/Objects/fsitem/) object if `items` parameter contains one item
- An array of [`FSItem`](/Objects/fsitem/) objects if `items` parameter contains multiple items

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
