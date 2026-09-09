---
title: Store Files
description: "Learn how to store binary files in Puter.js object storage. Every file lives inside the user's own Puter account."
tags: [fs, auth]
order: 7
---

Most applications need somewhere to keep binary files, such as images, videos,
PDFs, or exports the app generates. In Puter.js that object storage is the
[filesystem API](/FS/). It supports the standard operations you would expect
from any filesystem, such as writes, reads, listings, deletes, and more. Files
are addressed by path rather than by bucket and key, and they all live inside
the user's own Puter account.

## Write

To save a file, use the [`puter.fs.write()`](/FS/write/) method. It takes a path
and the contents:

```js
await puter.fs.write('notes/todo.txt', 'Buy milk');
```

The contents can be a `String`, `File`, `Blob`, `ArrayBuffer` or typed array, so
text and binary data are written the same way. Writing to a path that already
exists replaces the file, and passing `dedupeName` keeps both copies by saving
the new one under a free name:

```js
await puter.fs.write('uploads/photo.png', blob, { dedupeName: true });
```

Writing into a directory that does not exist yet is one more option:

```js
await puter.fs.write('exports/2026/report.csv', csv, { createMissingParents: true });
```

## Read

To read a file back, use the [`puter.fs.read()`](/FS/read/) method. It hands
back a `Blob`:

```js
const blob = await puter.fs.read('notes/todo.txt');
await blob.text();      // 'Buy milk'
```

A `Blob` is what the browser already works with, so `.text()`, `.arrayBuffer()`
and `URL.createObjectURL()` all work on the result.

## Where the Files Live

Each file is written to the **signed-in user's own drive**. User A's
`notes/todo.txt` and user B's are separate files, neither user can read the
other's, and the user covers their own storage under the [User-Pays
Model](/user-pays-model/).

A relative path resolves against `~/AppData/<your-app-id>/`, the sandbox Puter
creates for your app the first time the user signs in. You can create any files
and folders you like inside it, and your app cannot see anything outside it.

## Upload

To take a file from an `<input type="file">`, use the
[`puter.fs.upload()`](/FS/upload/) method:

```js
input.onchange = async () => {
    const file = await puter.fs.upload(input.files, 'uploads', { createMissingParents: true });
    file.path;      // '/user/AppData/app-.../uploads/photo.png'
};
```

One selected file resolves to one [`FSItem`](/Objects/fsitem/) and several
resolve to an array of them. A name that is already taken stays as it is, and
the new file lands under a free one.

## List

To see what a directory holds, use the [`puter.fs.readdir()`](/FS/readdir/)
method:

```js
const items = await puter.fs.readdir('uploads', { sortBy: 'modified', sortOrder: 'desc' });
// [ { name: 'photo.png', path: '/user/AppData/app-.../uploads/photo.png', size, modified, isDir }, ... ]
```

It pages the way a key listing does, with `limit` and `cursor`, or `stream:
true` for `for await`, which is what keeps a directory of thousands affordable
to display.

To read the metadata of one file, use the [`puter.fs.stat()`](/FS/stat/) method:

```js
const info = await puter.fs.stat('uploads/photo.png');      // size, timestamps, id
```

## Rename, Move and Copy

To reorganize what is there, use the [`puter.fs.rename()`](/FS/rename/),
[`puter.fs.move()`](/FS/move/) and [`puter.fs.copy()`](/FS/copy/) methods:

```js
await puter.fs.rename('uploads/photo.png', 'cover.png');    // second argument is a name
await puter.fs.move('uploads/draft.png', 'archive');        // second argument is a directory
await puter.fs.copy('uploads/cover.png', 'archive');
```

## Delete

To remove a file, use the [`puter.fs.delete()`](/FS/delete/) method:

```js
await puter.fs.delete('uploads/old.png');
```

It also takes an array of paths to remove several items in one call, and
deleting a directory is recursive by default.

## Get a Link

To show a file in an `<img>` tag or hand it to a download button, use the
[`puter.fs.getReadURL()`](/FS/getReadURL/) method. It mints a temporary URL for
one file:

```js
const url = await puter.fs.getReadURL('uploads/photo.png', '1h');
```

The URL gives temporary access to that one file. It expires after the duration
you pass, or in 24 hours if you leave the duration off.

## Notes

- Structured data, such as settings, records and lists, belongs in the
  [key-value database](/KV/) instead. A JSON file means reading and rewriting
  the whole thing on every change, while a key-value entry addresses one record
  at a time. [Store data in the Puter.js key-value
  database](/recipes/store-data/) covers it.
- Files every user of the app has to reach go [behind a
  worker](/recipes/store-server-side-data/), which runs under your account
  instead of theirs.
- A URL that stays valid takes hosting a directory instead of minting a link per
  file. [Host a file online](/recipes/host-file/) covers it.
