---
title: Perms
description: Request permissions to access user data and resources with Puter.js Permissions API
platforms: [websites, apps]
---

The Permissions API enables your application to request access to user data and resources such as email addresses, special folders (Desktop, Documents, Pictures, Videos), apps, subdomains, and other apps' saved data.

There are two methods. [`puter.perms.request()`](/Perms/request/) asks the user for access, and [`puter.perms.check()`](/Perms/check/) reports whether they have already granted it without prompting.

Both take the same two arguments: the resource being asked about, and the details that resource needs.

```js
await puter.perms.request('email');
await puter.perms.request('folder', { name: 'Documents', access: 'write' });
await puter.perms.request('apps', { access: 'read' });
await puter.perms.request('appData', { app: 'contacts', scopes: 'read' });
```

When requesting permissions, users will be prompted to grant or deny access. If a permission has already been granted, the user will not be prompted again. This provides a seamless experience while maintaining user privacy and control.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="request-email"><span>Request Email</span></div>
    <div class="example-group" data-section="request-folder"><span>Request Folder Access</span></div>
    <div class="example-group" data-section="request-apps"><span>Request Apps Access</span></div>
    <div class="example-group" data-section="request-batch"><span>Request Several at Once</span></div>
    <div class="example-group" data-section="check"><span>Check Without Prompting</span></div>
    <div class="example-group" data-section="request-app-data"><span>Use Another App's Data</span></div>
</div>

<div class="example-content" data-section="request-email" style="display:block;">

#### Request access to the user's email address

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-email">Request Email Access</button>
    <script>
        document.getElementById('request-email').addEventListener('click', async () => {
            const email = await puter.perms.request('email');
            if (email) {
                puter.print(`Email: ${email}`);
            } else {
                puter.print('Email access denied or not available');
            }
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="request-folder">

#### Request write access to the user's Documents folder

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-documents">Request Documents Write Access</button>
    <script>
        document.getElementById('request-documents').addEventListener('click', async () => {
            const documentsPath = await puter.perms.request('folder', { name: 'Documents', access: 'write' });
            if (documentsPath) {
                puter.print(`Documents path: ${documentsPath}`);
                // Now you can write to the Documents folder
                await puter.fs.write(`${documentsPath}/my-file.txt`, 'Hello from Documents!');
                puter.print('File written to Documents folder');
            } else {
                puter.print('Documents write access denied');
            }
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="request-apps">

#### Request read access to the user's apps

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-apps">Request Apps Read Access</button>
    <script>
        document.getElementById('request-apps').addEventListener('click', async () => {
            const granted = await puter.perms.request('apps');
            if (granted) {
                puter.print('Apps read access granted');
                // Now you can list the user's apps
                const apps = await puter.apps.list();
                puter.print(`User has ${apps.length} apps`);
            } else {
                puter.print('Apps read access denied');
            }
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="request-batch">

#### Request several things under one prompt

Pass an array to ask for everything your app needs in one call. Anything already granted is left alone, so the prompt lists only what is missing — and doesn't appear at all when it's all in place.

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="setup">Set Up</button>
    <script>
        document.getElementById('setup').addEventListener('click', async () => {
            const [documents, apps, email] = await puter.perms.request([
                { resource: 'folder', name: 'Documents', access: 'write' },
                { resource: 'apps' },
                { resource: 'email' },
            ]);
            puter.print(`Documents: ${documents ?? 'denied'}`);
            puter.print(`Apps: ${apps ? 'granted' : 'denied'}`);
            puter.print(`Email: ${email ?? 'denied'}`);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="check">

#### Check access without prompting

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Never shows a dialog — it only reports what is already granted.
            const granted = await puter.perms.check('folder', { name: 'Documents', access: 'write' });
            puter.print(granted
                ? 'Documents write access is already granted'
                : 'Documents write access has not been granted yet');
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="request-app-data">

#### Use another app's saved data

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-app-data">Use another app's data</button>
    <script>
        document.getElementById('request-app-data').addEventListener('click', async () => {
            const other = await puter.apps.get('contacts');
            const granted = await puter.perms.request('appData', { app: other.uid, scopes: 'read' });
            if (granted) {
                const keys = await puter.kv.list({ appUuid: other.uid });
                puter.print(`${other.title} has ${keys.length} key(s)`);
            } else {
                puter.print('Permission denied');
            }
        });
    </script>
</body>
</html>
```

</div>

## Resources

The resource decides which details the call takes and what a request resolves to:

| Resource | Details | `request()` resolves to |
| -------- | ------- | ----------------------- |
| `'email'` | — | The user's email address |
| `'folder'` | `{ name, access }` | The folder's path |
| `'apps'` | `{ access }` | `true` if granted |
| `'subdomains'` | `{ access }` | `true` if granted |
| `'appData'` | `{ app, scopes }` | `true` if granted |
| `'appRootDir'` | `{ app, access }` | The app's root directory, or `undefined` if denied |
| `'permission'` | `{ permission }` or `{ permissions }` | `true` if granted |

Anything denied resolves to a falsy value, so one `if` covers both outcomes. `access` is `'read'` (the default) or `'write'`.

## Functions

- **[`puter.perms.request()`](/Perms/request/)** - Request access to a resource, or to several at once
- **[`puter.perms.check()`](/Perms/check/)** - Report whether access is already granted, without prompting

## Guides

- **[Using another app's data](/Perms/appData/)** - Reading and writing another app's key-value data and `AppData` files
