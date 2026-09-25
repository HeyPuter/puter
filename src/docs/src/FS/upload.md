---
title: puter.fs.upload()
description: Upload local files to the user's own Puter file system.
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
- `generateThumbnails` (Boolean) - Generate image thumbnails in the browser before uploading. Defaults to `false`. Unsupported files and generation failures are skipped.
- `thumbnailGenerator` (Function) - Optional `(file, context) => string | undefined` callback (which may also return a promise), called once per file instead of the built-in image generator. Return a thumbnail data URL or URL, or `undefined` to skip. Exceptions are ignored. `context.defaultGenerator(file)` delegates to the built-in image generator; `context.signal` is an `AbortSignal` for upload preparation cancellation. Existing one-argument callbacks continue to work. A custom generator enables thumbnail preparation even when `generateThumbnails` is omitted.
- `thumbnail` (String) - Optional thumbnail data URL or URL to use when a file has no generated thumbnail. Data URLs exceeding 2 MiB are discarded.

The following callbacks report on the upload as it runs. `operationId` identifies the upload, so a page running several uploads at once can tell them apart:

- `init` (Function) - Called with `(operationId, xhr)` once the request has been created, before it is sent. The `XMLHttpRequest` is passed so you can abort the upload yourself.
- `start` (Function) - Called with no arguments when the upload starts sending.
- `progress` (Function) - Called with `(operationId, progress)` as bytes are sent, where `progress` is a percentage between `0` and `100`.
- `abort` (Function) - Called with `(operationId)` if the upload is aborted.

Cancelling through the `init` request handle during thumbnail preparation rejects with `{ code: 'upload_aborted', message: 'Upload aborted.' }` and prevents the upload from starting. Custom generators should stop their work when `context.signal` aborts and impose their own time and resource budgets; the SDK awaits thumbnail preparation before sending files.

```js
puter.fs.upload(items, './uploads', {
    progress: (operationId, progress) => {
        console.log(`${Math.round(progress)}%`);
    },
});
```

## Return value

Returns a `Promise` that resolves to:

- A single [`FSItem`](/Objects/fsitem/) object if `items` parameter contains one item
- An array of [`FSItem`](/Objects/fsitem/) objects if `items` parameter contains multiple items

If any part of the upload fails, the promise is rejected — it never resolves to a mix of items and errors. The rejection value always carries a `message`, and a `failedItems` array when individual items failed rather than the request as a whole. Each entry in `failedItems` carries the `path`, `message`, and — when the server gave one — the `code` and `status` for that item. A partially failed upload is not rolled back: the items that were written stay written.

When every failed item failed the same way, that `code` and `status` are also set on the rejection value itself, because the cause belongs to the request rather than to any one file. An upload that exceeds the account's storage quota is the common case: it rejects with `code: 'storage_limit_reached'` and `status: 413` however many files were in it.

When the signed batch-write endpoint is unavailable and the SDK falls back to the older batch endpoint, the rejection value also carries a stable `code`:

- `batch_upload_failed` — every operation failed, so nothing was written.
- `batch_upload_partially_failed` — some operations succeeded and others didn't. `failedCount` and `totalCount` say how many, and `results` holds every operation's result in the order they were sent.
- `batch_upload_no_results` — the request succeeded but the server didn't report what it wrote.

## Uploading directories

Directory uploads (dropped directory entries, or `createFileParent`) work on every platform: nested paths are recreated under the destination, and files sharing a name stay apart in the directories they came from. They rely on the signed batch-write endpoint, so against a backend that doesn't have one the SDK falls back to the older batch endpoint, which cannot create directories — the upload rejects with `batch_upload_failed`, and the directories have to be created with [`puter.fs.mkdir()`](/FS/mkdir/) and the files uploaded into them.

## Thumbnails

The built-in generator handles browser-decodable images. PDF rendering is provided separately by the Puter desktop; PDF.js is not included in the SDK. Apps can supply their own renderer through `thumbnailGenerator` and delegate other files to `context.defaultGenerator`:

```js
const file = new File(['Hello!'], 'hello.txt', { type: 'text/plain' });
await puter.fs.upload(file, './', {
    thumbnailGenerator: async (file, { defaultGenerator, signal }) => {
        if (signal.aborted) return undefined;
        return defaultGenerator(file);
    },
});
```

When using signed uploads, a separate thumbnail transfer that fails or exceeds five seconds is skipped and the original file still uploads. Explicit upload cancellation still stops the upload. Errors transferring the original file continue to reject normally.

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
