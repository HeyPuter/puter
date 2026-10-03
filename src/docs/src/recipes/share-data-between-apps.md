---
title: Share Data Between Apps
description: "Learn how one Puter.js app can read and write another app's key-value data with the user's permission, and how to keep entries such as tokens private to your own app."
tags: [kv, perms]
order: 16
---

Every app gets its own key-value store inside each user's account. If a Contacts
app and a Calendar app both save a key called `settings`, those are two
separate entries, and neither app can see the other's. It works like each app
having its own database.

Sometimes apps should work together. A calendar might want to show birthdays
from the user's contacts, or add an invite the user can later see in both apps.
With [`puter.kv`](/KV/), one app can use another app's data once the user allows
it. The other app can still mark entries it never wants shared, such as a login
token, as private.

## Ask the User for Access

The calendar asks for access to the contacts app's data with
[`puter.perms.request()`](/Perms/appData/). The user sees a prompt naming both
apps and what is being asked for:

```js
const contacts = await puter.apps.get('contacts');

const granted = await puter.perms.request('appData', {
    app: contacts.uid,
    scopes: { kv: 'read' },
});
```

It resolves to `true` once the user allows it, and `false` if they decline. Once
allowed, later calls return `true` without asking again.

There are three levels of access, and you ask only for the ones you need:

| Scope | Lets your app call |
| --- | --- |
| `read` | `get`, `list` |
| `write` | `set`, `add`, `incr`, `decr`, `update` |
| `delete` | `del`, `remove`, `expire`, `expireAt` |

`write` does not include `delete`. An app with `write` access can add and change
entries but can't remove any. To ask for both, pass an array:
`scopes: { kv: ['read', 'write'] }`. Clearing another app's whole store with
[`puter.kv.flush()`](/KV/flush/) is never allowed.

On a website, sign the user in with [`puter.auth.signIn()`](/Auth/signIn/) before
asking, as [Using another app's data](/Perms/appData/) explains.

## Read Another App's Data

To use the other app's store instead of your own, pass `{ appUuid }` as the last
argument of any `puter.kv` call:

```js
const options = { appUuid: contacts.uid };

const birthdays = await puter.kv.get('birthdays', options);
```

For [`puter.kv.list()`](/KV/list/), put `appUuid` in the options object:

```js
const keys = await puter.kv.list({ pattern: 'contact:', appUuid: contacts.uid });
```

Without access, or for a level of access the user didn't allow, the call rejects
with the code `forbidden`.

## Write to Another App's Data

With `write` access, the same options object works on the calls that write:

```js
await puter.kv.add('invites', [{ title: 'Team lunch', at: '2026-10-09' }], options);
await puter.kv.update('birthdays', { bob: '01-01' }, options);
await puter.kv.incr('inviteCount', 1, options);
await puter.kv.set('lastSyncedBy', 'calendar', options);
```

The contacts app then reads `invites` from its own store as usual, with no
options at all.

## Keep an Entry Private

Some entries should never leave your app, even when the user grants another app
access to its data. A login token is the usual example: the user can't see what
your store holds when they approve a request, so they can't know they would be
handing it over.

To mark an entry private, pass `disableSharing: true` when you write it:

```js
await puter.kv.set('oauthToken', token, { disableSharing: true });
```

For any other app, a private entry acts as if it doesn't exist:

- [`puter.kv.get()`](/KV/get/) returns `null`, the same as for a missing key, so
  the other app can't even tell that something is stored there.
- [`puter.kv.list()`](/KV/list/) leaves it out.
- Calls that change or delete it are rejected with `forbidden`, so another app
  can't overwrite it either.

Your own app reads and writes it as normal. Updating it with
[`puter.kv.update()`](/KV/update/), [`puter.kv.incr()`](/KV/incr/) and the
other calls that change part of an entry keeps it private.

The flag also works with an expiry, and with a batch write, where it marks every
entry in the batch:

```js
const inOneHour = Math.floor(Date.now() / 1000) + 60 * 60;
await puter.kv.set('session', session, inOneHour, { disableSharing: true });

await puter.kv.set([
    { key: 'apiKey', value: apiKey },
    { key: 'refreshToken', value: refreshToken },
], { disableSharing: true });
```

## Watch Out When Rewriting a Private Entry

[`puter.kv.set()`](/KV/set/) replaces the whole entry, flag included. Writing a
private key again without the flag makes it shareable:

```js
await puter.kv.set('oauthToken', newToken);                            // now shareable
await puter.kv.set('oauthToken', newToken, { disableSharing: true });  // still private
```

To avoid forgetting, write private entries through one small helper:

```js
const setPrivate = (key, value) => puter.kv.set(key, value, { disableSharing: true });
```

## Notes

- Only the app that owns an entry can mark it private. Passing `disableSharing`
  together with `appUuid` is rejected with `bad_request`.
- Private is not the same as encrypted. It keeps other apps out, but the data is
  still stored in the user's account like the rest of your app's data.
- Private entries also don't show up for other apps or other users watching your
  keys through [Events](/Events/).
- This shares data between apps for one user. To share data between users, use
  a [worker](/recipes/store-server-side-data/) or an [Events share
  handle](/Events/onLocal/#sharing-key-value-events-with-another-user).
