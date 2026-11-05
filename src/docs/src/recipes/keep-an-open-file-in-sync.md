---
title: Keep an Open File in Sync
description: "Learn how to build an editor with Puter.js events that reloads a file when it changes somewhere else, protects unsaved work, and follows the file when it's renamed or deleted."
tags: [events, fs]
order: 67
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Say your app is a text editor. While a file is open, the user might edit it in
another tab or on their phone, rename it on the Puter desktop, or move it to the
Trash. Desktop code editors handle this with a
"file changed on disk" message. This recipe builds the same thing with
[`puter.events.onLocal()`](/Events/onLocal/), which calls a function every time
the file changes while it's open.

It builds on [Watch for Changes](/recipes/watch-for-changes/), which covers
gaps and reconnects. The examples use a few functions you'd write yourself:
`editor.getValue()` and `editor.setValue()` for the text area, `setTitle()` for
the window title, and `showBanner()` to show a message with optional buttons.

## Watch the File by Its ID

Every file in Puter has a `uid`, an ID that doesn't change when the file is
renamed or moved. Subscribe to `fs:` plus the `uid`, and the subscription stays
on the open file wherever it goes. A path subject such as
`fs:~/Documents/notes.txt` is looked up again when the SDK reconnects, so after
a rename it would watch the old path instead.

The SDK doesn't wait for your handler to finish before calling it again. If two
events arrive close together, two reads run at the same time, and the older one
can finish last and put old text in the editor. So run file work through a
queue that runs one task at a time:

```js
let last = Promise.resolve();

function enqueue (task) {
    const previous = last;
    last = (async () => {
        try {
            await previous;
        } catch {
            // the previous task's caller handles its error
        }
        return task();
    })();
    return last;
}
```

The first version of the editor opens a file and loads it again whenever its
contents change:

```js
let file;          // the open file
let saved = '';    // the file's text as this tab last loaded or saved it
let sub;

async function readFile () {
    const blob = await puter.fs.read(file.uid);
    return blob.text();
}

async function reloadIfChanged () {
    const latest = await readFile();
    if (latest === saved) return;
    saved = latest;
    editor.setValue(latest);
}

async function handleFileEvent (event) {
    if (event.op === 'write') await reloadIfChanged();
}

function onWatchError (err) {
    showBanner(`Live updates stopped (${err.code}).`);
}

async function openFile (item) {
    await sub?.off();
    file = item;
    sub = await puter.events.onLocal(`fs:${item.uid}`, ({ event }) => enqueue(() => handleFileEvent(event)), {
        onError: onWatchError,
    });
    saved = await readFile();
    editor.setValue(saved);
    setTitle(item.name);
}

const item = await puter.ui.showOpenFilePicker();
await enqueue(() => openFile(item));
```

A `write` event means the contents changed. It doesn't include the new text, so
the handler reads the file again. Writes less than 250 ms apart arrive as one
event, and reading the whole file gets the latest text either way.

When the user picks a file with
[`showOpenFilePicker()`](/UI/showOpenFilePicker/), your app gets access to it,
so it can subscribe without requesting a permission. The `openFile()` function
subscribes before it reads, so a change made during the read still reaches the
handler. It reads by `uid` with [`puter.fs.read()`](/FS/read/), because the
picked item's own `read()` method uses the path the file had when it was picked.

## Save Without Losing Edits

To save, write the editor's text with [`puter.fs.write()`](/FS/write/). Saving
overwrites the file in place, so its `uid` and the subscription stay the same.
The [`write()`](/FS/write/) method takes a path, and writing to a path the file
has left creates a new file there. Renaming or moving the folder the file is in
changes its path without sending an event for the file, so look the path up by
`uid` with [`puter.fs.stat()`](/FS/stat/) before each save.

This tab also gets a `write` event for its own saves. The `event.self` field
can't tell them apart from other changes, because it's `true` for every change
the signed-in user makes, from any tab or device. Instead, save through the
queue and set `saved` after the write. The event for the save is handled after
the save finishes, when the file matches `saved`, so `reloadIfChanged()` skips
it.

When the file changes somewhere else while the user has unsaved edits, loading
it would delete those edits. Puter doesn't lock or merge files, so ask which
version to keep. This version of `reloadIfChanged()` compares the editor with
`saved` to find unsaved edits:

```js
async function currentPath () {
    const info = await puter.fs.stat({ uid: file.uid });
    return info.path;
}

function save () {
    return enqueue(async () => {
        const path = await currentPath();   // its folder may have moved
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}

function showConflict () {
    showBanner('This file was changed somewhere else.', {
        'Load their version': () => enqueue(async () => {
            saved = await readFile();
            editor.setValue(saved);
        }),
        'Keep mine': () => save(),
    });
}

async function reloadIfChanged () {
    const latest = await readFile();
    if (latest === saved) return;           // nothing new, or this tab's own save
    if (editor.getValue() !== saved) return showConflict();

    saved = latest;
    editor.setValue(latest);
}
```

"Load their version" reads the file again when clicked, in case it changed
while the banner was open. "Keep mine" writes the editor's text over the other
version.

If two tabs save at almost the same time, the last write wins and the other tab
reloads it. A change written somewhere else right before your save is
overwritten without a warning. To catch that, read the file just before writing
and compare it with `saved`.

