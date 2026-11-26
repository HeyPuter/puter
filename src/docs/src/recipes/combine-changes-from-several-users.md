---
title: Combine Changes From Several Users
description: "Learn how to let several users change the same data at the same time with Puter.js, so every change is kept and everyone sees the same result."
tags: [kv, events, perms]
order: 24
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

When two users write the same key at about the same time, the last write wins
and the other change is lost. For a shared grocery list that's rarely a
problem, since each item has its own key. It is a problem for a number that
several people add to, such as a score, a vote count or a stock level. Both
users read 10, both write 15, and five points are gone. A counter kept with
[`puter.kv.incr()`](/KV/incr/) can lose an addition the same way when the two
users are far apart.

The fix is to never change a shared value. Each user writes every change as a
new key, and each app adds the changes up. Two changes made at the same moment
are two different keys, so both are kept, and everyone who has the same keys
gets the same result. Accounting software works this way, with a ledger of
entries instead of one balance that's edited.

This recipe builds a score sheet for a game night that several players update
from their own phones. It builds on
[Share a List With Someone](/recipes/share-a-list-with-someone/), which
explains sharing, and on [Keep an Activity Log](/recipes/keep-an-activity-log/),
which explains the keys. The examples use `render()`, your own function that
draws the totals.

## Create and Share the Sheet

The user who creates the sheet keeps it under `sheet:<id>:` in their account
and shares that prefix with the other players, with write access:

```js
await puter.perms.request('kvShare', { prefix: 'sheet:', access: 'write' });

const prefix = `sheet:${crypto.randomUUID()}:`;
await puter.kv.set(`${prefix}meta`, { title: 'Game night' });
await puter.kv.share({ prefix, recipients: ['alice', 'bob'], access: 'write', label: 'Game night', notify: true });
```

Each player finds the share with [`puter.kv.listShared()`](/KV/listShared/) and
uses its `handle`. The creator uses the prefix. This helper hides the
difference, the same way as the one in
[Use One Helper for Both Sides](/recipes/share-a-list-with-someone/#use-one-helper-for-both-sides):

```js
const openSheet = ({ prefix = '', handle }) => {
    const options = handle ? { handle } : {};
    const relative = (key) => key?.slice(prefix.length);
    return {
        get: (key) => puter.kv.get(prefix + key, options),
        set: (key, value) => puter.kv.set(prefix + key, value, options),
        del: (key) => puter.kv.del(prefix + key, options),
        list: async (pattern) => (await puter.kv.list(prefix + pattern, true, options))
            .map(({ key, value }) => ({ key: relative(key), value })),
        watch: (pattern, onChange) => puter.events.onLocal(
            `kv:${handle ?? puter.appID}:${prefix}${pattern}`,
            ({ event }) => onChange({ ...event, key: relative(event.key) }),
            { includeValue: true },
        ),
    };
};

// The creator opens the sheet by its prefix.
const sheet = openSheet({ prefix });
```

A player opens the same sheet with `openSheet({ handle })`, and the rest of the
code is the same for both.

## Record Each Change as Its Own Key

To add points, write a new key that says who gets how many. The page keeps
every change it knows in a `Map`, and adds its own change there right away:

```js
const user = await puter.auth.getUser();
let changes = new Map();

async function addPoints (player, points) {
    const key = `change:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const change = { player, points, by: user.username };

    changes.set(key, change);
    render();
    await sheet.set(key, change);
}

await addPoints('alice', 5);
```

The key starts with the time, so the changes list in the order they were made,
and the random part keeps two changes made in the same millisecond on different
keys. Nothing is ever overwritten, so the changes also work as a history of who
added what.

A change is never edited. To take points back, add a change with a negative
number, such as `addPoints('alice', -5)`.

## Add Up the Changes

The totals are the sum of every change. Load the changes once when the sheet
opens, and add them up whenever something changes:

```js
async function load () {
    const entries = await sheet.list('change:');
    changes = new Map(entries.map(({ key, value }) => [key, value]));
    render();
}

function totals () {
    const sums = {};
    for (const change of changes.values()) {
        sums[change.player] = (sums[change.player] ?? 0) + change.points;
    }
    return sums;
}

