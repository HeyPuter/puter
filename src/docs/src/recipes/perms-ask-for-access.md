---
title: Ask for Access
description: "Learn how to request permissions with Puter.js to let your app use the user's folders, apps, subdomains and email address."
tags: [perms, auth]
order: 15
---

A Puter app runs in a sandbox. By default it can only use the files and
resources it created itself. When your app needs something outside that sandbox,
such as the user's Documents folder or their email address, it asks the user
with the [permissions API](/Perms/). The user sees a prompt and approves or
declines it. Puter remembers the answer, so the user is asked only once.

## Ask for a Folder

To use one of the user's folders, call
[`puter.perms.request()`](/Perms/request/) with `'folder'`, the folder name and
the access you need. It resolves to the folder's path, which you then use with
the [filesystem API](/FS/):

```js
const path = await puter.perms.request('folder', {
    name: 'Documents',
    access: 'write',
});

if (path) {
    await puter.fs.write(`${path}/notes.txt`, 'Saved!');
}
```

The folder can be `Desktop`, `Documents`, `Pictures` or `Videos`. Access is
`'read'` by default. Write access includes read access, so one `'write'` request
covers both.

## Ask for Apps or Subdomains

To read the list of the user's apps, call
[`puter.perms.request()`](/Perms/request/) with `'apps'`. It resolves to `true`
when granted, and then [`puter.apps.list()`](/Apps/list/) returns the user's
apps:

```js
if (await puter.perms.request('apps')) {
    const apps = await puter.apps.list();
    console.log(apps.length);
}
```

To publish to the user's subdomains, ask for `'subdomains'` with write access:

```js
const canPublish = await puter.perms.request('subdomains', { access: 'write' });
```

## Ask for the Email Address

To get the user's email address, call [`puter.perms.request()`](/Perms/request/)
with `'email'`. It resolves to the address itself:

```js
const email = await puter.perms.request('email');

if (email) {
    console.log(email);
}
```

When the user declines, [`puter.perms.request()`](/Perms/request/) resolves to a
falsy value for every resource. That is why a single `if` handles both outcomes
in each example on this page.

## Check Before You Ask

To find out whether access is already granted, call
[`puter.perms.check()`](/Perms/check/). It takes the same arguments as
[`puter.perms.request()`](/Perms/request/), resolves to `true` or `false`, and
never shows a prompt. Use it when your own UI needs to show the current state,
such as a settings toggle for saving to Documents:

```js
const details = { name: 'Documents', access: 'write' };

toggle.checked = await puter.perms.check('folder', details);

toggle.addEventListener('change', async () => {
    if (toggle.checked) {
        toggle.checked = Boolean(await puter.perms.request('folder', details));
    }
});
```

When you only need the access itself, call
[`puter.perms.request()`](/Perms/request/) directly. It skips the prompt for
anything the user has already granted.
