---
title: Keep an Activity Log
description: "Learn how to record what happens in your app with Puter.js, so users can see recent activity and what's new since their last visit."
tags: [kv, data-modeling]
order: 34
---

Many apps show a list of what happened, such as "Renamed Draft.txt", "Invited
alice" or "Exported 12 photos". The list only grows. Entries are added at the
end, read newest first, and never edited.

With [`puter.kv`](/KV/), give each entry its own key and start the key with the
time. The keys then sort in the order the entries were written, so you can read
the newest ones, or only the ones added since a certain entry, without loading
the rest. [Query a Collection](/recipes/query-collection/) explains how key
names decide what you can look up.

## Record an Entry

Build the key from the current time and a short random part, and write the
entry with [`puter.kv.set()`](/KV/set/):

```js
const PREFIX = 'activity:';

async function record (action, details = {}) {
    const key = `${ PREFIX }${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    await puter.kv.set(key, { action, ...details });
    return key;
}

await record('renamed', { from: 'Draft.txt', to: 'Report.txt' });
```

[`puter.kv.list()`](/KV/list/) returns keys in string order. The time is a
number with the same count of digits in every key, so string order is also time
order. The random part keeps two entries written in the same millisecond, for
example from two tabs, on different keys.

Each entry is its own key, so two tabs or devices that record at the same
moment both keep their entry. The time comes from the device's clock, so
entries from two devices are ordered by their clocks, which can differ by a few
seconds.

## Show the Latest Entries

List the prefix with `reverse: true` to get the newest entries first, and
`limit` to load one page at a time:

```js
async function loadRecent (cursor) {
    return await puter.kv.list({
        pattern: PREFIX,
        returnValues: true,
        reverse: true,
        limit: 20,
        cursor,
    });
}

const page = await loadRecent();

for ( const { key, value } of page.items ) {
    const at = new Date(parseInt(key.slice(PREFIX.length)));
    console.log(at, value.action);
}
```

The time is already in the key, so the entry doesn't need to store it. The
`parseInt()` call reads the digits up to the dash.

The page includes a `cursor` if there are older entries. Pass it back to load
the next page, for example from a "Show older" button:

```js
const older = await loadRecent(page.cursor);
```

[Store a Large Collection](/recipes/store-large-collection/#load-more) covers
paging in more detail.

## Load Only What's New

To find the entries added since one you already have, read newest first and
stop at its key:

```js
async function loadSince (lastKey) {
    const fresh = [];
    let cursor;

    do {
        const page = await loadRecent(cursor);

        for ( const entry of page.items ) {
            if ( entry.key <= lastKey ) return fresh;
            fresh.push(entry);
        }
        cursor = page.cursor;
    } while ( cursor );

    return fresh;
}
```

The function returns the new entries, newest first. It reads only as many pages
as there are new entries, however long the log is.

To show how many entries are new since the user's last visit, save the newest
key they've seen in a key of its own:

```js
const lastSeen = await puter.kv.get('activity-seen') ?? '';
const fresh = await loadSince(lastSeen);

showBadge(fresh.length);

if ( fresh.length > 0 ) {
    await puter.kv.set('activity-seen', fresh[0].key);
}
```

Here `showBadge()` is your own function that shows the count. On the first
visit `lastSeen` is an empty string, which sorts before every key, so the whole
log counts as new.

To add entries to an open page as they're recorded, subscribe to the prefix as
in [Watch for Changes](/recipes/watch-for-changes/#watch-several-keys).

## Let Old Entries Expire

A log that's never trimmed keeps growing. To keep only recent activity, give
each entry an expiry when you write it. This is the whole `record()` with that
added:

```js
async function record (action, details = {}) {
    const key = `${ PREFIX }${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    const in90Days = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;

    await puter.kv.set(key, { action, ...details }, in90Days);
    return key;
}
```

The third argument is a Unix time in seconds, and the entry is deleted once it
passes. [Store Temporary Data](/recipes/store-temporary-data/) covers expiry in
more detail. To delete the whole log at once, see
[Export or Delete Data](/recipes/export-or-delete-data/#delete-everything-of-one-kind).

## Full Code

```js
const PREFIX = 'activity:';

async function record (action, details = {}) {
    const key = `${ PREFIX }${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    const in90Days = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;

    await puter.kv.set(key, { action, ...details }, in90Days);
    return key;
}

async function loadRecent (cursor) {
    return await puter.kv.list({
        pattern: PREFIX,
        returnValues: true,
        reverse: true,
        limit: 20,
        cursor,
    });
}

async function loadSince (lastKey) {
    const fresh = [];
    let cursor;

    do {
        const page = await loadRecent(cursor);

        for ( const entry of page.items ) {
            if ( entry.key <= lastKey ) return fresh;
            fresh.push(entry);
        }
        cursor = page.cursor;
    } while ( cursor );

    return fresh;
}
```