await load();
totals();    // { alice: 5 }
```

The result depends only on which changes exist, not on who wrote them or when
they arrived. Two players who have the same changes always show the same
totals.

## Get Changes Live

Subscribe to the sheet with the helper's `watch()`, which uses
[`puter.events.onLocal()`](/Events/onLocal/), and put each change that arrives
into the `Map`:

```js
async function onChange (event) {
    if (event.op === 'gap') return load();
    if (!event.key.startsWith('change:')) return;

    if (event.op === 'del') changes.delete(event.key);
    if (event.op === 'set') {
        changes.set(event.key, 'value' in event ? event.value : await sheet.get(event.key));
    }
    render();
}

await sheet.watch('*', onChange);
await load();
```

Every change arrives this way, including the user's own. The `Map` is keyed by
the change's key, so a change that's already there is set again to the same
value, and nothing is counted twice.

A `gap` event means some changes weren't delivered, for example while the
connection was down, so the page loads the changes again. Subscribe before the
first `load()`, as here, so a change made while the sheet is loading isn't
missed.

## Fold Old Changes Into a Snapshot

The log grows with every change, and so does the time it takes to load. To keep
it short, the creator's app sums up the oldest changes into one `snapshot` key
from time to time, and deletes them. This is safe for one user to do, since
only the creator writes the snapshot.

The snapshot holds the totals of everything folded into it, and the keys it
folded:

```js
const KEEP = 100;      // the newest changes stay in the log
let snapshot = { totals: {}, folded: [] };

async function fold () {
    const leftover = snapshot.folded.filter((key) => changes.has(key));
    const old = [...changes.keys()].sort().slice(0, -KEEP)
        .filter((key) => !leftover.includes(key))
        .slice(0, 100);
    if (old.length + leftover.length === 0) return;

    const lock = `folding:${prefix}`;
    const inOneMinute = Math.floor(Date.now() / 1000) + 60;
    if (!await puter.kv.set(lock, true, inOneMinute, { onlyIfAbsent: true })) return;

    const sums = { ...snapshot.totals };
    for (const key of old) {
        const change = changes.get(key);
        sums[change.player] = (sums[change.player] ?? 0) + change.points;
    }

    const folded = [...leftover, ...old];
    snapshot = { totals: sums, folded };
    await sheet.set('snapshot', snapshot);
    for (const key of folded) await sheet.del(key);
    await puter.kv.del(lock);
}
```

The snapshot is written before the changes are deleted. Until the deletes
finish, a folded change is both in the snapshot's totals and in the log, and
the `folded` list tells every app which changes to leave out. If the creator's
tab closes halfway, the next `fold()` finds the keys that are still there as
`leftover` and deletes them again.

Each call folds up to 100 changes, so the snapshot stays small and the deletes
finish before the lock expires. They run one after another, since an account
can only make a [limited number of calls at once](/rate-limits-and-quotas/#key-value-store).
A longer log takes a few calls.

The lock key stops two of the creator's tabs from folding at once. It expires
after a minute in case a tab closes before deleting it, as in
[Set a Lock or Cooldown](/recipes/store-temporary-data/#set-a-lock-or-cooldown).
Call `fold()` when the creator opens the sheet.

Every app now starts from the snapshot. These are the whole `load()`,
`totals()` and `onChange()` with the snapshot added:

```js
async function load () {
    const entries = await sheet.list('change:');
    snapshot = await sheet.get('snapshot') ?? { totals: {}, folded: [] };
    changes = new Map(entries.map(({ key, value }) => [key, value]));
    render();
}

function totals () {
    const sums = { ...snapshot.totals };
    for (const [key, change] of changes) {
        if (snapshot.folded.includes(key)) continue;
        sums[change.player] = (sums[change.player] ?? 0) + change.points;
    }
    return sums;
}

