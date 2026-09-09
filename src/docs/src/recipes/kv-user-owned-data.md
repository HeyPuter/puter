---
title: Store app data in the user's own account
description: Remember settings, drafts and progress for each person using your app, with no server to run, no database to set up and no storage bill.
tags: [kv, auth, data-modeling]
order: 5
---

**Use this when** your app has something to remember for the person using it:
preferences, a draft, progress through a flow, a saved list. This is the job a
traditional app gives a backend and a database.

## The whole storage layer

```html
<script src="https://js.puter.com/v2/"></script>
<script>
    (async () => {
        await puter.kv.set('settings', { theme: 'dark', sound: false });

        const settings = await puter.kv.get('settings') ?? { theme: 'light', sound: true };
    })();
</script>
```

There is no table to define, no connection string, and no API key to keep out of
the client. A key that was never written comes back empty, which is what `??`
turns into your defaults.

## Where the data actually lives

Each entry is written to the **signed-in user's own account**, in a store scoped
to your app:

- User A's `settings` and user B's `settings` are separate entries, and neither
  user can read the other's.
- Other apps in the same account get their own store, so your keys stay yours.
- The user covers their own storage under the [user-pays
  model](/user-pays-model/), which is what keeps your cost flat as the app
  grows.

Sign-in is part of the first call that needs it: [`puter.kv`](/KV/) prompts the
user to sign in to Puter, and your code carries on once they have. Write it as
if they are already signed in.

```js
if ( puter.auth.isSignedIn() ) {
    const user = await puter.auth.getUser();   // { username, uuid, ... }
}
```

## What an entry holds

Any JSON value, up to `puter.kv.MAX_VALUE_SIZE` (400 KB) per entry:

```js
await puter.kv.set('draft', { title: 'Untitled', body: '', updated: Date.now() });
await puter.kv.set('recent', ['puter.js', 'kv', 'workers']);
await puter.kv.incr('visits');                  // counters need no read
await puter.kv.expire('onboarding', 60 * 60);   // gone in an hour
```

`set()` replaces a value, and [`puter.kv.update()`](/KV/update/) changes one
field of a stored object without sending the rest:

```js
await puter.kv.update('settings', { theme: 'light' });
```

## Images, audio and other files

The key-value store is for JSON. Anything binary, an image, an audio clip, a
PDF, an export, goes to the user's drive with [`puter.fs`](/FS/): the same
account, the same sign-in, and no 400 KB ceiling. Keep the bytes in one place
and the record of them in the other:

```js
const file = await puter.fs.write(`avatars/${id}.png`, blob);
await puter.kv.set(`avatar:${id}`, { path: file.path, updated: Date.now() });
```

[Storing files in the user's own cloud
drive](/recipes/fs-user-owned-files/) covers uploads, reading files back, and
turning one into a link.

## Notes

- Keys are capped at `puter.kv.MAX_KEY_SIZE` (1 KB).
- [`puter.kv.list()`](/KV/list/) reads back the keys your app wrote for this
  user, and [`puter.kv.flush()`](/KV/flush/) empties that store. Both stop at
  your app's boundary.
- Growing past one entry has a shape for each case: a [list of objects keyed by
  id](/recipes/kv-edit-items-by-id/) while it fits in 400 KB, then [one entry per
  record](/recipes/kv-prefix-listing/) beyond that.
- Data every user has to see, such as a leaderboard or a guestbook, is the one
  thing this store is not: put it [behind a
  worker](/recipes/worker-shared-kv-store/), which runs under your account
  instead of theirs.
