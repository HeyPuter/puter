---
title: puter.perms.request()
description: Request access to a user's data or resources, prompting only when the access isn't already held.
platforms: [websites, apps]
---

Request access to something belonging to the user. The first argument names the resource; the second carries the details that resource takes.

The user is prompted to allow or deny. Anything already granted is skipped, so a call whose access is fully in place doesn't prompt at all. [`puter.perms.check()`](/Perms/check/) reads the same state, so the two always agree.

Inside the Puter desktop the prompt is shown as a dialog. On websites, it opens in a popup window on the Puter origin — call this from a user gesture (e.g. a click handler) so the browser doesn't block the popup; without a gesture, a consent dialog is shown first and the popup opens when the user clicks Continue.

## Syntax

```js
puter.perms.request(resource)
puter.perms.request(resource, details)
puter.perms.request(requests)
```

## Parameters

#### `resource` (string) (required)

What the request is about. The resource decides which details are accepted and what the call resolves to:

| Resource | Details | Resolves to |
| -------- | ------- | ----------- |
| `'email'` | — | The user's email address, or `undefined` if denied |
| `'folder'` | `{ name, access }` | The folder's path, or `undefined` if denied |
| `'apps'` | `{ access }` | `true` if granted |
| `'subdomains'` | `{ access }` | `true` if granted |
| `'appData'` | `{ app, scopes }` | `true` if granted |
| `'appRootDir'` | `{ app, access }` | The app's root directory, or `undefined` if denied |
| `'permission'` | `{ permission }` or `{ permissions }` | `true` if granted |

#### `details` (object) (optional)

The fields the resource takes:

- **`name`** (string) — for `'folder'`: `'Desktop'`, `'Documents'`, `'Pictures'`, or `'Videos'`.
- **`access`** (string) — `'read'` (the default) or `'write'`. `write` implies read, and for `'apps'` and `'subdomains'` it covers managing them as well as reading them.
- **`app`** (string | object) — for `'appData'`: the target app, by uid or by registered name. For `'appRootDir'`: the app's uid, or an object with one.
- **`scopes`** (string | array | object) — for `'appData'`: what this app wants to do with that data. See [Using another app's data](/Perms/appData/) for the full scope forms.
- **`permission`** (string) / **`permissions`** (array of strings) — for `'permission'`: a raw permission string, or several to put behind one prompt. Pass one or the other, not both.

#### `requests` (array) (optional)

Instead of a resource and details, an array asks for several things at once — see [Batching](#batching) below. Each entry is an object naming its own `resource` alongside that resource's details.

## Return value

A `Promise` resolving to what the resource names in the table above. Anything denied resolves to a falsy value (`false` or `undefined`), so one `if` covers both outcomes.

The array form resolves to an array of those values, in the order asked.

## Raw permission strings

`'permission'` is the escape hatch for a resource with no shorthand of its own. Permission strings follow a format per resource type:

- User email: `user:{uuid}:email:read`
- File system: `fs:{path}:{read|write}`
- Apps: `apps-of-user:{uuid}:{read|write}`
- Subdomains: `subdomains-of-user:{uuid}:{read|write}`
- An app's root directory: `app-root-dir:{app_uid}:{read|write}`

Some permission strings are not supported and are denied silently.

A lone string that names no resource is treated as a permission string, so `puter.perms.request('fs:/user/Documents:read')` keeps working.

## Batching

Pass an array to ask for several things in one call. Everything already granted is settled first, so the prompt lists only what is actually missing — and never appears at all when the whole set is already granted. The user answers once, and the answer covers all of it.

A denied prompt denies every entry that needed it. Entries that were already granted keep their value, since nothing was asked about them.

```js
const [documents, apps] = await puter.perms.request([
    { resource: 'folder', name: 'Documents', access: 'write' },
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

<strong class="example-title">Request a raw permission string</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request">Request Permission</button>
    <script>
        document.getElementById('request').addEventListener('click', async () => {
            const user = await puter.auth.getUser();
            const granted = await puter.perms.request('permission', {
                permission: `user:${user.uuid}:email:read`,
            });
            puter.print(granted ? 'Permission granted' : 'Permission denied');
        });
    </script>
</body>
</html>
```
