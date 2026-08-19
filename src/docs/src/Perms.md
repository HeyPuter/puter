---
title: Perms
description: Request permissions to access user data and resources with Puter.js Permissions API
platforms: [websites, apps]
---

The Permissions API enables your application to request access to user data and resources such as email addresses, special folders (Desktop, Documents, Pictures, Videos), apps, subdomains, and other apps' saved data.

When requesting permissions, users will be prompted to grant or deny access. If a permission has already been granted, the user will not be prompted again. This provides a seamless experience while maintaining user privacy and control.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="request-email"><span>Request Email</span></div>
    <div class="example-group" data-section="request-desktop"><span>Request Desktop Access</span></div>
    <div class="example-group" data-section="request-documents"><span>Request Documents Access</span></div>
    <div class="example-group" data-section="request-apps"><span>Request Apps Access</span></div>
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
            const email = await puter.perms.requestEmail();
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

<div class="example-content" data-section="request-desktop">

#### Request read access to the user's Desktop folder

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-desktop">Request Desktop Access</button>
    <script>
        document.getElementById('request-desktop').addEventListener('click', async () => {
            const desktopPath = await puter.perms.requestFolder('Desktop');
            if (desktopPath) {
                puter.print(`Desktop path: ${desktopPath}`);
            } else {
                puter.print('Desktop access denied');
            }
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="request-documents">

#### Request write access to the user's Documents folder

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-documents">Request Documents Write Access</button>
    <script>
        document.getElementById('request-documents').addEventListener('click', async () => {
            const documentsPath = await puter.perms.requestFolder('Documents', 'write');
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
            const granted = await puter.perms.requestApps();
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
            const granted = await puter.perms.requestAppData(other.uid, 'read');
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

## Functions

These permission features are supported out of the box when using Puter.js:

Each method takes the resource it is about, and an optional access level — `'read'` (the default) or `'write'`.

### General Permissions

- **[`puter.perms.request()`](/Perms/request/)** - Request a specific permission string

### User Data

- **[`puter.perms.requestEmail()`](/Perms/requestEmail/)** - Request access to the user's email address

### Special Folders

- **[`puter.perms.requestFolder()`](/Perms/requestFolder/)** - Request access to the Desktop, Documents, Pictures, or Videos folder

### Apps Management

- **[`puter.perms.requestApps()`](/Perms/requestApps/)** - Request access to the user's apps

### Subdomains Management

- **[`puter.perms.requestSubdomains()`](/Perms/requestSubdomains/)** - Request access to the user's subdomains

### Other Apps' Data

- **[`puter.perms.requestAppData()`](/Perms/requestAppData/)** - Request permission to use another app's key-value data and `AppData` files
