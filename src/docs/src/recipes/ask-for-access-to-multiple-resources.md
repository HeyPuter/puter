---
title: Ask for Access to Multiple Resources
description: "Learn how to request permission for multiple Puter resources at once, so users approve everything your app needs in a single prompt."
tags: [perms, auth]
order: 16
---

In [Ask for Access](/recipes/ask-for-access/), your app asks for one
resource per call, and each call can show its own prompt. When your app needs
multiple resources to start, such as the Documents folder, the email address and the
list of apps, that is three prompts in a row. You can ask for all of them in one
call instead. The user sees a single prompt and answers once.

## Ask in One Prompt

To ask for multiple resources, pass an array to
[`puter.perms.request()`](/Perms/request/). Each entry is an object with a
`resource` and the same details you would pass for that resource on its own:

```js
const [documents, email, canReadApps] = await puter.perms.request([
    { resource: 'folder', name: 'Documents', access: 'write' },
    { resource: 'email' },
    { resource: 'apps' },
]);

if (documents) {
    await puter.fs.write(`${documents}/notes.txt`, 'Saved!');
}
```

It resolves to an array in the same order as your entries. Each value is what
that entry resolves to on its own, so `documents` is the folder's path, `email`
is the address and `canReadApps` is `true` or `false`.

The prompt lists only what the user has not granted yet. If Documents was
granted earlier, the prompt asks about the email address and the apps, and
`documents` still resolves to the path. When everything is already granted, no
prompt appears.

When the user declines, every entry that was in the prompt resolves to a falsy
value. Entries that were already granted keep their value, so check each one
before you use it.

## Check Multiple Resources at Once

To read the current state of multiple resources without a prompt, pass the same
array to [`puter.perms.check()`](/Perms/check/). It resolves to an array of
`true` or `false`, in the same order:

```js
const access = [
    { resource: 'folder', name: 'Documents', access: 'write' },
    { resource: 'email' },
];

const [hasDocuments, hasEmail] = await puter.perms.check(access);

documentsToggle.checked = hasDocuments;
emailToggle.checked = hasEmail;
```

[`puter.perms.check()`](/Perms/check/) answers with a boolean for every entry,
including the folder and the email address. Use it to render a settings screen
with every toggle in its current state, then call
[`puter.perms.request()`](/Perms/request/) with the entries the user turns on.
