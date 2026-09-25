---
title: Store Data
description: "Learn how to store data in the Puter.js key-value database. Every entry lives inside the user's own Puter account."
tags: [kv, auth, data-modeling]
order: 5
---

The foundation of every application is storing data, and in Puter.js you do that
with the [key-value store API](/KV/). It supports the standard operations you
would expect from any database, such as writes, reads, updates, deletes, and
more. All data lives inside the user's own Puter account.

## Set

To store data, use the [`puter.kv.set()`](/KV/set/) method. It takes a key and a
value:

```js
await puter.kv.set('theme', 'dark');
```

A value can be a string, a number, a boolean, or a whole object or array, so a
structured record goes in the same way a single setting does:

```js
await puter.kv.set('settings', { theme: 'dark', sound: false, volume: 0.8 });
await puter.kv.set('recent', ['puter.js', 'kv', 'workers']);
```

Setting the same key again replaces its value:

```js
await puter.kv.set('theme', 'dark');
await puter.kv.set('theme', 'light');   // 'theme' is now 'light'
```

## Get

To read it back, use the [`puter.kv.get()`](/KV/get/) method. It takes a key and
returns the value in the shape you stored it:

```js
const settings = await puter.kv.get('settings');
settings.theme;      // 'dark'
```

A key that was never written comes back empty, which is where your defaults go:

```js
const settings = await puter.kv.get('settings') ?? { theme: 'light', sound: true };
```

For most apps that is the whole storage layer. You call
[`puter.kv.set()`](/KV/set/) when something changes and
[`puter.kv.get()`](/KV/get/) when the app loads.

## Where the Data Lives

Each entry is written to the **signed-in user's own account**, inside a sandbox
that belongs to your app. User A's `settings` and user B's `settings` are
separate entries, and neither user can read the other's. Every other app in the
same account gets its own sandbox, so your keys and another app's keys never
mix. The user covers their own storage under the [User-Pays
Model](/user-pays-model/).

## List

To see what you stored, use the [`puter.kv.list()`](/KV/list/) method. It
returns the keys your app wrote for this user, sorted by key:

```js
const keys = await puter.kv.list();
// ['recent', 'settings', 'theme']
```

Pass `true` to get the values along with them:

```js
const entries = await puter.kv.list(true);
// [{ key: 'recent', value: ['puter.js', 'kv', 'workers'] }, ...]
```

## Delete

To remove one entry, use the [`puter.kv.del()`](/KV/del/) method:

```js
await puter.kv.del('theme');
```

## Flush

To empty your app's sandbox for this user, use the
[`puter.kv.flush()`](/KV/flush/) method:

```js
await puter.kv.flush();
```

## Notes

- Binary data, such as an image, an audio clip or a PDF, goes to the user's
  drive with the [filesystem API](/FS/) instead. [Store files in the user's own
  Puter account](/recipes/store-files/) covers it.
- Data every user has to see, such as a leaderboard or a guestbook, goes [behind
  a worker](/recipes/store-server-side-data/), which runs under your account
  instead of theirs.
