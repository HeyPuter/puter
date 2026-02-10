---
title: Perms
description: Request permissions to access user data and resources with Puter.js Permissions API
platforms: [apps]
---

The Permissions API enables your application to request access to user data and resources such as email addresses, special folders (Desktop, Documents, Pictures, Videos), apps, and subdomains.

When requesting permissions, users will be prompted to grant or deny access. If a permission has already been granted, the user will not be prompted again. This provides a seamless experience while maintaining user privacy and control.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="request-email"><span>Request Email</span></div>
    <div class="example-group" data-section="request-desktop"><span>Request Desktop Access</span></div>
    <div class="example-group" data-section="request-documents"><span>Request Documents Access</span></div>
    <div class="example-group" data-section="request-apps"><span>Request Apps Access</span></div>
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
            const desktopPath = await puter.perms.requestReadDesktop();
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
            const documentsPath = await puter.perms.requestWriteDocuments();
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
            const granted = await puter.perms.requestReadApps();
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

## Functions

These permission features are supported out of the box when using Puter.js:

### General Permissions

- **[`puter.perms.request()`](/Perms/request/)** - Request a specific permission string

### User Data

- **[`puter.perms.requestEmail()`](/Perms/requestEmail/)** - Request access to the user's email address

### Special Folders - Desktop

- **[`puter.perms.requestReadDesktop()`](/Perms/requestReadDesktop/)** - Request read access to the Desktop folder
- **[`puter.perms.requestWriteDesktop()`](/Perms/requestWriteDesktop/)** - Request write access to the Desktop folder

### Special Folders - Documents

- **[`puter.perms.requestReadDocuments()`](/Perms/requestReadDocuments/)** - Request read access to the Documents folder
- **[`puter.perms.requestWriteDocuments()`](/Perms/requestWriteDocuments/)** - Request write access to the Documents folder

### Special Folders - Pictures

- **[`puter.perms.requestReadPictures()`](/Perms/requestReadPictures/)** - Request read access to the Pictures folder
- **[`puter.perms.requestWritePictures()`](/Perms/requestWritePictures/)** - Request write access to the Pictures folder

### Special Folders - Videos

- **[`puter.perms.requestReadVideos()`](/Perms/requestReadVideos/)** - Request read access to the Videos folder
- **[`puter.perms.requestWriteVideos()`](/Perms/requestWriteVideos/)** - Request write access to the Videos folder

### Apps Management

- **[`puter.perms.requestReadApps()`](/Perms/requestReadApps/)** - Request read access to the user's apps
- **[`puter.perms.requestManageApps()`](/Perms/requestManageApps/)** - Request write (manage) access to the user's apps

### Subdomains Management

- **[`puter.perms.requestReadSubdomains()`](/Perms/requestReadSubdomains/)** - Request read access to the user's subdomains
- **[`puter.perms.requestManageSubdomains()`](/Perms/requestManageSubdomains/)** - Request write (manage) access to the user's subdomains
