---
title: Work With a Large Directory
description: "Page through a directory that is too big to read at once, sort and descend into it, and write into it without clobbering what is already there."
tags: [fs, performance]
order: 46
---

**Use this when** a directory has more in it than you want in memory at once, or
when you are writing into a folder that other things are also writing into.

Reading a whole directory is one call and covered in
[storing files](/recipes/store-files/). This is what to do when that is no
longer enough.

## Page through it

`readdir()` normally resolves to a plain array. Passing `cursor` — even `null`
for the first page — switches it to a page object instead:

```js
let page = await puter.fs.readdir({ path: 'uploads', cursor: null, limit: 100 });

for (;;) {
    for (const item of page.items) {
        console.log(item.name);
    }
    if (!page.cursor) break;
    page = await puter.fs.readdir({ path: 'uploads', cursor: page.cursor, limit: 100 });
}
```

Stop when `cursor` is absent. It is present only while more pages remain, so
that is the condition — not comparing `items.length` to `limit`.

## Stream the pages instead

`stream: true` hands back an async iterator, which is usually what you want when
you are just walking the whole thing:

```js
for await (const page of puter.fs.readdir({ path: 'uploads', stream: true })) {
    for (const item of page.items) {
        console.log(item.name);
    }
}
```

Same pages, less bookkeeping. Combine it with `limit` to set the page size.

## Sort it, and descend

```js
const items = await puter.fs.readdir({
    path: 'uploads',
    sortBy: 'modified',
    sortOrder: 'desc',
});
```

`sortBy` takes `name` (the default), `modified`, `type` or `size`.

`recursive: true` lists what is in the subdirectories too, and `depth` bounds
how far down it goes:

```js
const items = await puter.fs.readdir({
    path: 'uploads',
    recursive: true,
    depth: 2,
});
```

Sorting interacts with recursion in a way worth knowing: sorting by `name`
orders by *full path*, so each directory's contents stay together. The other
fields sort across the whole subtree, so files from different folders interleave.

## Count it

```js
const { items, total } = await puter.fs.readdir({
    path: 'uploads',
    cursor: null,
    includeTotal: true,
});
```

`includeTotal` also switches the result to a page object, so you get a count
without giving up paging.

## Write into it without clobbering

`write()` overwrites by default. Two options change that:

```js
// Keep both: writes report-1.txt if report.txt is taken.
await puter.fs.write('uploads/report.txt', data, { dedupeName: true });

// Refuse instead of replacing.
await puter.fs.write('uploads/report.txt', data, { overwrite: false });
```

`dedupeName` is what you want when two users might upload the same filename and
you would rather keep both than lose one.

## Create the folders on the way

Writing into a folder that does not exist fails unless you say otherwise:

```js
await puter.fs.write('reports/2026/q3/summary.txt', data, {
    createMissingParents: true,
});
```

`mkdir()` takes the same three options, so a directory tree can be created in
one call rather than level by level.

## Notes

- `offset` still works but gets slower the further in you go, because the server
  counts past everything you skipped. Prefer `cursor`.
- **A cursor pins the sort.** Later pages must not ask for a different `sortBy`
  or `sortOrder`, and `stream` cannot be combined with `offset`.
- Each item carries `is_shared`. Only shares on the item itself count — the
  children of a folder you shared report `false`, because the share lives on the
  folder. See [sharing a file](/recipes/share-a-file/).
- `mkdir()` defaults `overwrite` to `false`, while `write()` defaults it to
  `true`. They are not the same, which is easy to assume.
- The same three result shapes — array, page object, async iterator — are how
  the other listing methods work too, including
  [`puter.fs.listShared()`](/FS/listShared/).
