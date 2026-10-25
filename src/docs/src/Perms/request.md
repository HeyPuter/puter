---
title: puter.perms.request()
description: Request access to a user's data or resources, prompting only when the access isn't already held.
platforms: [websites, apps]
---

Request access to something belonging to the user. The first argument names the resource; the second carries the details that resource takes.

<div class="info">

The user is prompted to grant or deny access. If they already granted it, they aren't prompted again, so a call whose access is fully in place doesn't prompt at all. [`puter.perms.check()`](/Perms/check/) reads the same state, so the two always agree.

</div>

Inside the Puter desktop the prompt is shown as a dialog. On websites, it opens in a popup window on the Puter origin. Call this from a user gesture, such as a click handler, so the browser doesn't block the popup. Without a gesture, a consent dialog is shown first and the popup opens when the user clicks Continue.

## Syntax

```js
puter.perms.request(resource)
puter.perms.request(resource, details)
puter.perms.request(requests)
```

## Parameters

#### `resource` (string) (required)

What the request is about. The resource decides which details are accepted and what the call resolves to. Each resource is also a constant on `puter.perms.Resource`, so `puter.perms.Resource.FS` is `'fs'`.

| Resource | Constant | Details | Resolves to |
| -------- | -------- | ------- | ----------- |
| `'fs'` | `Resource.FS` | `{ path, uid, access, create }` | `true` if granted |
| `'folder'` | `Resource.FOLDER` | `{ name, access }` | The folder's path, or `undefined` if denied |
| `'email'` | `Resource.EMAIL` | None | The user's email address, or `undefined` if denied |
| `'apps'` | `Resource.APPS` | `{ access }` | `true` if granted |
| `'subdomains'` | `Resource.SUBDOMAINS` | `{ access }` | `true` if granted |
| `'appData'` | `Resource.APP_DATA` | `{ app, scopes }` | `true` if granted |
| `'appRootDir'` | `Resource.APP_ROOT_DIR` | `{ app, access }` | The app's root directory, or `undefined` if denied |
| `'backgroundEvents'` | `Resource.BACKGROUND_EVENTS` | None | `true` if granted |
| `'kvShare'` | `Resource.KV_SHARE` | `{ prefix, access }` | `true` if granted |

#### `details` (object) (optional)

The fields the resource takes:

