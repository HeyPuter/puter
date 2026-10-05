---
title: Work With a Large Directory
description: "Learn how to list a directory with thousands of files in Puter.js, so your app can load and show it one page at a time."
tags: [fs, performance]
order: 46
---

Reading a directory with [`puter.fs.readdir()`](/FS/readdir/) returns every item
in one call, as shown in [Store Files](/recipes/store-files/). That works for a
folder of a few dozen files. A folder of user uploads or generated exports can
grow to thousands of items, and loading all of them before showing anything
makes your app slow. The same method can return the directory in pages, sort
it, include subdirectories and count it, which is what a file browser with
infinite scrolling and a "showing 50 of 214" label needs.

## Read One Page at a Time

By default, the [`readdir()`](/FS/readdir/) method resolves to a plain array.
Passing a `cursor` switches the result to a page object with `items` and
`cursor`. For the first page, pass `null`:

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

Each page includes a `cursor` if there are more pages to load. When `cursor` is
missing, you've reached the last page.

Paging with a cursor is fast on every page. The `offset` option also works, but
the server has to count past every item you skip, so later pages get slower.

## Stream the Pages

To read the whole directory, pass `stream: true`. The
[`readdir()`](/FS/readdir/) method then returns an async iterator that you read
with `for await`:

```js
for await (const page of puter.fs.readdir({ path: 'uploads', stream: true })) {
    for (const item of page.items) {
        console.log(item.name);
    }
}
```

Each loop gives you one page, and the cursor is handled for you. Set
`limit` to choose the page size. Streaming cannot be combined with `offset`.

## Sort the Results

To change the order, pass `sortBy` and `sortOrder`:

```js
const items = await puter.fs.readdir({
    path: 'uploads',
    sortBy: 'modified',
    sortOrder: 'desc',
});
```

The `sortBy` option takes `name` (the default), `modified`, `type` or `size`,
and `sortOrder` takes `asc` (the default) or `desc`. When you read pages with a
cursor, every page must use the same sort as the first one.

## Include Subdirectories

To list the contents of subdirectories as well, pass `recursive: true`. Set
`depth` to limit how many levels down it goes:

```js
const items = await puter.fs.readdir({
    path: 'uploads',
    recursive: true,
    depth: 2,
});
```

With `recursive`, sorting by `name` sorts by full path, so the contents of each
directory stay together. Sorting by `modified`, `type` or `size` sorts across
all levels at once, so files from different directories are mixed together.

## Count the Items

To show a total such as "showing 50 of 214", pass `includeTotal: true`. It also
switches the result to a page object, so you get the count along with the first
page:

```js
const { items, total, cursor } = await puter.fs.readdir({
    path: 'uploads',
    cursor: null,
    limit: 50,
    includeTotal: true,
});
```

When you stream with `includeTotal`, only the first page carries `total`.
