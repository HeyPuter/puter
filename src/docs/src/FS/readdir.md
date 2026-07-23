---
title: puter.fs.readdir()
description: List files and directories in Puter file system.
platforms: [websites, apps, nodejs, workers]
---

Reads the contents of a directory, returning an array of items (files and directories) within it. This method is useful for listing all items in a specified directory in the Puter cloud storage.

## Syntax

```js
puter.fs.readdir(path)
puter.fs.readdir(path, options)
puter.fs.readdir(options)
```

## Parameters

#### `path` (String)

The path to the directory to read.
If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `options` (Object) (optional)

An object with the following properties:

- `path` (String) - The path to the directory to read. Required when passing options as the only argument.
- `uid` (String) (optional) - The UID of the directory to read.
- `limit` (Number) (optional) - Maximum number of entries to return.
- `offset` (Number) (optional) - Skips the given number of entries. Prefer `cursor` for paging through large directories.
- `sortBy` (String) (optional) - Sort field: `name`, `modified`, `type`, or `size`. Default is `name`.
- `sortOrder` (String) (optional) - `asc` or `desc`. Default is `asc`.
- `cursor` (String | null) (optional) - Opts into paginated results. Pass `null` for the first page, then the `cursor` from each page to fetch the next one. The cursor pins the sort, so later pages must not request a different `sortBy`/`sortOrder`.
- `includeTotal` (Boolean) (optional) - If `true`, the paginated result includes a `total` count of all entries in the directory.
- `stream` (Boolean) (optional) - If `true`, the method returns an async iterator of page objects instead of a promise, for use with `for await ... of`. Combine with `limit` to control the page size, or `cursor` to resume from a previous page. Cannot be combined with `offset`. With `includeTotal`, only the first page carries `total`.

## Return value

A `Promise` that resolves to an array of [`FSItem`](/Objects/fsitem/) objects (files and directories) within the specified directory.

When the request includes `cursor` (even `null`) or `includeTotal`, the promise instead resolves to a page object:

- `items` (Array): The [`FSItem`](/Objects/fsitem/) objects on this page.
- `cursor` (String) (optional): Present while more pages exist; pass it to the next call.
- `total` (Number) (optional): Total entry count, present when `includeTotal` was set.

Requests without pagination params keep returning the full listing as a plain array, so existing code is unaffected — under the hood the SDK now fetches it page by page.

With `stream: true`, the method returns an async iterator of page objects instead:

```js
for await (const page of puter.fs.readdir({ path: './large-dir', stream: true })) {
    for (const item of page.items) {
        console.log(item.name);
    }
}
```

## Examples

<strong class="example-title">Read a directory</strong>

```html;fs-readdir
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.fs.readdir('./').then((items) => {
            // print the path of each item in the directory
            puter.print(`Items in the directory:<br>${items.map((item) => item.path)}<br>`);
        }).catch((error) => {
            puter.print(`Error reading directory: ${error}`);
        });
    </script>
</body>
</html>
```
