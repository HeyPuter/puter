---
title: See Who Has a File Open
description: "Learn how to show which teammates are viewing a shared file with Puter.js, so people on a team don't overwrite each other's work."
tags: [teams, fs, events]
order: 63
---

<div class="info">The Teams and Events APIs are in beta. Method shapes, limits, and behavior may change between releases.</div>

When a team shares a folder, two people can open the same file without knowing
about each other, and the second one to save wins. Showing who else is in a file
is usually enough to stop that happening.

There's no presence API to call. You build it out of two things you already
have: a folder the team can write to, and
[`puter.events`](/Events/) to watch it. Each person writes a small file saying
they're here, and everyone watching the folder sees it appear.

To share the folder with the team in the first place, see
[Share a File with a Team](/recipes/share-a-file-with-a-team/).

## Find the shared folder

The folder lives in one account and is shared with the team, so everyone else
reaches it through [`puter.fs.listShared()`](/FS/listShared/). Shared items come
back at a masked path like `/ada/4f2c…/team-docs`, which you can pass to any
`puter.fs` method:

```js
const { items } = await puter.fs.listShared();
const folder = items.find(i => i.isDir && i.name === 'team-docs');

const root = folder ? folder.path : '~/team-docs';   // the owner uses their own
```

The owner of the folder won't see it in `listShared()` — that only lists things
shared *with* you — so fall back to their own path.

## Say you're here

When someone opens a file, write a small presence file into a `.presence`
folder. Name it after the file and the person, so one write per person per file:

```js
const me = await puter.auth.getUser();

async function enter(fileId) {
    await puter.fs.write(
        `${root}/.presence/${fileId}.${me.uuid}.json`,
        JSON.stringify({ username: me.username, at: Date.now() }),
        { createMissingParents: true },
    );
}
```

Use `uuid` in the name rather than `username`. A user can change their username,
and you'd end up with two files for one person.

Delete it when they leave:

```js
async function leave(fileId) {
    await puter.fs.delete(`${root}/.presence/${fileId}.${me.uuid}.json`);
}
```

## Watch who else is there

Subscribe to the `.presence` folder with
[`puter.events.onLocal()`](/Events/onLocal/). Everyone with access to the shared
folder gets these events, so each person sees the others arrive and leave:

```js
await puter.events.onLocal(`fs:${root}/.presence`, async ({ event }) => {
    if (event.self) return;
    render(await whoIsHere(currentFileId));
});

async function whoIsHere(fileId) {
    const items = await puter.fs.readdir(`${root}/.presence`);
    const mine = items.filter(i => i.name.startsWith(`${fileId}.`));

    const people = await Promise.all(mine.map(async i => {
        const blob = await puter.fs.read(i.path);
        const { username, at } = JSON.parse(await blob.text());
        return { username, at };
    }));

    return people.filter(p => p.username !== me.username);
}
```

`event.self` is `true` for your own writes, so the check keeps your own arrival
from re-rendering your list. Re-reading the folder on each event, rather than
tracking it from the events themselves, means a missed delivery can't leave the
list wrong.

## Clear out people who never left

`leave()` doesn't run if a tab crashes or the laptop lid closes, so presence
files can be left behind. That's what the `at` timestamp is for: treat anything
old as gone, and tidy it up when you see it.

Have each open file refresh its own entry on a timer, and ignore entries that
have stopped refreshing:

```js
const STALE_MS = 2 * 60 * 1000;

setInterval(() => enter(currentFileId), 30 * 1000);
```

```js
const fresh = people.filter(p => Date.now() - p.at < STALE_MS);
```

Deleting other people's stale files is optional — they're small, and the next
time that person opens the file they'll overwrite their own. If you do want to
clean up, do it from one place rather than from everyone's browser at once.

## Notes

- Everyone needs `write` on the shared folder for this to work. A member with
  read-only access can see who's there but can't announce themselves.
- Events never say *who* made a change — on a shared folder that would tell
  every subscriber who else has access. The username comes from inside the
  presence file, which the person wrote themselves.
- Writes to the same file within 250 ms arrive as one event, so a refresh timer
  that lands close to another write costs one delivery, not two.
- This is presence, not locking. It tells people someone else is there; it
  doesn't stop them saving.
