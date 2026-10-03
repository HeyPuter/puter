---
title: Keep a Version History
description: "Learn how to save every version of a document in the Puter.js key-value database, so users can look through old versions and restore one."
tags: [kv, data-modeling]
order: 36
---

Many editors let users go back to an earlier version, like the version history
in Google Docs or the commits in git. With [`puter.kv`](/KV/), each save can
write a copy of the document under its own numbered key, next to the current
version. Old copies can delete themselves after a while.

This recipe keeps notes, and uses three kinds of keys for each note:

| Key | Holds |
| --- | --- |
| `note:<id>` | The current version, read when the note opens |
| `note-history:<id>:00000007` | A copy of version 7. Each save adds one |
| `note-revision:<id>` | A counter holding the latest version number |

## Save a Version

Each save gets the next version number, then writes the current version and a
copy in one request:

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

Step by step:

- [`puter.kv.incr()`](/KV/incr/) gives each save its own number, even when two
  tabs save at the same moment. [Run Code Only Once](/recipes/run-code-once/)
  explains why.
- The number gets zeros in front so the keys sort in number order. As text, `10`
  would sort before `9`.
- [`puter.kv.set()`](/KV/set/) with an array writes both keys in one request.
  The copy has an `expireAt`, a Unix time in seconds, so it deletes itself after
  30 days. The current version has none, so the note itself never expires.

When two tabs save at the same moment, both versions go into the history, and
the current version is whichever write arrived last.

## Show the History

To list a note's versions, use the [`puter.kv.list()`](/KV/list/) method with the
note's prefix. `reverse: true` puts the newest version first, and `limit` reads
one page at a time:

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

When there are more versions, the page has a `cursor`. Pass it back to read the
next, older page, for example from a "Show older" button:

```js
const older = await puter.kv.list({
    pattern: `note-history:${ noteId }:`,
    returnValues: true,
    limit: 20,
    cursor: page.cursor,
});
```

The cursor remembers the direction, so you don't need to pass `reverse` again.
Expired copies are left out, which can make a page shorter than `limit` while
more versions remain. Add `fetchUntilFull: true` to fill the page anyway. [Store
a Large Collection](/recipes/store-large-collection/#page-through-a-collection)
covers paging in more detail.

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

Restoring adds a new version instead of deleting the ones after it, like `git
revert`. If the user changes their mind, the version they left is still in the
history.

To undo the last save, restore the second-newest version:

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

Instead of an expiry, you can keep a fixed number of versions. Version numbers go
up by one, so after saving version 57 and keeping 50, the copy to delete is
version 7:

```js
const KEEP = 50;

const number = await saveNote(noteId, text);

if ( number > KEEP ) {
    await puter.kv.del(versionKey(noteId, number - KEEP));
}
```

Remove the `expireAt` from `saveNote()` when you do this. If a delete fails, that
one copy is left behind and nothing else breaks.

## Delete a Note and Its History

There is no call that deletes every key with a prefix, so list the keys and
delete them one by one. `stream: true` reads the list a page at a time:

```js
for await ( const page of puter.kv.list({ pattern: `note-history:${ noteId }:`, stream: true }) ) {
    for ( const key of page.items ) {
        await puter.kv.del(key);
    }
}

await puter.kv.del(`note:${ noteId }`);
await puter.kv.del(`note-revision:${ noteId }`);
```

Deleting keys the list has already returned doesn't disturb the pages still to
come.

## Notes

- Every version is a full copy of the note, so a long note saved often takes a
  lot of room. Don't save on every keystroke. Save when the user stops typing
  for a moment (often called debouncing), or once a minute.
- The two writes in `saveNote()` go in one request, but they are not a
  transaction. If the call fails, one of them may already be saved. Saving again
  puts things right.
- Each pattern ends with `:`. Without it, listing the note `abc` would also
  return the versions of a note with the ID `abcd`.
