---
title: Keep an Open File in Sync
description: "Learn how to build an editor with Puter.js events that reloads a file when it changes somewhere else, protects unsaved work, and follows the file when it's renamed or deleted."
tags: [events, fs]
order: 67
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Say your app is a text editor. While a file is open, the user might change it
somewhere else: edit it in another tab or on their phone, rename it on the
Puter desktop, or move it to the Trash. Desktop code editors handle this with a
"file changed on disk" message. This recipe builds the same thing with
[`puter.events.onLocal()`](/Events/onLocal/), which calls a function every time
the file changes.

It builds on [Watch for Changes](/recipes/watch-for-changes/), which
covers gaps, reconnects and cost. The examples use a few functions you'd write
yourself: `editor.getValue()` and `editor.setValue()` for the text area,
`setTitle()` for the window title, and `showBanner()` to show a message with
optional buttons.

The recipe starts with a small editor that works, then adds one case per
section. Each section shows only the functions it adds or changes. The
[full code](#full-code) is at the end.

## Watch the File by Its ID

Every file in Puter has a `uid`, an ID that doesn't change when the file is
renamed or moved. To get events for a file, subscribe to `fs:` plus its `uid`.
This first version loads the file again whenever its contents change:

```js
let file;          // the open file
let path;          // where the file is now
let saved = '';    // the file's text as this tab last loaded or saved it
let sub;

async function readFile () {
    const blob = await puter.fs.read(file.uid);
    return blob.text();
}

async function handleFileEvent (event) {
    if (event.op === 'write') {
        saved = await readFile();
        editor.setValue(saved);
    }
}

function onFileEvent ({ event }) {
    return handleFileEvent(event);
}

function onWatchError (err) {
    showBanner(`Live updates stopped (${err.code}).`);
}

async function openFile (item) {
    await sub?.off();
    file = item;
    path = item.path;
    sub = await puter.events.onLocal(`fs:${item.uid}`, onFileEvent, {
        onError: onWatchError,
    });
    saved = await readFile();
    editor.setValue(saved);
    setTitle(item.name);
}

const item = await puter.ui.showOpenFilePicker();
await openFile(item);
```

A `write` event means the contents changed. It doesn't include the new text,
so `handleFileEvent()` reads the file again.

When the user picks a file with
[`showOpenFilePicker()`](/UI/showOpenFilePicker/), your app gets access to that
file, so it can subscribe to it without requesting a permission.

A few things to note about `openFile()`:

- It subscribes before it reads the file. If the file changes while it's being
  read, the subscription gets an event for that change, and the handler reads
  the file again.
- It reads the file by `uid` with [`puter.fs.read()`](/FS/read/). The picked
  item also has a `read()` method, but that method uses the path the file had
  when it was picked, so it fails after the file is renamed.
- The `onError` callback runs if the subscription stops, and shows a banner
  with the error code.

A subscription by `uid` also stays on the same file after a reconnect. When the
connection drops and comes back, the SDK subscribes again. For a path subject
like `fs:~/Documents/notes.txt`, it looks up the path again at that point. If
the file was renamed while the connection was down, the new subscription is for
the old path, not for the open file.

## Handle One Thing at a Time

The SDK doesn't wait for your handler to finish before calling it again. If two
events arrive close together, two reads run at the same time, and the older
read can finish last and put old text in the editor. Saving, added in the next
section, has the same problem when a reload runs during a save. To prevent
this, run opening, saving and event handling through a queue that runs one task
at a time:

```js
let last = Promise.resolve();

function enqueue (task) {
    const previous = last;
    last = (async () => {
        try {
            await previous;
        } catch {
            // ignore the previous task's error and keep going
        }
        return task();
    })();
    return last;
}
```

Then call `handleFileEvent()` and `openFile()` through the queue. This replaces
`onFileEvent()` and the call to `openFile()`:

```js
function onFileEvent ({ event }) {
    return enqueue(() => handleFileEvent(event));
}

const item = await puter.ui.showOpenFilePicker();
await enqueue(() => openFile(item));
```

## Save and Tell Your Own Saves Apart

To save, write the editor's text to the file's path with
[`puter.fs.write()`](/FS/write/). Saving overwrites the file in place, so the
`uid` stays the same and the subscription keeps working.

When this tab saves, it also gets a `write` event for that save. That event
costs the user the same as any other, under the
[User-Pays Model](/user-pays-model/). The `event.self` field can't separate
this tab's saves from other changes, because it's `true` for every change the
signed-in user makes, from any tab or device.

Instead, save through the queue and set `saved` after the write. The handler
for the save's event runs after the save task finishes, and by then `saved`
holds the text that was written. The new `reloadIfChanged()` function reads the
file and returns without updating the editor when the text matches `saved`:

```js
function save () {
    return enqueue(async () => {
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}

async function reloadIfChanged () {
    const latest = await readFile();
    if (latest === saved) return;           // nothing new, or this tab's own save
    saved = latest;
    editor.setValue(latest);
}

async function handleFileEvent (event) {
    if (event.op === 'write') return reloadIfChanged();
}
```

Writes less than 250 ms apart arrive as one event, so one event can come from
several writes. The handler reads the whole file, so it gets the latest text
either way.

If two tabs save at almost the same time, the file has the text from the last
write, and the other tab reloads it. A change written somewhere else right
before your save is overwritten without a warning. To catch that, read the file
just before writing and compare it with `saved`.

## Handle Unsaved Changes

So far, the editor replaces its text whenever the file changes, which deletes
edits the user hasn't saved. Puter doesn't lock or merge files, so the last
write replaces the file. When the user has unsaved edits, ask which version to
keep.

The `saved` variable holds the text this tab last loaded or wrote. Comparing the
editor with `saved` tells you whether the user has unsaved edits, and comparing
the file with `saved` tells you whether the file actually changed. This version
of `reloadIfChanged()` checks both:

```js
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

    if (editor.getValue() === saved) {      // no unsaved edits, so load it
        saved = latest;
        editor.setValue(latest);
    } else {
        showConflict();                     // changed in both places
    }
}
```

"Load their version" reads the file again when clicked, in case it changed
while the banner was open. "Keep mine" writes the editor's text over the other
version.

## Follow Renames and Moves

A `move` event means the file was renamed or moved. The event's `path` is the
new path and `from` is the old one. Keep `path` up to date, because
[`puter.fs.write()`](/FS/write/) only takes a path. If you save to the old path
after a rename, Puter creates a new file there instead of updating the one
that's open.

Deleting a file on the Puter desktop moves it to the user's Trash folder
(`/<username>/Trash`), so you get a `move`, not a `remove`. The `onMoved()`
function below sets `path` to `null` while the file is in the Trash. If the
user restores the file, it gets another `move` event, and `onMoved()` sets
`path` to the restored location:

```js
const inTrash = (p) => /^\/[^/]+\/Trash\//.test(p);

function onMoved (event) {
    if (inTrash(event.path)) {
        path = null;
        showBanner('This file was moved to the Trash.');
        return;
    }
    path = event.path;
    setTitle(event.path.split('/').pop());
}

async function refreshPath () {
    const info = await puter.fs.stat({ uid: file.uid });
    onMoved({ path: info.path });
}
```

Renaming or moving the folder the file is in also changes the file's path, but
sends no event for the file. The `refreshPath()` function looks up the current
path with [`puter.fs.stat()`](/FS/stat/). Call it before each save, and skip
the save while the file is in the Trash:

```js
function save () {
    return enqueue(async () => {
        await refreshPath();                // its folder may have moved
        if (!path) return;                  // the file is in the Trash
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}
```

A [gap](/recipes/watch-for-changes/#handle-gaps) means some events may have
been missed, for example while the laptop was asleep. On a gap, refresh the
path and then read the file again. Here's `handleFileEvent()` with the `move`
and `gap` cases added:

```js
async function handleFileEvent (event) {
    if (event.op === 'write') return reloadIfChanged();
    if (event.op === 'move') return onMoved(event);
    if (event.op === 'gap') {
        await refreshPath();
        await reloadIfChanged();
    }
}
```

## When the File Is Deleted

A file is permanently deleted when the user empties the Trash, or when an app
calls [`puter.fs.delete()`](/FS/delete/). You usually get a `remove` event
first. Then the subscription ends, and `onError` is called with
`code: 'subscription_ended'` and `reason: 'anchor_deleted'`. If the file was
deleted while the connection was down, `onError` gets `subject_does_not_exist`
instead when the SDK reconnects. Either way, no more events arrive.

The text is still in the editor, so offer to save it as a new file. This
replaces `onWatchError()`:

```js
function onDeleted () {
    path = null;
    showBanner('This file was deleted. Save to keep your text as a new file.');
}

function onWatchError (err) {
    if (err.reason === 'anchor_deleted' || err.code === 'subject_does_not_exist') {
        return onDeleted();
    }
    showBanner(`Live updates stopped (${err.code}).`);
}

async function saveAsNewFile () {
    try {
        const item = await puter.ui.showSaveFilePicker(editor.getValue(), file.name);
        await enqueue(() => openFile(item));
    } catch (err) {
        showBanner(`Couldn't save: ${err.message}`);
    }
}
```

[`showSaveFilePicker()`](/UI/showSaveFilePicker/) writes the text where the
user chooses and resolves to the new file, which `openFile()` then watches.

Now `save()` can save as a new file when there's no path to write to. After the
file is permanently deleted, the [`puter.fs.stat()`](/FS/stat/) call in
`refreshPath()` throws, and `save()` handles that the same way:

```js
function save () {
    return enqueue(async () => {
        try {
            await refreshPath();            // its folder may have moved
        } catch {
            path = null;                    // the file was deleted
        }
        if (!path) {
            saveAsNewFile();                // no await
            return;
        }
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}
```

If the user cancels the save picker, the promise never resolves. That's why
`save()` calls `saveAsNewFile()` without `await`. If the queue waited for it,
no task after it in the queue would run.

The last case for `handleFileEvent()` is `remove`:

```js
async function handleFileEvent (event) {
    if (event.op === 'write') return reloadIfChanged();
    if (event.op === 'move') return onMoved(event);
    if (event.op === 'remove') return onDeleted();
    if (event.op === 'gap') {
        await refreshPath();
        await reloadIfChanged();
    }
}
```

You can also add a third button to `showConflict()` that keeps the user's text
as a new file by calling `saveAsNewFile()`.

## Full Code

Here's the finished editor in one block:

```js
let file;          // the open file
let path;          // where the file is now
let saved = '';    // the file's text as this tab last loaded or saved it
let sub;
let last = Promise.resolve();

function enqueue (task) {
    const previous = last;
    last = (async () => {
        try {
            await previous;
        } catch {
            // ignore the previous task's error and keep going
        }
        return task();
    })();
    return last;
}

async function readFile () {
    const blob = await puter.fs.read(file.uid);
    return blob.text();
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

    if (editor.getValue() === saved) {      // no unsaved edits, so load it
        saved = latest;
        editor.setValue(latest);
    } else {
        showConflict();                     // changed in both places
    }
}

const inTrash = (p) => /^\/[^/]+\/Trash\//.test(p);

function onMoved (event) {
    if (inTrash(event.path)) {
        path = null;
        showBanner('This file was moved to the Trash.');
        return;
    }
    path = event.path;
    setTitle(event.path.split('/').pop());
}

async function refreshPath () {
    const info = await puter.fs.stat({ uid: file.uid });
    onMoved({ path: info.path });
}

function onDeleted () {
    path = null;
    showBanner('This file was deleted. Save to keep your text as a new file.');
}

async function handleFileEvent (event) {
    if (event.op === 'write') return reloadIfChanged();
    if (event.op === 'move') return onMoved(event);
    if (event.op === 'remove') return onDeleted();
    if (event.op === 'gap') {
        await refreshPath();
        await reloadIfChanged();
    }
}

function onFileEvent ({ event }) {
    return enqueue(() => handleFileEvent(event));
}

function onWatchError (err) {
    if (err.reason === 'anchor_deleted' || err.code === 'subject_does_not_exist') {
        return onDeleted();
    }
    showBanner(`Live updates stopped (${err.code}).`);
}

async function openFile (item) {
    await sub?.off();
    file = item;
    path = item.path;
    sub = await puter.events.onLocal(`fs:${item.uid}`, onFileEvent, {
        onError: onWatchError,
    });
    saved = await readFile();
    editor.setValue(saved);
    setTitle(item.name);
}

async function saveAsNewFile () {
    try {
        const item = await puter.ui.showSaveFilePicker(editor.getValue(), file.name);
        await enqueue(() => openFile(item));
    } catch (err) {
        showBanner(`Couldn't save: ${err.message}`);
    }
}

function save () {
    return enqueue(async () => {
        try {
            await refreshPath();            // its folder may have moved
        } catch {
            path = null;                    // the file was deleted
        }
        if (!path) {
            saveAsNewFile();                // no await
            return;
        }
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}

const item = await puter.ui.showOpenFilePicker();
await enqueue(() => openFile(item));
```
