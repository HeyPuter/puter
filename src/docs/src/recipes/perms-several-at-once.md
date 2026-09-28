---
title: Ask for Several Things at Once
description: "Put several permission asks behind a single prompt, request another app's data by scope, and understand what gets rejected before the user ever sees a dialog."
tags: [perms, auth]
order: 16
---

**Use this when** one prompt is better than four. Asking for
[a folder](/recipes/perms-ask-for-access/) at a time works, but an app that
needs three things at startup should not put up three dialogs.

This carries on from [asking for access](/recipes/perms-ask-for-access/), which
covers the single-resource form.

## One prompt for several asks

Pass an array. Each entry names its `resource` and carries that resource's own
fields in the same object:

```js
const [documents, email, canReadApps] = await puter.perms.request([
    { resource: 'folder', name: 'Documents', access: 'write' },
    { resource: 'email' },
    { resource: 'apps' },
]);
```

The results come back **in order**, one per entry, each the same value that
entry would have resolved to on its own — the folder's path, the email address,
a boolean. So destructuring by position is the intended way to read them.

Only what is missing is prompted for. If the user already granted Documents,
the dialog asks about the other two, and `documents` still comes back with the
path.

## Check a whole set at once

`check()` takes the same array and answers per entry:

```js
const [hasDocuments, hasEmail] = await puter.perms.check([
    { resource: 'folder', name: 'Documents', access: 'write' },
    { resource: 'email' },
]);
```

Every entry answers a boolean here, even the ones `request()` would resolve to a
path or an address. That is what makes it useful for deciding what your settings
screen should show.

## Use another app's data

`'appData'` asks for access to a different app's storage — its key-value entries
and its files under AppData. Name the app and the scopes:

```js
const granted = await puter.perms.request('appData', {
    app: { name: 'contacts' },
    scopes: { kv: ['get', 'list'], fs: 'read' },
});
```

Scopes take three equivalent forms, so pick whichever reads best:

```js
scopes: 'read'                        // the class, applied to both stores
scopes: ['kv:get', 'fs:read']         // store:name pairs
scopes: { kv: ['get', 'set'] }        // grouped by store
```

The classes are `read` (`get`, `list`), `write` (`set`, `add`, `incr`, `decr`,
`update`) and `delete` (`del`, `remove`, `expire`, `expireAt`).

**`delete` is not part of `write`.** An app granted `write` can add and change
entries but cannot remove any, so ask for `delete` explicitly when you need it.
Emptying another app's whole store is not available at any scope.

## Ask for a raw permission string

Anything the named resources do not cover can be asked for directly. A lone
string is read as a permission string, because no resource name contains a `:`
and every permission string does:

```js
await puter.perms.request('fs:/alice/Projects:read');
```

The long form takes several at once, and `create` decides what happens when an
`fs:` permission names a path that does not exist yet:

```js
await puter.perms.request('permission', {
    permissions: ['fs:/alice/Projects:read', 'fs:/alice/Archive:read'],
    create: 'dir',
});
```

`create` defaults to `true`, which picks a kind from the name — a dot beyond a
leading one means a file. `'dir'` and `'file'` force it, and `false` leaves a
missing path alone.

## What gets rejected before the prompt

Every entry is resolved and validated *before* anything is asked, so a
malformed entry cannot surface after a dialog has already gone up for the rest.
These all reject with `invalid_argument` and never prompt:

```js
// Both forms at once.
puter.perms.request('permission', { permission: 'a:b', permissions: ['c:d'] });

// A batch takes no second argument.
puter.perms.request([{ resource: 'email' }], { access: 'write' });

// One prompt is one decision, so one `create` has to cover it.
puter.perms.request([
    { resource: 'permission', permission: 'fs:/a/x:read', create: 'dir' },
    { resource: 'permission', permission: 'fs:/a/y:read', create: 'file' },
]);
```

A misspelled resource with details beside it is treated as a typo rather than a
permission string, and the error lists what was expected:

```js
try {
    await puter.perms.request('folders', { name: 'Documents' });
} catch (e) {
    e.code;      // 'invalid_argument'
    e.message;   // 'unknown resource: folders (expected one of: email, folder, …)'
}
```

## Notes

- A folder request only accepts `Desktop`, `Documents`, `Pictures` or `Videos`.
  Anything else is `invalid_argument`.
- `check()` answers `false` for a partly-granted set, because a prompt is still
  needed to finish it. It never answers "half".
- An entry that asks for nothing — `appData` with scopes the app already
  covers — is not turned truthy by a grant that covered the other entries. It
  asked nothing, so nothing is claimed for it.
- `'appRootDir'` resolves to the directory itself rather than a boolean, and
  requesting it claims the directory as a side effect. `check()` deliberately
  does not, so checking never provisions anything.
