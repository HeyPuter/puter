---
title: Let One Teammate Edit a File at a Time
description: "Learn how to let one teammate at a time edit a shared file with Puter.js, while the rest of the team sees who is editing."
tags: [teams, fs, events]
order: 64
---

<div class="info">The Teams and Events APIs are in beta. Method shapes, limits, and behavior may change between releases.</div>

On Puter, a user can create a team and add accounts to it. When two teammates
edit the same shared file at the same time, the last one to save overwrites the
other's changes. Many editors handle this by letting one person edit at a time.
Everyone else gets a read-only copy and sees who is editing.

One way to let one teammate edit at a time is to use a folder shared with the
team and [`puter.events`](/Events/).

To share the folder with the team, see
[Share a File with a Team](/recipes/share-a-file-with-a-team/). Share it with
`'write'` access, since each person's app writes a file to it.

## Find the team's folder

One user keeps the folder in their account and shares it with the team. That
user is the folder's owner. Everyone else finds the folder with
[`puter.fs.listShared()`](/FS/listShared/), which lists the items other users
shared with them. Each item's `path` is a masked path, such as
`/ada/4f2c…/team-docs`. You can pass it to any `puter.fs` method like a normal
path. The owner doesn't see their own folder in
[`puter.fs.listShared()`](/FS/listShared/), so they use `~/team-docs`:

```js
const { items } = await puter.fs.listShared();
const folder = items.find(i => i.isDir && i.name === 'team-docs');

const root = folder ? folder.path : '~/team-docs';   // the owner uses their own
```

## Write a presence file

Every file in Puter has a `uid`, an ID that doesn't change when the file is
renamed or moved. When someone opens a file, write a small file, called a
presence file, to a `.presence` folder inside the team's folder with
[`puter.fs.write()`](/FS/write/). Its name is the open file's `uid` followed by
a random ID for this tab, so a person who opens the file in two tabs can only
edit in one of them. It holds the person's `username` from
[`puter.auth.getUser()`](/Auth/getUser/) and the time it was written:

```js
const me = await puter.auth.getUser();
let tabId = crypto.randomUUID();

async function enter(fileId) {
    await puter.fs.write(
        `${root}/.presence/${fileId}.${tabId}.json`,
        JSON.stringify({ username: me.username, at: Date.now() }),
        { createMissingParents: true },
    );
}
```

The `createMissingParents` option creates the `.presence` folder the first time.
When the person closes the file, delete their presence file with
[`puter.fs.delete()`](/FS/delete/):

```js
async function leave(fileId) {
    await puter.fs.delete(`${root}/.presence/${fileId}.${tabId}.json`);
}
```

## Let the first person edit

To find out who can edit, read the `.presence` folder with
[`puter.fs.readdir()`](/FS/readdir/) and sort this file's presence files by
their `created` time. Puter sets `created` when a file is first written, and
writing it again doesn't change it, so the person who opened the file first
stays first. Files created in the same second are sorted by name, so every tab
puts them in the same order. Then read each presence file with
[`puter.fs.read()`](/FS/read/) to get the username:

```js
async function whoIsHere(fileId) {
    const items = await puter.fs.readdir(`${root}/.presence`);
    const mine = items
        .filter(i => i.name.startsWith(`${fileId}.`))
        .sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));

    const people = await Promise.all(mine.map(async i => {
        const blob = await puter.fs.read(i.path);
        const { username, at } = JSON.parse(await blob.text());
        return { username, at, isThisTab: i.name === `${fileId}.${tabId}.json` };
    }));

    return people;
}
```

The rest of the examples use a few functions you'd write yourself. The
`editor.setValue()` and `editor.setReadOnly()` functions control the text area,
and `render()` shows who has the file open.

The first person in the list is the editor. This tab can edit when it's first.
When it becomes the editor after being read-only, it loads the file again with
[`puter.fs.read()`](/FS/read/), since the last editor may have saved changes:

