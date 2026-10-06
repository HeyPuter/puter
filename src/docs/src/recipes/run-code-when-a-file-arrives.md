---
title: Run Code When a File Arrives
description: "Learn how to watch a folder with Puter.js, so your app reacts the moment a file is added to it instead of polling for changes."
tags: [fs, events]
order: 47
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Lots of apps have a drop folder: somewhere the user saves a file and expects
something to happen to it. You could poll the folder with
[`puter.fs.readdir()`](/FS/readdir/), but you'd be listing it over and over to
notice one change.

Instead, subscribe to the folder with [`puter.events`](/Events/) and let Puter
tell you. This recipe builds an inbox that turns each `.csv` a user drops in it
into a summary file.

## Watch the folder

Call [`puter.events.onLocal()`](/Events/onLocal/) with an `fs:` subject. The
`:add` on the end limits it to files appearing, and `*.csv` limits it to the
files you care about:

```js
await puter.events.onLocal('fs:~/inbox/*.csv:add', ({ event }) => summarize(event.path));

async function summarize(path) {
    const blob = await puter.fs.read(path);
    const text = await blob.text();
    const name = path.split('/').pop().replace(/\.csv$/, '');

    await puter.fs.write(`~/inbox/${name}.summary.json`, JSON.stringify({
        rows: text.trim().split('\n').length - 1,
        at: Date.now(),
    }));
}
```

The handler is called with `{ event }`. For a file change, `event.path` is the
file that changed and `event.op` is what happened to it. Drop a CSV into
`~/inbox` and the summary appears next to it.

The folder doesn't have to exist yet. A subject can name a path that isn't
there, and the subscription waits for it, so you don't have to create `~/inbox`
before you start watching.

## Don't react to your own writes

The summary file is written into the same folder being watched. That write is
itself a change, so without a guard an app that watches a folder and writes to
it can set itself off.

Every event carries `self`, which is `true` when the account holding the
subscription made the change. Check it first:

```js
await puter.events.onLocal('fs:~/inbox/*.csv:add', ({ event }) => {
    if (event.self) return;
    return summarize(event.path);
});
```

This matters most when the thing you write matches the thing you watch. Here the
summary is a `.json` and the subject only matches `.csv`, so it wouldn't loop
anyway — but a folder-wide subject like `fs:~/inbox` would.

## Catch up after a gap

A subscription never fails because of a limit. When something is dropped — too
many events at once, or a reconnect after the user's network dropped — you get a
**gap marker** instead: an event with `op: 'gap'` and no `path`.

A gap means "re-read what you're watching", not "nothing changed". Handle it by
listing the folder and processing anything you haven't seen:

```js
await puter.events.onLocal('fs:~/inbox/*.csv:add', ({ event }) => {
    if (event.op === 'gap') return catchUp();
    if (event.self) return;
    return summarize(event.path);
});

async function catchUp() {
    const items = await puter.fs.readdir('~/inbox');
    const done = new Set(items
        .filter(i => i.name.endsWith('.summary.json'))
        .map(i => i.name.replace(/\.summary\.json$/, '')));

    for (const item of items) {
        if (!item.name.endsWith('.csv')) continue;
        if (done.has(item.name.replace(/\.csv$/, ''))) continue;
        await summarize(item.path);
    }
}
```

Working out what's already done from the folder itself, rather than from a
counter, means a gap costs one listing and never a lost file.

## Stop watching

[`onLocal()`](/Events/onLocal/) resolves to the subscription, and its `off()`
method ends it:

```js
const sub = await puter.events.onLocal('fs:~/inbox/*.csv:add', handler);

// Later, when the user leaves this screen:
await sub.off();
```

A local subscription ends with the page anyway. To keep a folder watched while
your app is closed, use
[`puter.events.onPersistent()`](/Events/onPersistent/) instead.

## Notes

- `*` matches within one path segment and `**` crosses directories, so
  `fs:~/inbox/**/*.csv` picks up files in subfolders too.
- Leave the `:add` off to get every change to the folder: `add`, `write`,
  `move` and `remove`.
- Writes to the same file within 250 ms arrive as one event, so a large upload
  is one delivery rather than one per chunk.
- Events never say *who* made a change. On a folder shared with other people,
  that would tell every subscriber who else has access.
