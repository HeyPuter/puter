---
title: Keep an Open File in Sync
description: "Learn how to build an editor with Puter.js events that reloads a file when it changes somewhere else, protects unsaved work, and follows the file when it's renamed or deleted."
tags: [events, fs]
order: 67
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

An editor opens a file from the user's Puter account and keeps it open while
they work. In the meantime, the same file can change somewhere else: the user
edits it in another tab, on their phone, or in another app, renames it on the
Puter desktop, or drags it to the Trash. Desktop code editors handle this with
a "file changed on disk" prompt. This recipe builds the same thing for a Puter
app.

It uses [`puter.events.onLocal()`](/Events/onLocal/), which runs a function each
time the file changes, like a file watcher. [Watch for
Changes](/recipes/events-watch-for-changes/) covers the basics this recipe
builds on: gaps, reconnects, stopping and cost. The examples call a few
functions of your own: `editor.getValue()` and `editor.setValue()` for the text
box, `setTitle()` for the window title, and `showBanner()` for a message bar
with optional buttons.

## Watch the File by Its ID

Every file in Puter has a `uid`, an ID that stays the same when the file is
renamed or moved, much like an inode number on Linux. The string you pass to
`onLocal()` is the *subject*, which says what to watch. `fs:` followed by a
file's `uid` watches that file wherever it goes:

```js
let file;          // the open file, from a file picker
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
and gives your app access to it, and watching a file needs the same access as
reading it. When the user opens a file with your app from the Puter desktop,
[`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/) hands it over the
same way: `puter.ui.onLaunchedWithItems((items) => enqueue(() => openFile(items[0])))`.
`enqueue()` comes from the next section.

Read the file by its `uid` too. The picked item's `read()` method reads by the
path the file had when it was opened, so it fails once the file is renamed.

Subscribe first, then read, so a change made while the file loads still
reaches the handler. Saving overwrites the file in place, so the `uid` stays
the same across saves and the subscription keeps working.

A path subject such as `fs:~/Documents/notes.txt` also follows the file while
the page stays connected. After a dropped connection, though, the SDK looks the
path up again, so a file renamed in the meantime is no longer the one being
watched. The `uid` doesn't have this problem.

## Handle One Thing at a Time

The SDK calls your handler for each event as it arrives, without waiting for
the previous call to finish. Reading the file takes a moment, so two reads can
overlap and finish in the wrong order, and a reload can run in the middle of a
save or of the first load. Put opening, events and saves in one queue, so each
waits for the one before it:

```js
let last = Promise.resolve();

function enqueue (task) {
    const previous = last;
    last = (async () => {
        try {
            await previous;
        } catch {
            // the task before failed; run this one anyway
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

`handleFileEvent()` sorts each event by its `op`. The sections below fill in
each case.

## Reload When It Changes Somewhere Else

A `write` event means the file's contents changed. The event doesn't carry the
new text, so read the file again and compare it with what this tab knows:

```js
async function reloadIfChanged () {
    const latest = await readFile();
    if (latest === saved) return;           // nothing new, or this tab's own save

    if (editor.getValue() === saved) {      // no unsaved edits here: take it
        saved = latest;
        editor.setValue(latest);
    } else {
        showConflict();                     // changed in both places
    }
}
```

The check is against `saved`, the last text this tab loaded or wrote, not
against the screen. That is what tells "the user typed something" apart from
"the file changed".

Writes less than 250 ms apart arrive as one event, so an autosave in another
tab sends one event per burst rather than one per keystroke. Never count
events. Read the file and compare.

## Tell Your Own Saves Apart

Saving also sends a `write` event, to this tab as well. `event.self` doesn't
help here: it's `true` whenever the signed-in user made the change, from any
tab or device, so another tab of the same user looks the same as this one.

Instead, save through the same queue and update `saved` once the write is
done. The event for this save waits in the queue behind the save, so by the
time it runs, the file matches `saved` and `reloadIfChanged()` does nothing:

```js
function save () {
    return enqueue(async () => {
        try {
            await refreshPath();            // its folder may have moved, see below
        } catch {
            path = null;                    // deleted for good
        }
        if (!path) {
            saveAsNewFile();                // not awaited, see below
            return;
        }
        const text = editor.getValue();
        await puter.fs.write(path, text);
        saved = text;
    });
}
```

If two tabs save at about the same time, the save that lands last wins, and the
other tab reloads it. A change that lands just before this save, before its
event has arrived, is overwritten without a prompt. To catch that too, read the
file before writing and compare it with `saved`.

## Handle Unsaved Changes

When the file changed somewhere else and the user also has unsaved edits, both
versions matter. Puter doesn't lock or merge files: the last save wins. So ask
the user before one version replaces the other:

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

"Load their version" reads the file again when the user clicks, in case it
changed while the banner was up. "Keep mine" saves over the other version. To
keep both, offer to save the user's text as a new file with `saveAsNewFile()`
from [When the File Is Deleted](#when-the-file-is-deleted).

## Follow Renames and Moves

A `move` event means the file was renamed or moved to another folder.
`event.path` is where it is now, and `event.from` is where it was:

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

[`puter.fs.write()`](/FS/write/) works with paths only, so the save needs the
file's current path. Writing to a path where nothing exists creates a new file
there, so saving to the old path after a rename would quietly make a second
file instead of updating the one that's open.

Only changes to the file itself send it events. When the user renames, moves or
trashes the folder the file is in, the file's path changes with no event. That
is why `save()` looks up the current path with [`puter.fs.stat()`](/FS/stat/)
before every write. A [gap](/recipes/events-watch-for-changes/#handle-gaps), which means
events may have been missed, for example while the laptop slept, does the same
and then rereads the contents.

Deleting a file on the Puter desktop doesn't delete it. It moves it to the
user's Trash folder (`/<username>/Trash`), so your app gets a `move` event, not
a `remove`. The code above stops saving to the old path while the file is in
the Trash. If the user restores it, another `move` brings it back, and the same
code picks up the path again.

## When the File Is Deleted

When the file is removed for good, by emptying the Trash or by an app calling
[`puter.fs.delete()`](/FS/delete/), the handler usually gets a `remove` event
first. Then the subscription ends, and `onError` is called with
`code: 'subscription_ended'` and `reason: 'anchor_deleted'`, meaning the file
the subscription was attached to is gone. If the file was deleted while the
connection was down, `onError` gets `subject_does_not_exist` when the SDK
reconnects. Either way, nothing arrives after that. The text is still in the
editor, so offer to save it as a new file:

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

[`showSaveFilePicker()`](/UI/showSaveFilePicker/) writes the text to the place
the user picks and resolves to the new file. `openFile()` then watches the new
file. If the user cancels, the promise never resolves, which is why `save()`
doesn't wait for it, and why the picker is never awaited inside the queue: a
promise that never settles would block the queue forever.

## Notes

- To get only content changes, subscribe to `fs:<uid>:write`. You then miss
  renames and moves, and a deleted file ends the subscription through `onError`
  without a `remove` event.
- Each delivered event costs the user 10 microcents ($0.10 per million) under
  the [User-Pays Model](/user-pays-model/), including the events for this tab's
  own saves. Writes less than 250 ms apart count as one.
- Nothing sends a `meta` event yet, so changes to a file's details other than
  its name, place and contents don't reach the handler.
- Watching a file the user picked or opened with your app needs no extra
  permission. To watch a whole folder such as Documents, ask for it first, as
  in [Ask for Access](/recipes/perms-ask-for-access/).
