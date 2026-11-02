---
title: Watch a Folder for New Files
description: "Learn how to process each file a user adds to a folder with Puter.js, so your app handles new files as soon as they're added."
tags: [fs, events]
order: 47
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Your app can read and write files in the user's Puter account with
[`puter.fs`](/FS/), the Puter file system API. A common feature built on it is
an import folder. The user adds a file to a folder, and your app reads the file
and saves what's in it.

This recipe builds a CSV importer. When the user adds a `.csv` file to the
`inbox` folder, the app reads it and writes a summary file next to it. To know
when a file is added, the app watches the folder with the [Events API](/Events/).
It builds on [Watch for Changes](/recipes/watch-for-changes/), which shows how
to watch a folder to update what your app shows.

Your app processes the files while it's open, so it can use any library, such
as a CSV parser. Files added while your app is closed are processed the next
time it opens. To process them while your app is closed, see
[Run Code in the Background](/recipes/run-code-in-the-background/).

## Watch the Folder

First, create the folder with [`puter.fs.mkdir()`](/FS/mkdir/). Then subscribe
to it with [`puter.events.onLocal()`](/Events/onLocal/), which calls a function
each time something in the folder changes. It takes a subject, which is a
string that says what to watch, and the function to call. The subject
`fs:inbox/*.csv:add` matches new `.csv` files in `inbox`:

```js
async function summarize(path) {
    const blob = await puter.fs.read(path);
    const text = await blob.text();
    const name = path.split('/').pop().replace(/\.csv$/, '');

    await puter.fs.write(`inbox/${name}.summary.json`, JSON.stringify({
        rows: text.trim().split('\n').length - 1,
        at: Date.now(),
    }));
}

await puter.fs.mkdir('inbox', { createMissingParents: true });
await puter.events.onLocal('fs:inbox/*.csv:add', ({ event }) => summarize(event.path));
```

The function is called with `{ event }`, and `event.path` is the full path of
the new file. The `summarize()` function reads the file with
[`puter.fs.read()`](/FS/read/) and writes a summary with
[`puter.fs.write()`](/FS/write/). In your app, this is where you'd parse the
rows and save them. Add a CSV file to `inbox`, and its summary appears in the
same folder.

Each app has its own folder in the user's account, and a relative path such as
`inbox` is inside it. A relative path works the same way in a subject as in
[`puter.fs`](/FS/). If the folder already exists,
[`mkdir()`](/FS/mkdir/) returns it, so the code works every time the app opens.

In the subject, `*` matches any file name, and the `:add` suffix limits the
subscription to new files. The summary ends in `.json`, so the subject doesn't
match it, and writing it doesn't call the function again. All the patterns and
suffixes are listed on [Subjects and events](/Events/subjects/).

On a website, the user has to be signed in. If nobody is,
[`onLocal()`](/Events/onLocal/) opens the Puter sign-in window.

## Process Files Moved Into the Folder

Uploads and copies arrive as `add`. A file moved in from another folder, for
example by dragging it on the Puter desktop, arrives as a `move`, so the `:add`
subject misses it. To process both, leave the suffix off and check `event.op`:

```js
await puter.events.onLocal('fs:inbox/*.csv', ({ event }) => {
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;
    return summarize(event.path);
});
```

A `move` has a `from` field when the file was already inside the watched
folder, for example when it's renamed inside `inbox`. The function skips those,
along with `write` and `remove` events. A file moved in from another folder has
no `from`.

This depends on `inbox` existing when you subscribe. A subscription on a folder
that doesn't exist yet watches from the nearest folder above it, so a file moved
in from a folder next to `inbox` would have a `from`. That's why the code
creates `inbox` first.

## Catch Up on Missed Files

Files added while your app is closed send no events. Sometimes an event also
can't be delivered, for example when the connection drops while a laptop
sleeps. The function then gets a gap marker in its place. A gap marker is an
event with `op: 'gap'` and no `path`, so it doesn't say which files were added.
[Watch for Changes](/recipes/watch-for-changes/#handle-gaps) has more on gaps.

To catch up, list the folder with [`puter.fs.readdir()`](/FS/readdir/) and
process every CSV file that has no summary yet. Run it once after subscribing,
and again on each gap:

```js
async function catchUp() {
    const items = await puter.fs.readdir('inbox');
    const done = new Set(items
        .filter(i => i.name.endsWith('.summary.json'))
        .map(i => i.name.replace(/\.summary\.json$/, '')));

    for (const item of items) {
        if (!item.name.endsWith('.csv')) continue;
        if (done.has(item.name.replace(/\.csv$/, ''))) continue;
        await summarize(item.path);
    }
}

function handler({ event }) {
    if (event.op === 'gap') return catchUp();
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;
    return summarize(event.path);
}

const sub = await puter.events.onLocal('fs:inbox/*.csv', handler);
await catchUp();
```

The summary files record which CSV files are already processed, so the app
doesn't need to store that anywhere else.

The code subscribes before the first `catchUp()`, so a file added during the
listing still reaches the function. That file can be processed twice, so make
processing safe to repeat. Here the second summary overwrites the first. In
your app, save the rows under a key made from the file name, so processing the
file again replaces its rows instead of adding a second copy.

## Stop Watching

To stop, call [`off()`](/Events/off/) on the subscription, for example when the
user leaves the screen that shows the inbox:

```js
// Later, when the user leaves this screen:
await sub.off();
```

Closing the tab ends the subscription on its own.

## Full Code

```js
async function summarize(path) {
    const blob = await puter.fs.read(path);
    const text = await blob.text();
    const name = path.split('/').pop().replace(/\.csv$/, '');

    await puter.fs.write(`inbox/${name}.summary.json`, JSON.stringify({
        rows: text.trim().split('\n').length - 1,
        at: Date.now(),
    }));
}

async function catchUp() {
    const items = await puter.fs.readdir('inbox');
    const done = new Set(items
        .filter(i => i.name.endsWith('.summary.json'))
        .map(i => i.name.replace(/\.summary\.json$/, '')));

    for (const item of items) {
        if (!item.name.endsWith('.csv')) continue;
        if (done.has(item.name.replace(/\.csv$/, ''))) continue;
        await summarize(item.path);
    }
}

function handler({ event }) {
    if (event.op === 'gap') return catchUp();
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;
    return summarize(event.path);
}

await puter.fs.mkdir('inbox', { createMissingParents: true });
const sub = await puter.events.onLocal('fs:inbox/*.csv', handler);
await catchUp();

// Later, when the user leaves this screen:
await sub.off();
```