## Follow Renames, the Trash and Deletes

A `move` event means the file was renamed or moved, and its `path` is the new
path. Deleting a file on the Puter desktop moves it to the user's Trash folder
(`/<username>/Trash`), so that's a `move` too, and restoring it is another one.

A file is permanently deleted when the user empties the Trash, or when an app
calls [`puter.fs.delete()`](/FS/delete/). A `remove` event arrives, and then the
subscription ends with `onError` called with `code: 'subscription_ended'` and
`reason: 'anchor_deleted'`. If the file was deleted while the connection was
down, `onError` gets `subject_does_not_exist` when the SDK reconnects instead.
Either way, no more events arrive, so `onWatchError()` handles deletes.

A [gap](/recipes/watch-for-changes/#handle-gaps) means events may have been
missed, for example while the laptop was asleep, so look up where the file is
and read it again. This replaces `onWatchError()` and `handleFileEvent()`:

```js
const inTrash = (path) => /^\/[^/]+\/Trash\//.test(path);

function showPath (path) {
    if (inTrash(path)) showBanner('This file is in the Trash. Save to keep your text as a new file.');
    else setTitle(path.split('/').pop());
}

function onWatchError (err) {
    if (err.reason === 'anchor_deleted' || err.code === 'subject_does_not_exist') {
        return showBanner('This file was deleted. Save to keep your text as a new file.');
    }
    showBanner(`Live updates stopped (${err.code}).`);
}

async function handleFileEvent (event) {
    if (event.op === 'write') return reloadIfChanged();
    if (event.op === 'move') return showPath(event.path);
    if (event.op === 'gap') {
        showPath(await currentPath());
        await reloadIfChanged();
    }
}
```

The text is still in the editor, so when the file is in the Trash or deleted,
`save()` offers to save it as a new file.
[`showSaveFilePicker()`](/UI/showSaveFilePicker/) writes the text where the user
chooses, and its `undefinedOnCancel` promise resolves to the new file, or to
`undefined` if the user cancels. Once the file is deleted,
[`puter.fs.stat()`](/FS/stat/) rejects, so `save()` catches that:

```js
async function saveAsNewFile () {
    const item = await puter.ui.showSaveFilePicker(editor.getValue(), file.name).undefinedOnCancel;
    if (item) await openFile(item);
}

function save () {
    return enqueue(async () => {
        let path = null;
        try {
            path = await currentPath();     // its folder may have moved
        } catch {
            // the file was deleted
        }
        if (!path || inTrash(path)) return saveAsNewFile();

        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}
```

The new file then becomes the open file, with its own subscription. You can
also add a third button to `showConflict()` that calls `saveAsNewFile()` from
the queue, to keep the user's text without overwriting the other version.

## Full Code

```js
let last = Promise.resolve();

function enqueue (task) {
    const previous = last;
    last = (async () => {
        try {
            await previous;
        } catch {
            // the previous task's caller handles its error
        }
        return task();
    })();
    return last;
}

let file;          // the open file
let saved = '';    // the file's text as this tab last loaded or saved it
let sub;

async function readFile () {
    const blob = await puter.fs.read(file.uid);
    return blob.text();
}

async function currentPath () {
    const info = await puter.fs.stat({ uid: file.uid });
    return info.path;
}

const inTrash = (path) => /^\/[^/]+\/Trash\//.test(path);

async function saveAsNewFile () {
    const item = await puter.ui.showSaveFilePicker(editor.getValue(), file.name).undefinedOnCancel;
    if (item) await openFile(item);
}

function save () {
    return enqueue(async () => {
        let path = null;
        try {
            path = await currentPath();     // its folder may have moved
        } catch {
            // the file was deleted
        }
        if (!path || inTrash(path)) return saveAsNewFile();

        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}

function showConflict () {
    showBanner('This file was changed somewhere else.', {
        'Load their version': () => enqueue(async () => {
            saved = await readFile();
            editor.setValue(saved);
        }),
        'Keep mine': () => save(),
    });
}

async function reloadIfChanged () {
    const latest = await readFile();
    if (latest === saved) return;           // nothing new, or this tab's own save
    if (editor.getValue() !== saved) return showConflict();

    saved = latest;
    editor.setValue(latest);
}

function showPath (path) {
    if (inTrash(path)) showBanner('This file is in the Trash. Save to keep your text as a new file.');
    else setTitle(path.split('/').pop());
}

function onWatchError (err) {
    if (err.reason === 'anchor_deleted' || err.code === 'subject_does_not_exist') {
        return showBanner('This file was deleted. Save to keep your text as a new file.');
    }
    showBanner(`Live updates stopped (${err.code}).`);
}

async function handleFileEvent (event) {
    if (event.op === 'write') return reloadIfChanged();
    if (event.op === 'move') return showPath(event.path);
    if (event.op === 'gap') {
        showPath(await currentPath());
        await reloadIfChanged();
    }
}

async function openFile (item) {
    await sub?.off();
    file = item;
    sub = await puter.events.onLocal(`fs:${item.uid}`, ({ event }) => enqueue(() => handleFileEvent(event)), {
        onError: onWatchError,
    });
    saved = await readFile();
    editor.setValue(saved);
    setTitle(item.name);
}

const item = await puter.ui.showOpenFilePicker();
await enqueue(() => openFile(item));
```
