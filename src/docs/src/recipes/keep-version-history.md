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
after 30 days. The current version has no expiry, so the note itself stays. The
two writes aren't a transaction, so if the call fails, one of them may already
be saved, and saving again fixes it.

If two tabs save at the same moment, both versions end up in the history, and
whichever save arrived last becomes the current version.

Every version is a full copy, so a long note saved often takes up a lot of
space. Save when the user pauses typing, or once a minute, rather than on every
keystroke.

## Show the History

To list a note's versions, call [`puter.kv.list()`](/KV/list/) with the note's
prefix. With `reverse: true` the newest version comes first, and `limit` loads
one page at a time:

```js
async function loadHistory (noteId, cursor) {
    return await puter.kv.list({
        pattern: `note-history:${ noteId }:`,
        returnValues: true,
        reverse: true,
        limit: 20,
        cursor,
    });
}

const page = await loadHistory(noteId);

for ( const { value } of page.items ) {
    console.log(value.number, new Date(value.savedAt), value.text);
}
```

The pattern ends with `:`, so listing the note `abc` doesn't also return the
versions of a note called `abcd`.

If there are more versions, the page includes a `cursor`. Pass it back to load
the next page of older versions, for example from a "Show older" button:

```js
const older = await loadHistory(noteId, page.cursor);
```

Expired copies are skipped, so a page can hold fewer than `limit` items while
more are left. Add `fetchUntilFull: true` to fill each page when it can be.
[Store a Large Collection](/recipes/store-large-collection/#load-more) covers
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

To undo the last save, restore the version before the current one:

```js
async function undoLastSave (noteId) {
    const note = await puter.kv.get(`note:${ noteId }`);

    if ( note !== null && note.version > 1 ) {
        await restoreVersion(noteId, note.version - 1);
    }
}
```

## Keep Only the Last Few Versions

To also cap how many copies a note keeps, delete the copy that falls out of the
window after each save. Version numbers go up by one, so after saving version 57
with 50 kept, version 7 goes. This is the whole `saveNote()` with that added:

```js
const KEEP = 50;

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

    if ( number > KEEP ) {
        await puter.kv.del(versionKey(noteId, number - KEEP));
    }
    return number;
}
```

If a delete fails, that one copy stays until it expires.

## Delete a Note and Its History

There's no call that deletes every key with a prefix, so list the keys and
delete them one at a time. With `stream: true`, the list is read a page at a
time:

```js
async function deleteNote (noteId) {
    for await ( const page of puter.kv.list({ pattern: `note-history:${ noteId }:`, stream: true }) ) {
        for ( const key of page.items ) {
            await puter.kv.del(key);
        }
    }

    await puter.kv.del(`note:${ noteId }`);
    await puter.kv.del(`note-revision:${ noteId }`);
}
```

Deleting keys while the list is still being read is safe.

## Full Code

```js
const KEEP = 50;

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

    if ( number > KEEP ) {
        await puter.kv.del(versionKey(noteId, number - KEEP));
    }
    return number;
}

async function loadHistory (noteId, cursor) {
    return await puter.kv.list({
        pattern: `note-history:${ noteId }:`,
        returnValues: true,
        reverse: true,
        limit: 20,
        cursor,
    });
}

async function restoreVersion (noteId, number) {
    const version = await puter.kv.get(versionKey(noteId, number));

    if ( version !== null ) {   // null once the copy has expired
        await saveNote(noteId, version.text);
    }
}

async function undoLastSave (noteId) {
    const note = await puter.kv.get(`note:${ noteId }`);

    if ( note !== null && note.version > 1 ) {
        await restoreVersion(noteId, note.version - 1);
    }
}

async function deleteNote (noteId) {
    for await ( const page of puter.kv.list({ pattern: `note-history:${ noteId }:`, stream: true }) ) {
        for ( const key of page.items ) {
            await puter.kv.del(key);
        }
    }

    await puter.kv.del(`note:${ noteId }`);
    await puter.kv.del(`note-revision:${ noteId }`);
}
```
