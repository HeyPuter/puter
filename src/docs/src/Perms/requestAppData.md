---
title: puter.perms.requestAppData()
description: Request permission to use another app's data — its key-value store and its AppData files.
platforms: [websites, apps]
---

Request permission for your app to use another app's data belonging to the signed-in user: that app's key-value namespace, its `AppData` directory, or both. A calendar might read a contacts app's entries to show birthdays, and add an invite the user can later cancel from either app.

The user is prompted once and sees exactly which apps and which kinds of access are involved. If the permission has already been granted the user is not prompted and `true` is returned. If the user declines, `false` is returned.

On a website, sign the user in to your site first with [`puter.auth.signIn()`](/Auth/signIn/). This method reads the signed-in user's identity before it can prompt, so for a signed-out visitor it rejects with `Unauthorized` and no prompt is shown. Answering a permission prompt does not by itself sign the user in to your site, so guard the call:

```js
if (!puter.authToken) await puter.auth.signIn();
```

## Syntax

```js
puter.perms.requestAppData(appIdentifier, scopes)
```

## Parameters

#### `appIdentifier` (String | Object) (required)
The app whose data you want to use. Either its uid (`app-…`), its registered name, or an object carrying one: `{ uid: 'app-…' }` or `{ name: 'contacts' }`.

#### `scopes` (String | Array | Object) (required)
What access to ask for. Three equivalent forms:

- **A single word** applied to both stores: `'read'`, `'write'`, or `'delete'`.
- **An array of `store:name` pairs**: `['kv:get', 'fs:read']`.
- **An object per store**: `{ kv: ['get', 'set'], fs: 'read' }`.

`store` is `kv` (the app's key-value data) or `fs` (its files under `AppData`).

`name` is either an access class or a single key-value operation:

| Class | Covers |
| --- | --- |
| `read` | `get`, `list` |
| `write` | `set`, `add`, `incr`, `decr`, `update` |
| `delete` | `del`, `remove`, `expire`, `expireAt` |

**`delete` is separate from `write`.** An app granted `write` can add and change entries but cannot remove any — ask for `delete` explicitly when it needs to. Emptying another app's whole key-value store is never available at any scope.

## Return value

A `Promise` that resolves to:
- `true` - If your app may now use that data
- `false` - If the user declined

The promise rejects if the named app does not exist, or if a scope is misspelled.

## Examples

<strong class="example-title">Read another app's data</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request">Use Contacts' data</button>
    <script>
        document.getElementById('request').addEventListener('click', async () => {
            const contacts = await puter.apps.get('contacts');
            const granted = await puter.perms.requestAppData(contacts.uid, 'read');
            if (!granted) {
                puter.print('Permission denied');
                return;
            }
            // Read from the other app's key-value namespace.
            const birthdays = await puter.kv.get('birthdays', { appUuid: contacts.uid });
            puter.print(`Birthdays: ${JSON.stringify(birthdays)}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Add an entry, and be able to remove it later</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="book">Book, then cancel</button>
    <script>
        document.getElementById('book').addEventListener('click', async () => {
            const contacts = await puter.apps.get('contacts');
            // Writing and deleting are separate scopes, so ask for both.
            const granted = await puter.perms.requestAppData(contacts.uid, {
                kv: ['set', 'del'],
            });
            if (!granted) return;

            await puter.kv.set('invite:42', { when: 'friday' }, { appUuid: contacts.uid });
            puter.print('Invite added');

            await puter.kv.del('invite:42', { appUuid: contacts.uid });
            puter.print('Invite cancelled');
        });
    </script>
</body>
</html>
```

<strong class="example-title">Read another app's files</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="files">List Contacts' files</button>
    <script>
        document.getElementById('files').addEventListener('click', async () => {
            const contacts = await puter.apps.get('contacts');
            const granted = await puter.perms.requestAppData(contacts.uid, ['fs:read']);
            if (!granted) return;

            const user = await puter.auth.getUser();
            const items = await puter.fs.readdir(`/${user.username}/AppData/${contacts.uid}`);
            puter.print(`${items.length} file(s)`);
        });
    </script>
</body>
</html>
```

## Keeping your own data private

Another app can only reach your data if the user grants it, but the user cannot see what a key-value namespace holds before answering. If your app stores something no other app should ever read — a cached OAuth token, a licence key — mark it private when you write it:

```js
await puter.kv.set('googleRefreshToken', token, { disableSharing: true });
```

A private entry is invisible to every other app: reads return nothing, listings omit it, and writes and deletes are refused — regardless of what the user has granted. Your own app reads and writes it normally, and writing the key again without the flag makes it shareable once more.

To keep *all* of your app's data out of this feature, set `share_app_data` to `false` in your app's metadata. Requests naming your app are then refused and the user is never prompted.

## Notes

Granted access is scoped to the user who granted it, and only to the two stores above — it does not extend to that app's source, settings, or anything outside their per-user data.

Access ends automatically when the target app is deleted. Grants are also withdrawn if the app is later re-created under the same identifier, so a new owner of that identifier does not inherit consent the user gave its predecessor.
