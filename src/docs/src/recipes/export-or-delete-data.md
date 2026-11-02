---
title: Export or Delete Data
description: "Learn how to let users export, import and delete their data in the Puter.js key-value database."
tags: [kv, data-modeling]
order: 33
---

Users often want to download their data or delete it, with something like a
"Download my data" or "Clear history" button. With [`puter.kv`](/KV/), both
work the same way. You list the keys with a prefix, then do something with each
one.

This recipe uses a journal app. Each entry's key starts with its date, so the
keys sort from oldest to newest:

```js
await puter.kv.set(`entry:${ new Date().toISOString() }:${ crypto.randomUUID() }`, {
    title: 'First day',
    text: 'Started a journal.',
});
// entry:2026-10-02T09:15:00.000Z:5f0c...
```

## Export to a File

Read every entry a page at a time with `stream: true` in the options of
[`puter.kv.list()`](/KV/list/), keeping both the key and the value:

```js
async function exportEntries () {
    const entries = [];

    for await ( const page of puter.kv.list({ pattern: 'entry:', returnValues: true, stream: true }) ) {
        entries.push(...page.items);   // each item is { key, value }
    }
    return JSON.stringify(entries, null, 2);
}
```

Keeping the keys means the file can be imported back exactly as it was. To give
the file to the user, start a normal browser download:

```js
const json = await exportEntries();
const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));

const link = document.createElement('a');
link.href = url;
link.download = 'journal.json';
link.click();
URL.revokeObjectURL(url);
```

Or let them pick where to save it in their Puter files with
[`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/):

```js
await puter.ui.showSaveFilePicker(json, 'journal.json');
```

To export everything your app has stored, not just entries, leave out the
`pattern`. That includes entries your app keeps
[private](/recipes/share-data-between-apps/#keep-an-entry-private), such as
tokens, so leave those out before giving the file to the user.

## Import from a File

An exported file is a list of `{ key, value }` items, which is what
[`puter.kv.set()`](/KV/set/) takes for a batch write. A batch takes at most
[1,000 items](/rate-limits-and-quotas/#key-value-store), so write the file back
in groups of 100:

```js
async function importEntries (file) {
    const items = JSON.parse(await file.text())
        .filter(({ key }) => typeof key === 'string' && key.startsWith('entry:'));

    for ( let i = 0; i < items.length; i += 100 ) {
        await puter.kv.set(items.slice(i, i + 100));
    }
}

fileInput.addEventListener('change', () => importEntries(fileInput.files[0]));
```

The `filter()` keeps only keys that start with `entry:`, so an edited file can't
overwrite other keys, like the user's settings. Imported entries replace any
existing entries with the same key. The file has no expiry times, so imported
entries don't expire unless you add an `expireAt` to each item.

## Delete Everything of One Kind

There's no call that deletes every key with a prefix, so list the keys and
delete them one by one with [`puter.kv.del()`](/KV/del/):

```js
for await ( const page of puter.kv.list({ pattern: 'entry:', stream: true }) ) {
    for ( const key of page.items ) {
        await puter.kv.del(key);
    }
}
```

Deleting keys while the list is still being read is safe. Each delete is a
separate call, and calls are [rate
limited](/rate-limits-and-quotas/#key-value-store) to 400 per 10 seconds on most
accounts, so deleting thousands of keys takes a while. Show some progress if
there could be a lot.

## Delete Entries Older Than a Date

Since the keys start with a date, the list returns the oldest entries first.
Delete until you reach a key at or after the cutoff, then stop:

```js
async function deleteOlderThan (date) {
    const cutoff = `entry:${ date.toISOString() }`;

    for await ( const page of puter.kv.list({ pattern: 'entry:', stream: true }) ) {
        for ( const key of page.items ) {
            if ( key >= cutoff ) return;
            await puter.kv.del(key);
        }
    }
}

await deleteOlderThan(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
```

ISO dates sort in time order when compared as text, so `key >= cutoff` works as
a date comparison.

If you know when data should go at the time you save it, give it an expiry
instead, so it deletes itself. See [Store Temporary
Data](/recipes/store-temporary-data/).

## Delete Everything Your App Stored

To delete all of your app's data for this user, like for a "Reset app" button,
use the [`puter.kv.flush()`](/KV/flush/) method. Deleting can't be undone, so
offer an export first:

```js
if ( confirm('Delete all your journal data? This cannot be undone.') ) {
    await puter.kv.flush();
}
```

This only deletes your app's data. Other apps' data in the same account isn't
touched.