```js
let currentFileId = null;
let canEdit = false;

async function loadText(fileId) {
    const blob = await puter.fs.read(fileId);
    editor.setValue(await blob.text());
}

async function update() {
    const people = await whoIsHere(currentFileId);
    const isEditor = people[0]?.isThisTab ?? false;

    if (isEditor && !canEdit) await loadText(currentFileId);
    canEdit = isEditor;
    editor.setReadOnly(!canEdit);
    render(people);
}

async function openFile(fileId) {
    if (currentFileId) await closeFile();
    currentFileId = fileId;
    canEdit = false;
    await enter(fileId);
    await update();
    if (!canEdit) await loadText(fileId);
}

async function closeFile() {
    await leave(currentFileId);
    currentFileId = null;
}
```

Call `openFile()` with the file's `uid` when the person opens a file, and
`closeFile()` when they close it in your app.

To keep the read-only copy up to date while someone else saves, see
[Keep an Open File in Sync](/recipes/keep-an-open-file-in-sync/).

## Update when someone opens or closes the file

Subscribe to the `.presence` folder with
[`puter.events.onLocal()`](/Events/onLocal/). Everyone with access to the team's
folder gets an event when a presence file in it is written or deleted, so each
tab reads the list again:

```js
let latest = 0;

async function update() {
    const run = ++latest;
    const people = await whoIsHere(currentFileId);
    if (run !== latest) return;   // a newer update() started while this one was reading

    const isEditor = people[0]?.isThisTab ?? false;
    if (isEditor && !canEdit) await loadText(currentFileId);
    canEdit = isEditor;
    editor.setReadOnly(!canEdit);
    render(people);
}

await puter.events.onLocal(`fs:${root}/.presence`, async () => {
    if (currentFileId) await update();
});
```

