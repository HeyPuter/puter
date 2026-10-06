---
title: Keep a Version History
description: "Learn how to save every version of a document with Puter.js so users can look back and restore an older one."
tags: [kv, data-modeling]
order: 36
---

Lots of editors let you go back to an earlier version, like the version history
in Google Docs. With [`puter.kv`](/KV/), you can do this by saving a copy of the
document under a numbered key every time it's saved. Old copies can delete
themselves after a while.

This recipe uses notes, with three kinds of keys per note:

| Key | Holds |
| --- | --- |
| `note:<id>` | The current version |
| `note-history:<id>:00000007` | A copy of version 7. Each save adds one |
| `note-revision:<id>` | The latest version number |

## Save a Version

Each save gets the next version number, then writes the current version and a
copy in one call:

```js
const versionKey = (noteId, number) =>
    `note-history:${ noteId }:${ String(number).padStart(8, '0') }`;

async function saveNote (noteId, text) {
    const number = await puter.kv.incr(`note-revision:${ noteId }`);
    const in30Days = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

    await puter.kv.set([
        { key: `note:${ noteId }`, value: { text, version: number } },
        {
            key: versionKey(noteId, number),
            value: { text, number, savedAt: Date.now() },
            expireAt: in30Days,
        },
    ]);
    return number;
}
```

[`puter.kv.incr()`](/KV/incr/) gives every save its own number, even when two
tabs save at once. The number is padded with zeros so the keys sort in order
(otherwise `10` would come before `9`).

Passing an array to [`puter.kv.set()`](/KV/set/) writes both keys in one
request. The copy gets an `expireAt`, a Unix time in seconds, so it's deleted
after 30 days. The current version has no expiry, so the note itself never goes
away.

If two tabs save at the same moment, both versions end up in the history, and
whichever save arrived last becomes the current version.

## Show the History

To list a note's versions, call [`puter.kv.list()`](/KV/list/) with the note's
prefix. `reverse: true` puts the newest first, and `limit` loads one page at a
time:

```js
const page = await puter.kv.list({
    pattern: `note-history:${ noteId }:`,
    returnValues: true,
    reverse: true,
    limit: 20,
});

for ( const { value } of page.items ) {
    console.log(value.number, new Date(value.savedAt), value.text);
}
```

If there are more versions, the page includes a `cursor`. Pass it back to load
the next page of older versions, for example from a "Show older" button:

```js
const older = await puter.kv.list({
    pattern: `note-history:${ noteId }:`,
    returnValues: true,
    limit: 20,
    cursor: page.cursor,
});
```

The cursor remembers the direction, so you don't need to pass `reverse` again.
Expired copies are skipped, so a page can come back with fewer than `limit`
items even when there are more. Add `fetchUntilFull: true` if you want full
pages. [Store a Large
Collection](/recipes/store-large-collection/#page-through-a-collection) covers
paging in more detail.

## Restore a Version

To restore a version, read its copy and save it again:

```js
async function restoreVersion (noteId, number) {
    const version = await puter.kv.get(versionKey(noteId, number));

    if ( version !== null ) {   // null once the copy has expired
        await saveNote(noteId, version.text);
    }
}
```

Restoring adds a new version on top instead of deleting the newer ones, a bit
like `git revert`. If the user changes their mind, nothing is lost.

To undo the last save, restore the version before it:

```js
const { items } = await puter.kv.list({
    pattern: `note-history:${ noteId }:`,
    returnValues: true,
    reverse: true,
    limit: 2,
});

if ( items.length === 2 ) {
    await saveNote(noteId, items[1].value.text);
}
```

## Keep Only the Last Few Versions

Instead of expiring copies by age, you can keep a fixed number of them. Version
numbers go up by one, so after saving version 57 with 50 kept, delete version 7:

```js
const KEEP = 50;

const number = await saveNote(noteId, text);

if ( number > KEEP ) {
    await puter.kv.del(versionKey(noteId, number - KEEP));
}
```

If you do this, drop the `expireAt` from `saveNote()`. If a delete fails, that
one copy just stays around.

## Delete a Note and Its History

There's no call to delete every key with a prefix, so list them and delete them
one at a time. `stream: true` reads the list a page at a time:

```js
for await ( const page of puter.kv.list({ pattern: `note-history:${ noteId }:`, stream: true }) ) {
    for ( const key of page.items ) {
        await puter.kv.del(key);
    }
}

await puter.kv.del(`note:${ noteId }`);
await puter.kv.del(`note-revision:${ noteId }`);
```

It's safe to delete keys while you're still listing them.

## Notes

- Every version is a full copy, so a long note that's saved often takes up a
  lot of space. Don't save on every keystroke. Save when the user pauses typing,
  or once a minute.
- The two writes in `saveNote()` go in one request, but they aren't a
  transaction. If the call fails, one of them might already be saved. Saving
  again fixes it.
- Each pattern ends with `:`. Without it, listing the note `abc` would also
  return the versions of a note called `abcd`.
