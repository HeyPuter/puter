---
title: puter.perms.check()
description: Check whether access has already been granted, without prompting the user.
platforms: [websites, apps]
---

Ask whether access is already granted. Nothing is prompted and nothing is changed; this only reports what the user has already allowed.

Use it to keep prompts out of the way until they are needed: show a feature as available when the access is in place, and offer an opt-in only where it is not.

It takes the same resources and details as [`puter.perms.request()`](/Perms/request/). Both read the same state, so a `true` here means the matching `request()` won't prompt for that access. In the array form that is per entry: a batch still prompts if any one entry is missing.

## Syntax

```js
puter.perms.check(resource)
puter.perms.check(resource, details)
puter.perms.check(requests)
```

## Parameters

The same as [`puter.perms.request()`](/Perms/request/). The resource table there lists what each one accepts, and the same `puter.perms.Resource` and `puter.perms.Access` constants work here. The `create` field is validated the same way, but `check()` never creates anything. It only reports whether access is already held. Invalid details reject with `{ message, code: 'invalid_argument' }`, the same as `request()`.

For `'fs'`, access to a folder counts for everything inside it, so a check for a file inside a folder the app can already read answers `true`.

## Return value

A `Promise` that resolves to `true` if the access is already granted, or `false` otherwise. The array form resolves to an array of booleans, in the order asked.

Where a resource needs more than one permission, such as `'appData'` with several scopes, the answer is `true` only when the whole set is granted. A partly-granted set answers `false`, since a prompt is still needed.

The promise rejects if the check itself cannot be made (for example when the caller isn't signed in). A failure is not reported as `false`: an app that couldn't tell the two apart would prompt someone who had already granted it.

## Examples

<strong class="example-title">Only ask when the access is missing</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="save">Save to Documents</button>
    <script>
        document.getElementById('save').addEventListener('click', async () => {
            const details = { name: 'Documents', access: 'write' };
            if (!await puter.perms.check('folder', details)) {
                if (!await puter.perms.request('folder', details)) {
                    puter.print('Documents write access denied');
                    return;
                }
            }
            const user = await puter.auth.getUser();
            await puter.fs.write(`/${user.username}/Documents/notes.txt`, 'Saved!');
            puter.print('Saved');
        });
    </script>
</body>
</html>
```

<strong class="example-title">Report what is still missing</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="status">Check Setup</button>
    <script>
        document.getElementById('status').addEventListener('click', async () => {
            const wanted = [
                { resource: 'folder', name: 'Documents', access: 'write' },
                { resource: 'apps' },
                { resource: 'email' },
            ];
            const granted = await puter.perms.check(wanted);
            wanted.forEach((entry, i) => {
                puter.print(`${entry.resource}: ${granted[i] ? 'granted' : 'not granted'}`);
            });
        });
    </script>
</body>
</html>
```