- **`path`** (string): for `'fs'`, the file or folder. Pass an absolute path, or `~` or a path that starts with `~/` for the user's home folder. Access to a folder covers everything inside it.
- **`uid`** (string): for `'fs'`, the file or folder's uid, in place of `path`. Pass one or the other.
- **`access`** (string): `'read'` (the default) or `'write'`, also available as `puter.perms.Access.READ` and `puter.perms.Access.WRITE`. Write access includes read access. For `'apps'`, write access lets the app see who uses the user's apps, including email addresses those users shared with them. For `'subdomains'`, write access covers creating, changing and deleting them. For `'kvShare'`, `access` is the highest level of share the app may create, and is `'watch'` (the default), `'read'`, or `'write'`. A `'watch'` share sends change events for the region, a `'read'` share also lets the holder read it, and a `'write'` share also lets them change and delete keys in it. Each level includes the ones below it, so an app allowed `'write'` can also create `'read'` and `'watch'` shares. See [`puter.kv.share()`](/KV/share/).
- **`create`** (boolean | `'dir'` | `'file'`): for `'fs'`, whether to create a missing `path` once the user allows it, and as what. Defaults to `true`. See [Creating a path on request](#creating-a-path-on-request) below.
- **`name`** (string): for `'folder'`, one of `'Desktop'`, `'Documents'`, `'Pictures'`, or `'Videos'`. These are also constants on `puter.perms.Folder`.
- **`app`** (string | object): for `'appData'`, the target app, by uid or by registered name. For `'appRootDir'`, the app's uid, or an object with one.
- **`scopes`** (string | array | object): for `'appData'`, what this app wants to do with that data. See [Using another app's data](/Perms/appData/) for the full scope forms.
- **`prefix`** (string): for `'kvShare'`, the key prefix of the region the app may share with other people it picks, such as `'workspace:abc:'`. It covers every key under it. It has to name part of the app's data, not all of it, and the segments between its `:` separators can use only lowercase letters (`a`-`z`), digits, `_`, `.`, and `-`. The permission string the request names (see [permission strings](#permission-strings-deprecated)) can be at most 255 characters, so the longest prefix depends on the app's uid and the level. For an app uid of the usual form, `app-` and a uuid, the prefix without its trailing `:` can be at most 161 characters for `'watch'`, 156 for `'read'`, and 155 for `'write'`.

The `'fs'`, `'backgroundEvents'`, and `'kvShare'` resources reject a field they don't take, so a misspelled option fails with `invalid_argument`.

#### `requests` (array) (optional)

Instead of a resource and details, an array asks for several things at once. See [Batching](#batching) below. Each entry is an object naming its own `resource` alongside that resource's details.

## Return value

A `Promise` resolving to what the resource names in the table above. Anything denied resolves to a falsy value (`false` or `undefined`), so one `if` covers both outcomes.

The array form resolves to an array of those values, in the order asked.

The promise rejects with `{ message, code: 'invalid_argument' }` when the details are invalid, before anything is asked. That covers an unknown resource passed with details, a value the resource doesn't accept, a `path` that isn't `~` and doesn't start with `/` or `~/`, a `uid` that isn't a uid, a `'kvShare'` prefix over its length limit, and a `'kvShare'` request from a page that isn't running as an app.

A string passed on its own that names no resource is read as a [permission string](#permission-strings-deprecated). If it isn't one the user can be asked about, the promise resolves to `false` without a prompt.

## Creating a path on request

An `'fs'` request for a path that doesn't exist yet creates it on approval. Once the user clicks Allow, the path is created on the server (as the user, inside their own home folder) before access is granted. This is what `create` does by default.

```js
const granted = await puter.perms.request('fs', {
    path: '~/.mail',
    access: 'write',
});
```

- **`true`** (the default): create the path if it's missing, choosing a file or a folder from its basename. Strip one leading `.`, and a `.` remaining in what's left means a file. Otherwise it's a folder.

    | Path | Basename | Created as |
    | ---- | -------- | ---------- |
    | `~/.mail` | `.mail` | Folder |
    | `~/.config` | `.config` | Folder |
    | `~/Documents` | `Documents` | Folder |
    | `~/notes.txt` | `notes.txt` | File |
    | `~/.env.local` | `.env.local` | File |
    | `~/archive.tar.gz` | `archive.tar.gz` | File |

    A dot inside a folder name is read the same way, so `~/my.folder` creates a file named `my.folder`. Pass `'dir'` when the name doesn't fit the pattern.
- **`'dir'`** / **`'file'`**: force the kind instead of guessing from the basename.
- **`false`**: create nothing. A request for a missing path then resolves to `false` without a prompt, since there's nothing to grant access to.

```js
// my.folder would be created as a file without `create: 'dir'`.
await puter.perms.request('fs', {
    path: '~/my.folder',
    access: 'write',
    create: 'dir',
});
```

Creation only happens after the user clicks Allow. A [`check()`](/Perms/check/) or a denied request creates nothing. If the path already exists, nothing is created and access applies to the existing entry. With `create: true` that's whatever kind it is. The `create` option has no effect on a `uid`.

Missing folders along the way are created too. A request for `~/a/b/.mail` creates `a` and `b` as folders if they don't exist yet, not just `.mail`.

A request resolves to `false` without a prompt when Puter can't grant what it would create:

- The missing path is outside the user's own home folder, or inside `AppData` or `Trash`.
- The missing path is more than 16 folders below the home folder.
- One prompt would create more than 4 entries.
- `create` is `'dir'` or `'file'` and the path already exists as the other kind.

The limits are also listed in [rate limits and quotas](/rate-limits-and-quotas/#permissions).

A batch shares one prompt, so at most one distinct `create` value may apply to it. Passing none is fine, and so is passing the same value on every entry. Two different values across entries throw before anything is asked.

A malformed `create` rejects the promise with `{ message, code: 'invalid_argument' }` instead of resolving to `false`, since an invalid value is a bug in the caller and not a user's answer. That covers a `create` that isn't `true`, `false`, `'dir'`, or `'file'`, and a batch that names conflicting values.

## Permission strings (deprecated)

The `'permission'` resource, and a permission string passed as the only argument, are deprecated. They take a raw permission string (`{ permission }`, or `{ permissions }` for several under one prompt) and resolve to `true` if granted. Each string they accept has a resource that asks for the same access:

| Permission string | Resource |
| ----------------- | -------- |
| `fs:{path or uid}:{read or write}` | `'fs'` with `path` or `uid` |
| `fs:{path or uid}:{see or list}` | `'fs'` with `access: 'read'`, which covers both |
| `user:{uuid}:email:read` | `'email'` |
| `apps-of-user:{uuid}:{read or write}` | `'apps'` |
| `subdomains-of-user:{uuid}:{read or write}` | `'subdomains'` |
| `app-data:{appUid}`, with an optional store and scope | `'appData'` |
| `app-root-dir:{appUid}:{read or write}` | `'appRootDir'` |
| `events:background` | `'backgroundEvents'` |
| `manage:kv-share:{uuid}:{appUid}:{prefix}` | `'kvShare'` with `access: 'watch'` |
| `manage:kv-share-read:{uuid}:{appUid}:{prefix}` | `'kvShare'` with `access: 'read'` |
| `manage:kv-share-write:{uuid}:{appUid}:{prefix}` | `'kvShare'` with `access: 'write'` |

Any other string, or one that names another user, is denied without a prompt. Inside a path, write a `:` as `\C` and a `\` as `\\`. A string with any other `\` escape is denied without a prompt too.

## Batching

Pass an array to ask for several things in one call. Everything already granted is settled first, so the prompt lists only what is actually missing, and doesn't appear at all when the whole set is already granted. The user answers once, and the answer covers all of it.

A denied prompt denies every entry that needed it. Entries that were already granted keep their value, since nothing was asked about them.

```js
const [documents, mail, apps] = await puter.perms.request([
    { resource: 'folder', name: 'Documents', access: 'write' },
    { resource: 'fs', path: '~/.mail', access: 'read' },
    { resource: 'apps' },
]);
```

## Examples

<strong class="example-title">Request write access to the Documents folder</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request">Request Documents Access</button>
    <script>
        document.getElementById('request').addEventListener('click', async () => {
            const path = await puter.perms.request('folder', { name: 'Documents', access: 'write' });
            if (path) {
                await puter.fs.write(`${path}/hello.txt`, 'Hello from Documents!');
                puter.print(`Wrote to ${path}`);
            } else {
                puter.print('Documents write access denied');
            }
        });
    </script>
</body>
</html>
```

<strong class="example-title">Request write access to one file</strong>

```html;perms-request-fs
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-fs">Request Access to notes.txt</button>
    <script>
        document.getElementById('request-fs').addEventListener('click', async () => {
            // `~` is the user's home folder. The file is created if it's missing.
            const granted = await puter.perms.request(puter.perms.Resource.FS, {
                path: '~/Documents/notes.txt',
                access: puter.perms.Access.WRITE,
            });
            if (granted) {
                await puter.fs.write('~/Documents/notes.txt', 'Hello!');
                puter.print('Wrote notes.txt');
            } else {
                puter.print('Access denied');
            }
        });
    </script>
</body>
</html>
```

<strong class="example-title">Request the user's email address</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request">Request Email Access</button>
    <script>
        document.getElementById('request').addEventListener('click', async () => {
            const email = await puter.perms.request('email');
            puter.print(email ? `Email: ${email}` : 'Email access denied');
        });
    </script>
</body>
</html>
```

<strong class="example-title">Ask for everything the app needs, in one prompt</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request">Set Up</button>
    <script>
        document.getElementById('request').addEventListener('click', async () => {
            const [documents, apps] = await puter.perms.request([
                { resource: 'folder', name: 'Documents', access: 'write' },
                { resource: 'apps' },
            ]);
            puter.print(`Documents: ${documents ?? 'denied'}`);
            puter.print(`Apps: ${apps ? 'granted' : 'denied'}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Request access to a folder that doesn't exist yet, creating it on approval</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request">Set Up Mail Folder</button>
    <script>
        document.getElementById('request').addEventListener('click', async () => {
            // `.mail` is created as a folder if it doesn't exist yet.
            const granted = await puter.perms.request('fs', {
                path: '~/.mail',
                access: 'write',
            });
            puter.print(granted ? 'Mail folder ready' : 'Permission denied');
        });
    </script>
</body>
</html>
```