The handler runs for this tab's own writes and for the person's other tabs too,
since those change the list as well. It reads the whole folder instead of using
what the event says, so a [gap](/recipes/watch-for-changes/#handle-gaps) marker,
sent when events were missed, also brings the list up to date.

Events can arrive while an earlier `update()` is still reading the folder, and
the reads can finish in either order. The `latest` counter makes an older read
that finishes last do nothing, so it can't show an old list.

## Handle tabs that close without leaving

When a tab crashes or is closed, `closeFile()` usually doesn't run, so its
presence file stays in the folder. If that tab was the editor, nobody else could
edit the file. To handle that, write the presence file again every 30 seconds
while the file is open. Each write sets `at` to the current time. Treat a
presence file whose `at` time is more than 2 minutes old as closed. Browsers can
run timers in background tabs as rarely as once a minute, so the 2 minutes leave
room for a write that runs late.

The other tabs also treat a tab that couldn't write for 2 minutes as closed,
for example because the computer was asleep, and someone else may be editing by
then. When that tab can write again, it takes a new random ID, so it goes to the
back of the line. If it had unsaved changes, it's now read-only, and
[Keep an Open File in Sync](/recipes/keep-an-open-file-in-sync/) shows how to
save them as a new file.

The editor also deletes this file's presence files that stopped being written,
so the folder doesn't keep a file for every tab that was ever closed. This
version of `whoIsHere()` also returns those files, and the new `refresh()`
function writes the presence file:

```js
const STALE_MS = 2 * 60 * 1000;
let lastWrite = 0;
let refreshTimer;

async function whoIsHere(fileId) {
    const items = await puter.fs.readdir(`${root}/.presence`);
    const mine = items
        .filter(i => i.name.startsWith(`${fileId}.`))
        .sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));

    const people = await Promise.all(mine.map(async i => {
        const blob = await puter.fs.read(i.path);
        const { username, at } = JSON.parse(await blob.text());
        return { username, at, path: i.path, isThisTab: i.name === `${fileId}.${tabId}.json` };
    }));

    const fresh = people.filter(p => Date.now() - p.at < STALE_MS);
    const stale = people.filter(p => Date.now() - p.at >= STALE_MS);
    return { people: fresh, stale };
}

async function refresh() {
    const now = Date.now();
    if (now - lastWrite > STALE_MS) tabId = crypto.randomUUID();
    await enter(currentFileId);
    lastWrite = now;
}
```

This version of `update()` deletes the stale files when this tab is the editor,
and `openFile()` and `closeFile()` start and stop the timer:

```js
async function update() {
    const run = ++latest;
    const { people, stale } = await whoIsHere(currentFileId);
    if (run !== latest) return;   // a newer update() started while this one was reading

    const isEditor = people[0]?.isThisTab ?? false;
    if (isEditor && !canEdit) await loadText(currentFileId);
    canEdit = isEditor;
    editor.setReadOnly(!canEdit);
    render(people);

    if (canEdit) {
        for (const p of stale) puter.fs.delete(p.path).catch(() => {});   // it may already be deleted
    }
}

async function openFile(fileId) {
    if (currentFileId) await closeFile();
    currentFileId = fileId;
    canEdit = false;
    await refresh();
    refreshTimer = setInterval(refresh, 30 * 1000);
    await update();
    if (!canEdit) await loadText(fileId);
}

async function closeFile() {
    clearInterval(refreshTimer);
    await leave(currentFileId);
    currentFileId = null;
}
```

## Full Code

```js
const { items } = await puter.fs.listShared();
const folder = items.find(i => i.isDir && i.name === 'team-docs');

const root = folder ? folder.path : '~/team-docs';   // the owner uses their own

const me = await puter.auth.getUser();
let tabId = crypto.randomUUID();

async function enter(fileId) {
    await puter.fs.write(
        `${root}/.presence/${fileId}.${tabId}.json`,
        JSON.stringify({ username: me.username, at: Date.now() }),
        { createMissingParents: true },
    );
}

async function leave(fileId) {
    await puter.fs.delete(`${root}/.presence/${fileId}.${tabId}.json`);
}

const STALE_MS = 2 * 60 * 1000;

async function whoIsHere(fileId) {
    const items = await puter.fs.readdir(`${root}/.presence`);
    const mine = items
        .filter(i => i.name.startsWith(`${fileId}.`))
        .sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));

    const people = await Promise.all(mine.map(async i => {
        const blob = await puter.fs.read(i.path);
        const { username, at } = JSON.parse(await blob.text());
        return { username, at, path: i.path, isThisTab: i.name === `${fileId}.${tabId}.json` };
    }));

    const fresh = people.filter(p => Date.now() - p.at < STALE_MS);
    const stale = people.filter(p => Date.now() - p.at >= STALE_MS);
    return { people: fresh, stale };
}

let currentFileId = null;
let canEdit = false;
let latest = 0;
let lastWrite = 0;
let refreshTimer;

async function loadText(fileId) {
    const blob = await puter.fs.read(fileId);
    editor.setValue(await blob.text());
}

async function update() {
    const run = ++latest;
    const { people, stale } = await whoIsHere(currentFileId);
    if (run !== latest) return;   // a newer update() started while this one was reading

    const isEditor = people[0]?.isThisTab ?? false;
    if (isEditor && !canEdit) await loadText(currentFileId);
    canEdit = isEditor;
    editor.setReadOnly(!canEdit);
    render(people);

    if (canEdit) {
        for (const p of stale) puter.fs.delete(p.path).catch(() => {});   // it may already be deleted
    }
}

async function refresh() {
    const now = Date.now();
    if (now - lastWrite > STALE_MS) tabId = crypto.randomUUID();
    await enter(currentFileId);
    lastWrite = now;
}

async function openFile(fileId) {
    if (currentFileId) await closeFile();
    currentFileId = fileId;
    canEdit = false;
    await refresh();
    refreshTimer = setInterval(refresh, 30 * 1000);
    await update();
    if (!canEdit) await loadText(fileId);
}

async function closeFile() {
    clearInterval(refreshTimer);
    await leave(currentFileId);
    currentFileId = null;
}

await puter.events.onLocal(`fs:${root}/.presence`, async () => {
    if (currentFileId) await update();
});
```
