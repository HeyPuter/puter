---
title: Merge Edits From Several Devices
description: "Learn how to save a form with Puter.js so edits the user made at the same time in another tab or on another device aren't overwritten."
tags: [kv, events, data-modeling]
order: 37
---

A user can have the same record open in two places, such as a task in two tabs
or a contact on a laptop and a phone. Each place loaded its own copy. If both
save the whole record with [`puter.kv.set()`](/KV/set/), the second save
replaces the first, and an edit made in the first place is lost without any
error.

This recipe keeps both edits. It saves only the fields the user changed, takes
in the fields that changed somewhere else, and asks the user only when the same
field was edited in both places. [`puter.kv.update()`](/KV/update/) does the
saving, [`puter.kv.incr()`](/KV/incr/) catches two saves made at the same
moment, and [`puter.events.onLocal()`](/Events/onLocal/) reports the other
side's saves while the form is open.
[Keep an Open File in Sync](/recipes/keep-an-open-file-in-sync/) does the same
for a file.

The examples edit a task with a `title`, `notes` and a `done` flag. They call a
few functions you'd write yourself. The `readForm()` function returns the
form's current values as an object, `setField()` puts a value into one form
field, and `showConflict()` asks the user which of two values to keep.

## Save Only What Changed

Keep the copy the form was loaded from as `base`. When the user saves, compare
the form with it and write only the fields that differ:

```js
const key = 'task:42';
let base = await puter.kv.get(key);    // { title: 'Buy a tent', notes: '', done: false }

function changedFields (form) {
    const changes = {};
    for (const field of Object.keys(form)) {
        if (form[field] !== base[field]) changes[field] = form[field];
    }
    return changes;
}

async function save () {
    const changes = changedFields(readForm());
    if (Object.keys(changes).length === 0) return;

    base = await puter.kv.update(key, changes);
}
```

[`puter.kv.update()`](/KV/update/) writes the fields you name and leaves the
rest of the stored value as it is. When one tab saves a new `title` and another
saves new `notes`, both are kept. It resolves to the whole updated value, which
becomes the new `base`.

Each field name is read as a path, so a name with a dot or a bracket in it
needs quoting, as
[Store a Set of Unique Values](/recipes/store-unique-values/) shows. The fields
are compared with `!==`, so keep each one a string, number or boolean.

## Merge In Changes From Somewhere Else

When the stored record differs from `base`, something was saved in another
place. For each field that changed there, the form either takes the new value
or has a conflict:

```js
function mergeRemote (theirs) {
    const form = readForm();
    const conflicts = [];

    for (const field of Object.keys(form)) {
        if (theirs[field] === base[field]) continue;

        const editedHere = form[field] !== base[field] && form[field] !== theirs[field];
        if (editedHere) {
            conflicts.push(field);
        } else {
            setField(field, theirs[field]);
            base[field] = theirs[field];
        }
    }
    return conflicts;
}
```

The function looks at the fields the form has. A field the user hasn't touched
in this form gets the other side's value, and `base` is updated to match. A field edited in both places to different values
is a conflict. It's left alone, with the user's text still in the form, and the
function returns its name.

To settle a conflict, show both values and let the user pick one:

```js
function resolveConflict (field, theirs, keepMine) {
    base[field] = theirs[field];
    if (!keepMine) setField(field, theirs[field]);
}
```

Either way, `base` takes the other side's value. If the user keeps their own
text, the field now differs from `base`, so the next save writes it. If they
take the other value, the form matches `base` and there's nothing left to save.

This function does both steps for a record read from the store:

```js
async function settle (theirs) {
    for (const field of mergeRemote(theirs)) {
        const keepMine = await showConflict(field, readForm()[field], theirs[field]);
        resolveConflict(field, theirs, keepMine);
    }
}
```

Here `showConflict()` shows the two values and resolves to `true` when the user
keeps their own.

## Check Before Saving

Before writing, read the record and settle it against the form. This is the
whole `save()` with that added:

```js
async function save () {
    const theirs = await puter.kv.get(key);
    if (!theirs) return closeForm();
    await settle(theirs);

    const changes = changedFields(readForm());
    if (Object.keys(changes).length === 0) return;

    base = await puter.kv.update(key, changes);
}
```

After every conflict is settled, the form holds what the user chose, and the
save writes only the fields that still differ from `base`. A record that reads
as `null` was deleted somewhere else, and `closeForm()` is your own function
for that case.

## Catch a Save Made at the Same Moment

