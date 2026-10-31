---
title: Share Data Between Apps
description: "Learn how to let one Puter.js app read and write another app's key-value data with the user's permission, and how to keep some entries private."
tags: [kv, perms]
order: 16
---

Each app has its own separate key-value store in every user's account. If a
Contacts app and a Calendar app both save a key called `settings`, those are two
different entries, and neither app can see the other's.

Sometimes you want apps to work together, like a calendar that shows birthdays
from a contacts app. With [`puter.kv`](/KV/), an app can use another app's data
once the user allows it. An app can also mark entries as private so they're
never shared, which is useful for things like login tokens.

This is for apps of the same user. To share data with another user, see
[Share a List With Someone](/recipes/share-a-list-with-someone/).

## Ask the User for Access

The calendar asks for access to the contacts app's data with
[`puter.perms.request()`](/Perms/appData/). The user sees a prompt naming both
apps and what's being asked for:

```js
const contacts = await puter.apps.get('contacts');

const granted = await puter.perms.request('appData', {
    app: contacts.uid,
    scopes: { kv: 'read' },
});
```

This returns `true` if the user allows it and `false` if they don't. Once
allowed, later calls return `true` without asking again.

There are three levels of access, `read`, `write` and `delete`. Ask only for
what you need. The methods each one allows are listed in
[Using another app's data](/Perms/appData/). A `write` grant doesn't include
`delete`, so the app can add and change entries but can't remove them. To ask
for more than one, pass an array, like `scopes: { kv: ['read', 'write'] }`.
Clearing another app's whole store with [`puter.kv.flush()`](/KV/flush/) is
never allowed.

On a website, sign the user in with [`puter.auth.signIn()`](/Auth/signIn/)
before asking. See [Using another app's data](/Perms/appData/) for details.

## Read Another App's Data

To use another app's store, pass `{ appUuid }` as the last argument to any
[`puter.kv`](/KV/) call:

```js
const options = { appUuid: contacts.uid };

const birthdays = await puter.kv.get('birthdays', options);
```

For [`puter.kv.list()`](/KV/list/), put `appUuid` in the options object:

```js
const keys = await puter.kv.list({ pattern: 'contact:', appUuid: contacts.uid });
```

A call the user didn't allow is rejected with `forbidden`.

## Write to Another App's Data

With `write` access, the same option works for calls that write:

```js
await puter.kv.add('invites', [{ title: 'Team lunch', at: '2026-10-09' }], options);
await puter.kv.update('birthdays', { bob: '01-01' }, options);
await puter.kv.incr('inviteCount', 1, options);
await puter.kv.set('lastSyncedBy', 'calendar', options);
```

The contacts app sees the new `invites` in its own store like any other data.

## Keep an Entry Private

Some entries should never leave your app, even if the user gives another app
access to your data. A login token is a good example. When the user approves a
request, they can't see what's in your store, so they wouldn't know they're
handing it over.

To make an entry private, pass `disableSharing: true` when you save it with
[`puter.kv.set()`](/KV/set/):

```js
await puter.kv.set('oauthToken', token, { disableSharing: true });
```

To other apps, a private entry looks like it doesn't exist:

- [`puter.kv.get()`](/KV/get/) returns `null`, just like a missing key.
- [`puter.kv.list()`](/KV/list/) leaves it out.
- Changing or deleting it is rejected with `forbidden`.
- [Events](/Events/) for it aren't delivered.

It's also hidden from other users the data is shared with, as
[Share Only Part of the Data](/recipes/let-someone-view-your-data/#share-only-part-of-the-data)
shows. Your own app reads and writes it normally. Calls that change part of an entry,
like [`puter.kv.update()`](/KV/update/) and [`puter.kv.incr()`](/KV/incr/), keep
it private. Private doesn't mean encrypted. The entry is stored in the user's
account like the rest of your app's data.

It also works with an expiry, and with a batch write, where it applies to every
entry in the batch:

```js
const inOneHour = Math.floor(Date.now() / 1000) + 60 * 60;
await puter.kv.set('session', session, inOneHour, { disableSharing: true });

await puter.kv.set([
    { key: 'apiKey', value: apiKey },
    { key: 'refreshToken', value: refreshToken },
], { disableSharing: true });
```

Only the app that owns an entry can make it private, so passing
`disableSharing` together with `appUuid` is rejected with `bad_request`.

## Save a Private Entry Again

[`puter.kv.set()`](/KV/set/) replaces the whole entry, including the private
flag, so pass `disableSharing: true` every time you save a private key. A small
helper keeps it from being left out:

```js
const setPrivate = (key, value) => puter.kv.set(key, value, { disableSharing: true });

await setPrivate('oauthToken', newToken);
```
