---
title: Ask for Access
description: "Ask the user for access to a folder, their email address or their apps, and check what you already hold before prompting."
tags: [perms, auth]
order: 15
---

**Use this when** your app needs something outside its own storage — a file in
the user's Documents, their email address, the list of apps they have — and you
want the user to approve it first.

Two calls cover all of it:
[`puter.perms.request()`](/Perms/request/) asks, and
[`puter.perms.check()`](/Perms/check/) reports what is already held without
asking. They take the same arguments, so you can offer an opt-in only where one
is actually needed.

## Ask for a folder

Name the folder and the access you want. What comes back is the path:

```js
const path = await puter.perms.request('folder', {
    name: 'Documents',
    access: 'write',
});

if (path) {
    await puter.fs.write(`${path}/notes.txt`, 'Saved!');
}
```

`access` defaults to `'read'`, and `'write'` covers reading too, so ask for
`'write'` once rather than for both.

The folder must be one of `Desktop`, `Documents`, `Pictures` or `Videos`. Trash
and AppData are deliberately not askable.

## Ask for the email address

```js
const email = await puter.perms.request('email');

if (email) console.log(email);
```

This resolves to the address itself, not a boolean. A denied request gives
nothing back — everything `request()` returns is falsy when the user says no,
whatever the resource would otherwise resolve to.

## Ask about their apps or subdomains

These two resolve to a plain boolean:

```js
const canRead = await puter.perms.request('apps');
const canPublish = await puter.perms.request('subdomains', { access: 'write' });
```

## Check before you prompt

`check()` never prompts and never changes anything. Use it to decide whether an
opt-in is worth showing at all:

```js
if (await puter.perms.check('folder', { name: 'Documents', access: 'write' })) {
    // Already granted — go straight to the work.
} else if (!await puter.perms.request('folder', { name: 'Documents', access: 'write' })) {
    console.log('Access declined');
    return;
}
```

You do not have to guard every `request()` this way. `request()` already skips
the prompt for anything the user has granted before, so calling it on its own is
fine — `check()` is for when *your own UI* needs to know, such as hiding a
button or labelling a setting.

## Notes

- Everything `request()` returns is falsy when denied: `undefined` for a folder,
  email or app directory, `false` for the boolean resources. `if (!result)` is
  the one test that works for all of them.
- `check()` always answers a boolean, whatever the resource. It answers `false`
  for a partly-granted set, because a prompt is still needed to complete it.
- There are older per-resource helpers such as `requestReadDocuments()` and
  `requestEmail()`. They still work, but they are deprecated aliases for
  `request()` — prefer `request()` in new code.
- `request()` and `check()` also take an array, to put several asks behind a
  single prompt.