The read and the write in `save()` are two calls, so a save from another place
can land between them and go unnoticed. To catch it, count the saves in a `rev`
field of the record. [`puter.kv.incr()`](/KV/incr/) adds 1 to that field in a
single write and resolves to the whole record, so the number it returns tells
this save whether another one got in first. This is the whole `save()` with
that added:

```js
async function save () {
    for (let attempt = 0; attempt < 3; attempt++) {
        const theirs = await puter.kv.get(key);
        if (!theirs) return closeForm();
        await settle(theirs);

        const changes = changedFields(readForm());
        if (Object.keys(changes).length === 0) return;

        const claimed = await puter.kv.incr(key, { rev: 1 });
        if (claimed.rev !== (theirs.rev ?? 0) + 1) continue;

        base = await puter.kv.update(key, changes);
        return;
    }
    throw new Error('The record keeps changing. Try again in a moment.');
}
```

If the record this save read had a `rev` of 7, the save expects to get 8 back.
Getting 9 means another save added 1 in between. The loop then starts over. It
reads the record again, settles the other save against the form, and counts
once more. After three tries it gives up and throws, so show the error and let
the user save again.

The `rev` field isn't part of the form, so `changedFields()` and
`mergeRemote()` leave it alone. A record that has no `rev` yet counts from 0.

Two saves at nearly the same moment from different places, such as two devices
far apart, can both get the number they expected, as
[`puter.kv.set()`](/KV/set/#writing-only-if-absent) explains for
`onlyIfAbsent`. The later write then wins for a field both of them changed. To
be able to undo that when it happens, keep a copy of each save as in
[Keep a Version History](/recipes/keep-version-history/).

## Merge Changes as They Arrive

With a subscription, the form takes in the other side's saves while it's open,
and the user sees a conflict when it happens instead of when they save:

```js
await puter.events.onLocal(`kv:${puter.appID}:${key}`, async ({ event }) => {
    if (event.op === 'del') return closeForm();

    const theirs = 'value' in event ? event.value : await puter.kv.get(key);
    if (theirs) await settle(theirs);
}, { includeValue: true });
```

With `includeValue`, each event carries the record's new value. A
[gap](/recipes/watch-for-changes/#handle-gaps) has no value, so the handler
reads the record instead and merges it the same way.

The form's own saves arrive here too. By then the form already holds those
values, so `mergeRemote()` finds nothing to change. The key contains `:`, so
the subject starts with your app's id from [`puter.appID`](/Utils/appID/), as
[Watch Several Keys](/recipes/watch-for-changes/#watch-several-keys) explains.

## Full Code

```js
const key = 'task:42';
let base = await puter.kv.get(key);

function changedFields (form) {
    const changes = {};
    for (const field of Object.keys(form)) {
        if (form[field] !== base[field]) changes[field] = form[field];
    }
    return changes;
}

function mergeRemote (theirs) {
    const form = readForm();
    const conflicts = [];

    for (const field of Object.keys(form)) {
        if (theirs[field] === base[field]) continue;

        const editedHere = form[field] !== base[field] && form[field] !== theirs[field];
        if (editedHere) {
            conflicts.push(field);
        } else {
            setField(field, theirs[field]);
            base[field] = theirs[field];
        }
    }
    return conflicts;
}

function resolveConflict (field, theirs, keepMine) {
    base[field] = theirs[field];
    if (!keepMine) setField(field, theirs[field]);
}

async function settle (theirs) {
    for (const field of mergeRemote(theirs)) {
        const keepMine = await showConflict(field, readForm()[field], theirs[field]);
        resolveConflict(field, theirs, keepMine);
    }
}

async function save () {
    for (let attempt = 0; attempt < 3; attempt++) {
        const theirs = await puter.kv.get(key);
        if (!theirs) return closeForm();
        await settle(theirs);

        const changes = changedFields(readForm());
        if (Object.keys(changes).length === 0) return;

        const claimed = await puter.kv.incr(key, { rev: 1 });
        if (claimed.rev !== (theirs.rev ?? 0) + 1) continue;

        base = await puter.kv.update(key, changes);
        return;
    }
    throw new Error('The record keeps changing. Try again in a moment.');
}

await puter.events.onLocal(`kv:${puter.appID}:${key}`, async ({ event }) => {
    if (event.op === 'del') return closeForm();

    const theirs = 'value' in event ? event.value : await puter.kv.get(key);
    if (theirs) await settle(theirs);
}, { includeValue: true });
```
