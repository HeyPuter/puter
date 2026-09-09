---
title: Store files in the user's own cloud drive
description: Save uploads, exports and generated files for each person using your app, with no bucket to configure and no storage bill.
tags: [fs, auth]
order: 7
---

**Use this when** your app takes in or produces files: a photo the user picks, a
document they export, an image your app generates, a recording it captures.

## Write a file, read it back

```html
<script src="https://js.puter.com/v2/"></script>
<script>
    (async () => {
        await puter.fs.write('notes/todo.txt', 'Buy milk');

        const blob = await puter.fs.read('notes/todo.txt');
        console.log(await blob.text());   // Buy milk
    })();
</script>
```

[`puter.fs.write()`](/FS/write/) takes a `String`, `File`, `Blob`, `ArrayBuffer`
or typed array, and replaces the file if it is already there.
[`puter.fs.read()`](/FS/read/) hands back a `Blob`, so `.text()`,
`.arrayBuffer()` and `URL.createObjectURL()` all work on the result. Writing
into a directory that does not exist yet is one option away:

```js
await puter.fs.write('exports/2026/report.csv', csv, { createMissingParents: true });
```

## Where the files live

Each file is written to the **signed-in user's own drive**. User A's
`notes/todo.txt` and user B's are separate files, neither can read the other's,
and the user covers their own storage under the [user-pays
model](/user-pays-model/). Sign-in happens on the first call that needs it.

A relative path resolves against the directory your app owns, `~/AppData/<app
id>/` inside a registered app and the user's home directory on a plain website.
That directory is yours to organize freely, and it is also the boundary: reaching
the rest of the drive takes a file the user hands you or a
[share](/FS/share/) they grant.

## Take a file from the user

An `<input type="file">` uploads straight to that directory with
[`puter.fs.upload()`](/FS/upload/):

```js
input.onchange = async () => {
    const file = await puter.fs.upload(input.files, 'uploads', { createMissingParents: true });
    console.log(file.path, file.size);
};
```

One selected file resolves to one [`FSItem`](/Objects/fsitem/), several resolve
to an array of them, and a name already taken is kept by writing the new file
under a free one.

[`puter.ui.showOpenFilePicker()`](/UI/showOpenFilePicker/) does the other half,
letting the user pick something they already keep in their drive and handing
your app access to that one item:

```js
const item = await puter.ui.showOpenFilePicker({ accept: 'image/*' });
const blob = await item.read();
```

## Work with what is there

The rest is the file system you already know, on the user's drive:

```js
// newest first
const items = await puter.fs.readdir('uploads', { sortBy: 'modified', sortOrder: 'desc' });
// [ { name: 'photo.png', path: '/user/AppData/app-.../uploads/photo.png', size, modified, isDir }, ... ]

const info = await puter.fs.stat('uploads/photo.png');    // size, timestamps, id
await puter.fs.rename('uploads/photo.png', 'cover.png');  // second argument is a name
await puter.fs.copy('uploads/cover.png', 'archive');      // second argument is a directory
await puter.fs.move('uploads/draft.png', 'archive');
await puter.fs.delete('uploads/old.png');
```

[`puter.fs.readdir()`](/FS/readdir/) pages the same way a listing does, with
`limit` and `cursor`, or `stream: true` for `for await`, which is what keeps a
directory of thousands affordable to display.

## Turn a file into a link

[`puter.fs.getReadURL()`](/FS/getReadURL/) mints a temporary URL for one file,
which is what an `<img src>` or a download button wants:

```js
const url = await puter.fs.getReadURL('uploads/photo.png', '1h');
```

The link expires, and expires in 24 hours if you leave the duration off. For a
URL that stays valid, [turn an uploaded file into a public
URL](/recipes/hosting-public-file-urls/) publishes a directory instead.

## Settings, records and lists

Structured data has a better home in [`puter.kv`](/KV/): a JSON file means
reading and rewriting the whole thing on every change, while the key-value store
addresses one record at a time and lists them by prefix. Keeping bytes in the
drive and their metadata in the store is the pairing most apps end up with:

```js
const file = await puter.fs.write(`uploads/${id}.png`, blob);
await puter.kv.set(`photo:${id}`, { path: file.path, caption, uploaded: Date.now() });
```

[Store app data in the user's own account](/recipes/kv-user-owned-data/) covers
that side.

## Notes

- `write()` overwrites a file of the same name by default. Pass
  `{ dedupeName: true }` to keep both copies, which stores the new one under a
  free name instead.
- `delete()` on a directory is recursive by default, and takes an array of paths
  to remove several items in one call.
- Calls resolve to an [`FSItem`](/Objects/fsitem/), which carries `id`, `name`,
  `path`, `size`, `isDir` and the `created`/`modified` timestamps, and reads
  itself with `item.read()`.
- [`puter.fs.share()`](/FS/share/) hands one file or directory to another Puter
  account. Files every user of the app has to reach belong [behind a
  worker](/recipes/worker-shared-kv-store/) instead, which runs under your
  account rather than theirs.