async function onChange (event) {
    if (event.op === 'gap') return load();

    if (event.key === 'snapshot' && event.op === 'set') {
        snapshot = 'value' in event ? event.value : await sheet.get('snapshot');
    }
    if (event.key.startsWith('change:')) {
        if (event.op === 'del') changes.delete(event.key);
        if (event.op === 'set') {
            changes.set(event.key, 'value' in event ? event.value : await sheet.get(event.key));
        }
    }
    render();
}
```

The `load()` function lists the changes before it reads the snapshot. If a
fold happens between the two reads, the changes it folded are in both, and the
`folded` list leaves them out. In the other order they could be in neither.

## Full Code

The creator makes the sheet and shares it:

```js
await puter.perms.request('kvShare', { prefix: 'sheet:', access: 'write' });

const prefix = `sheet:${crypto.randomUUID()}:`;
await puter.kv.set(`${prefix}meta`, { title: 'Game night' });
await puter.kv.share({ prefix, recipients: ['alice', 'bob'], access: 'write', label: 'Game night', notify: true });
```

Everyone runs the same code, the creator with the sheet's `prefix` and a player
with the share's `handle`:

```js
const openSheet = ({ prefix = '', handle }) => {
    const options = handle ? { handle } : {};
    const relative = (key) => key?.slice(prefix.length);
    return {
        get: (key) => puter.kv.get(prefix + key, options),
        set: (key, value) => puter.kv.set(prefix + key, value, options),
        del: (key) => puter.kv.del(prefix + key, options),
        list: async (pattern) => (await puter.kv.list(prefix + pattern, true, options))
            .map(({ key, value }) => ({ key: relative(key), value })),
        watch: (pattern, onChange) => puter.events.onLocal(
            `kv:${handle ?? puter.appID}:${prefix}${pattern}`,
            ({ event }) => onChange({ ...event, key: relative(event.key) }),
            { includeValue: true },
        ),
    };
};

const sheet = openSheet({ prefix });    // a player: openSheet({ handle })
const user = await puter.auth.getUser();

let changes = new Map();
let snapshot = { totals: {}, folded: [] };

async function addPoints (player, points) {
    const key = `change:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const change = { player, points, by: user.username };

    changes.set(key, change);
    render();
    await sheet.set(key, change);
}

async function load () {
    const entries = await sheet.list('change:');
    snapshot = await sheet.get('snapshot') ?? { totals: {}, folded: [] };
    changes = new Map(entries.map(({ key, value }) => [key, value]));
    render();
}

function totals () {
    const sums = { ...snapshot.totals };
    for (const [key, change] of changes) {
        if (snapshot.folded.includes(key)) continue;
        sums[change.player] = (sums[change.player] ?? 0) + change.points;
    }
    return sums;
}

async function onChange (event) {
    if (event.op === 'gap') return load();

    if (event.key === 'snapshot' && event.op === 'set') {
        snapshot = 'value' in event ? event.value : await sheet.get('snapshot');
    }
    if (event.key.startsWith('change:')) {
        if (event.op === 'del') changes.delete(event.key);
        if (event.op === 'set') {
            changes.set(event.key, 'value' in event ? event.value : await sheet.get(event.key));
        }
    }
    render();
}

await sheet.watch('*', onChange);
await load();
```

The creator's app also folds old changes when it opens the sheet:

```js
const KEEP = 100;      // the newest changes stay in the log

async function fold () {
    const leftover = snapshot.folded.filter((key) => changes.has(key));
    const old = [...changes.keys()].sort().slice(0, -KEEP)
        .filter((key) => !leftover.includes(key))
        .slice(0, 100);
    if (old.length + leftover.length === 0) return;

    const lock = `folding:${prefix}`;
    const inOneMinute = Math.floor(Date.now() / 1000) + 60;
    if (!await puter.kv.set(lock, true, inOneMinute, { onlyIfAbsent: true })) return;

    const sums = { ...snapshot.totals };
    for (const key of old) {
        const change = changes.get(key);
        sums[change.player] = (sums[change.player] ?? 0) + change.points;
    }

    const folded = [...leftover, ...old];
    snapshot = { totals: sums, folded };
    await sheet.set('snapshot', snapshot);
    for (const key of folded) await sheet.del(key);
    await puter.kv.del(lock);
}

await fold();
```
