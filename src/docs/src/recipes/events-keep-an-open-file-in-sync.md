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

It builds on [Watch for Changes](/recipes/events-watch-for-changes/), which
covers gaps, reconnects and cost. The examples use a few functions you'd write
yourself: `editor.getValue()` and `editor.setValue()` for the text area,
`setTitle()` for the window title, and `showBanner()` to show a message with
optional buttons.

## Watch the File by Its ID

Every file in Puter has a `uid`, an ID that doesn't change when the file is
renamed or moved. Subscribe to `fs:` plus the file's `uid`, and you'll hear
about the file wherever it goes:

```js
let file;          // the open file
let path;          // where the file is now
let saved = '';    // the file's text as this tab last loaded or saved it
let sub;

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

async function readFile () {
    const blob = await puter.fs.read(file.uid);
    return blob.text();
}

const item = await puter.ui.showOpenFilePicker();
await enqueue(() => openFile(item));
```

[`showOpenFilePicker()`](/UI/showOpenFilePicker/) lets the user pick a file
and gives your app access to it. If the user opens the file with your app from
the Puter desktop instead, you get it from
[`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/):

```js
puter.ui.onLaunchedWithItems((items) => enqueue(() => openFile(items[0])));
```

`enqueue()` is explained in the next section. A few things to note about
`openFile()`:

- It subscribes before reading the file, so a change made while the file loads
  isn't missed.
- It reads the file by `uid`, not with the picked item's `read()` method.
  `read()` uses the path the file had when it was opened, so it fails after a
  rename.
- Saving overwrites the file in place, so the `uid` stays the same and the
  subscription keeps working.

You could subscribe by path instead, like `fs:~/Documents/notes.txt`. But if
the connection drops, the SDK looks that path up again when it reconnects, and
if the file was renamed in the meantime, you'd be watching the old name.

## Handle One Thing at a Time

The SDK doesn't wait for your handler to finish before calling it again.
Reading a file takes a moment, so two reads can overlap and finish in the wrong
order, or a reload can run in the middle of a save. To avoid that, send
opening, saving and event handling through a small queue that runs one task at
a time:

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

function onFileEvent ({ event }) {
    return enqueue(() => handleFileEvent(event));
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
```

`handleFileEvent()` checks what kind of change happened. The next sections fill
in each case.

## Reload When It Changes Somewhere Else

A `write` event means the contents changed. It doesn't include the new text, so
read the file and compare:

```js
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

`saved` is the text this tab last loaded or wrote. Comparing the editor with
`saved` tells you whether the user has unsaved edits, and comparing the file
with `saved` tells you whether the file actually changed.

Writes less than 250 ms apart arrive as one event, so don't treat each event as
one save. Just read the file and compare.

## Tell Your Own Saves Apart

When this tab saves, it also gets a `write` event for that save. `event.self`
won't help here: it's `true` for every change the signed-in user makes, from
any tab or device.

Instead, save through the same queue and update `saved` after the write. The
event for the save runs after the save finishes, so by then the file matches
`saved` and `reloadIfChanged()` does nothing:

```js
function save () {
    return enqueue(async () => {
        try {
            await refreshPath();            // its folder may have moved, see below
        } catch {
            path = null;                    // the file was deleted
        }
        if (!path) {
            saveAsNewFile();                // no await, see below
            return;
        }
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}
```

If two tabs save at almost the same time, the last save wins and the other tab
reloads it. A change from somewhere else that lands right before your save can
get overwritten without a warning. If that matters, read the file just before
writing and compare it with `saved`.

## Handle Unsaved Changes

If the file changed somewhere else while the user has unsaved edits, ask which
version to keep. Puter doesn't lock or merge files, so whichever save happens
last wins:

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
```

"Load their version" reads the file again when clicked, in case it changed
while the banner was open. "Keep mine" saves over the other version. You could
also add a button that saves the user's text as a new file with
`saveAsNewFile()` from [When the File Is Deleted](#when-the-file-is-deleted).

## Follow Renames and Moves

A `move` event means the file was renamed or moved. `event.path` is the new
path and `event.from` is the old one:

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

Keep `path` up to date, because [`puter.fs.write()`](/FS/write/) only takes a
path. If you save to the old path after a rename, Puter creates a new file
there instead of updating the one that's open.

Renaming or moving the folder the file is in also changes the file's path, but
sends no event for the file. That's why `save()` checks the current path with
[`puter.fs.stat()`](/FS/stat/) before each write. On a
[gap](/recipes/events-watch-for-changes/#handle-gaps), which means some events
may have been missed (for example while the laptop was asleep),
`handleFileEvent()` does the same and then rereads the file.

Deleting a file on the Puter desktop moves it to the user's Trash folder
(`/<username>/Trash`), so you get a `move`, not a `remove`. The code above
stops saving while the file is in the Trash. If the user restores it, another
`move` brings the path back.

## When the File Is Deleted

A file is deleted for good when the user empties the Trash, or when an app
calls [`puter.fs.delete()`](/FS/delete/). You usually get a `remove` event
first. Then the subscription ends, and `onError` is called with
`code: 'subscription_ended'` and `reason: 'anchor_deleted'`. If the file was
deleted while the connection was down, `onError` gets `subject_does_not_exist`
instead when the SDK reconnects. Either way, no more events arrive.

The text is still in the editor, so offer to save it as a new file:

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
user chooses and resolves to the new file, which `openFile()` then watches. If
the user cancels, the promise never resolves. That's why `save()` calls
`saveAsNewFile()` without `await`: waiting for it inside the queue would block
everything behind it.

## Notes

- To only hear about content changes, subscribe to `fs:<uid>:write`. You won't
  get renames or moves, and if the file is deleted, the subscription ends
  through `onError` without a `remove` event.
- Each event costs the user $0.10 per million under the
  [User-Pays Model](/user-pays-model/), including the events for this tab's own
  saves.
- Files the user picked or opened with your app can be watched without asking
  for anything else. To watch a whole folder like Documents, ask first, as in
  [Ask for Access](/recipes/perms-ask-for-access/).
