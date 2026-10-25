---
title: Let Someone View Your Data
description: "Learn how to let users give another person read-only access to part of their data in your app, like a workout log they want their coach to see."
tags: [kv, perms]
order: 18
---

A fitness app keeps each user's workouts in their own Puter account. A user who
trains with a coach wants the coach to see the log, but not change it. With
[`puter.kv.share()`](/KV/share/) and read access, the coach can read and list
the keys under a prefix, and any write the coach tries is refused.

A share has one of three levels, and each includes the ones before it:

- **watch**: they only need live updates.
- **read**: they need to look things up or catch up.
- **write**: they work on the data with you. Write includes delete, so everyone
  with write access can change or remove anything under the prefix.

This recipe uses read. [Share a List With Someone](/recipes/share-a-list-with-someone/)
uses write, and [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/)
uses watch.

## Share the Log

The app keeps each workout under `workouts:<date>`. Ask the user for permission
to share the `workouts:` prefix with [`puter.perms.request()`](/Perms/request/),
then share it with the coach:

```js
await puter.kv.set('workouts:2026-10-24', { type: 'run', km: 8 });

await puter.perms.request('kvShare', { prefix: 'workouts:', access: 'read' });

const share = await puter.kv.share({
    prefix: 'workouts:',
    recipient: 'coach_kim',
    access: 'read',
    label: 'Workouts from Dan',
});
```

The permission prompt only appears the first time.
[Share a List With Someone](/recipes/share-a-list-with-someone/#ask-once-for-permission-to-share)
explains it. Read is the default level of [`puter.kv.share()`](/KV/share/), so
you can leave out `access` for a read share.

## Read the Log as the Coach

The coach finds every share made with them in your app with
[`puter.kv.listShared()`](/KV/listShared/), and passes each share's `handle` to
read it. Keys are relative to the shared prefix, so `workouts:2026-10-24` is
`2026-10-24` to the coach:

```js
const { items } = await puter.kv.listShared();

for (const { handle, label, access } of items) {
    const workouts = await puter.kv.list(true, { handle });
    // [{ key: '2026-10-24', value: { type: 'run', km: 8 } }]
    showClient(label, workouts, { canEdit: access === 'write' });
}
```

To read one day, pass the handle to [`puter.kv.get()`](/KV/get/):

```js
const run = await puter.kv.get('2026-10-24', { handle });
```

Read access lets the coach load the log whenever they open your app, so they
always see the current data.

## Show Edit Controls Only With Write Access

Each share from [`puter.kv.listShared()`](/KV/listShared/) has an `access` field.
Show edit buttons only when it's `'write'`. A write through a read share is
rejected with `kv_handle_access_denied`, so your app can also explain it when
it happens:

```js
try {
    await puter.kv.set('2026-10-25', { type: 'rest' }, { handle });
} catch (error) {
    if (error.code === 'kv_handle_access_denied') {
        showMessage('You can view this log, but not change it.');
    }
}
```

## Let Them Edit Later

To change the coach's access, share the same prefix with them again. This
changes the existing share and keeps its handle, so the coach's app and its
live updates keep working.

Your app's permission to share has a level too. A `read` permission covers
`read` and `watch` shares, so ask again with `access: 'write'` before giving
write access. The user sees a new prompt for it:

```js
await puter.perms.request('kvShare', { prefix: 'workouts:', access: 'write' });

const raised = await puter.kv.share('workouts:', 'coach_kim', 'write');
// raised.handle === share.handle
```

Sharing again with `'read'` sets it back.

## Share Only Part of the Data

A share covers only the keys under its prefix. A budget app can share one month
with an accountant by sharing `budget:2026-10:`, and the other months stay
hidden.

Entries saved with [`disableSharing: true`](/KV/set/) stay hidden even inside a shared
prefix, like this private note:

```js
await puter.kv.set('workouts:2026-10-24:note', 'Knee hurt a bit', { disableSharing: true });
```

To the coach, [`puter.kv.get()`](/KV/get/) returns `null` for it and
[`puter.kv.list()`](/KV/list/) leaves it out.

To see who has access, or to stop sharing, see
[Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/).
