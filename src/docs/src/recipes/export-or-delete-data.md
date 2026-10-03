---
title: Export or Delete Data
description: "Learn how to let users download their data from the Puter.js key-value database, import it back, and delete it: one kind of record, everything older than a date, or all of it."
tags: [kv, data-modeling]
order: 33
---

Users expect to be able to take their data with them and to delete it: a
"Download my data" button, a "Clear history" button, an "Erase everything"
option in settings. With [`puter.kv`](/KV/), all of these come down to listing
keys by prefix and acting on each one.

This recipe uses a journal app. Each entry has a key that starts with its date,
so the keys sort from oldest to newest:

```js
await puter.kv.set(`entry:${ new Date().toISOString() }:${ crypto.randomUUID() }`, {
    title: 'First day',
    text: 'Started a journal.',
});
// entry:2026-10-02T09:15:00.000Z:5f0c…
```

## Export to a File

Read every entry a page at a time with `stream: true`, and keep both the key and
the value of each one:

```js
async function exportEntries () {
    const entries = [];

    for await ( const page of puter.kv.list({ pattern: 'entry:', returnValues: true, stream: true }) ) {
        entries.push(...page.items);   // each item is { key, value }
    }
    return JSON.stringify(entries, null, 2);
}
```

Keeping the keys means the file can be imported back exactly as it was. To hand
the file to the user, use a normal browser download:

```js
const json = await exportEntries();
const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));

const link = document.createElement('a');
link.href = url;
link.download = 'journal.json';
link.click();
URL.revokeObjectURL(url);
```

Or let the user pick where to save it in their Puter files with
[`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/):

```js
await puter.ui.showSaveFilePicker(json, 'journal.json');
```

To export everything your app stored, not just entries, leave out the `pattern`.

## Import from a File

An exported file is a list of `{ key, value }` items, which is exactly what a
batch [`puter.kv.set()`](/KV/set/) takes. Write it back in groups of 100, so one
big file doesn't become one huge request:

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

The `filter()` keeps only keys that start with `entry:`. A file can be edited
before it's imported, and without the filter, an edited file could overwrite
other keys, such as the user's settings. An imported entry replaces an entry
with the same key.

## Delete Everything of One Kind

There is no call that deletes every key with a prefix, so list the keys and
delete them one by one:

```js
for await ( const page of puter.kv.list({ pattern: 'entry:', stream: true }) ) {
    for ( const key of page.items ) {
        await puter.kv.del(key);
    }
}
```

Deleting keys the list has already returned doesn't disturb the pages still to
come. Each delete is one call, and calls are [rate
limited](/rate-limits-and-quotas/#key-value-store) to 400 per 10 seconds on
most accounts, so
thousands of keys take a while. Show progress if there might be many.

## Delete Entries Older Than a Date

Because each key starts with a date, the list returns the oldest entries first.
Delete until you reach the first key at or after the cutoff, then stop:

```js
const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
const cutoff = `entry:${ ninetyDaysAgo.toISOString() }`;

deleting:
for await ( const page of puter.kv.list({ pattern: 'entry:', stream: true }) ) {
    for ( const key of page.items ) {
        if ( key >= cutoff ) {
            break deleting;
        }
        await puter.kv.del(key);
    }
}
```

Keys compare as text, and ISO dates compare as text in time order, so `key >=
cutoff` is a date comparison. The `deleting:` label lets `break` leave both
loops at once.

If you know when data should go at the time you write it, give it an expiry
instead and it deletes itself. See [Store Temporary
Data](/recipes/store-temporary-data/).

## Delete Everything Your App Stored

To wipe all of your app's data for this user, such as for a "Reset app" button,
use the [`puter.kv.flush()`](/KV/flush/) method:

```js
if ( confirm('Delete all your journal data? This cannot be undone.') ) {
    await puter.kv.flush();
}
```

This deletes only your app's own data. Other apps' data in the same account is
not touched.

## Notes

- Deleting can't be undone. Offer an export before a big delete.
- An export doesn't include expiry times. Imported entries don't expire unless
  you add `expireAt` to the items before writing them.
- Your own app reads its [private entries](/recipes/share-data-between-apps/#keep-an-entry-private)
  like any other, so an export without a `pattern` includes them. Leave out keys
  such as tokens before you hand the file to the user.
- Data split across several keys, as in [Split a Large Value Across
  Keys](/recipes/split-a-large-value/), exports and deletes the same way: by its
  prefix.
