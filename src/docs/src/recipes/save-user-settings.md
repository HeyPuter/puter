---
title: Save User Settings
description: "Learn how to save user settings with Puter.js so they follow the user to every device, with defaults and per-setting resets."
tags: [kv, data-modeling]
order: 11
---

Most apps have settings, like a theme, a font size, or which notifications to
send. Saved in `localStorage`, they only exist in that one browser. Saved with
[`puter.kv`](/KV/), they're stored in the user's Puter account and follow them
to every device.

This recipe keeps all settings in a single `settings` key and only saves what
the user changed. Everything else comes from defaults in your code. Secrets such
as API tokens go in their own [private
key](/recipes/share-data-between-apps/#keep-an-entry-private) instead.

## Load Settings with Defaults

Define your defaults once, grouped the same way as your settings screen:

```js
const DEFAULTS = {
    theme: 'light',
    editor: { fontSize: 14, wordWrap: true, tabSize: 4 },
    notifications: { email: true, push: false },
};
```

When the app starts, read the saved settings with
[`puter.kv.get()`](/KV/get/) and merge them over the defaults. A plain
`{ ...DEFAULTS, ...saved }` only merges the top level, so a saved
`editor.fontSize` would wipe out the default `wordWrap` and `tabSize`. This
function merges nested groups too:

```js
function withDefaults (defaults, saved) {
    const result = structuredClone(defaults);
    for ( const [ name, value ] of Object.entries(saved ?? {}) ) {
        const isGroup = typeof value === 'object' && value !== null && ! Array.isArray(value);
        result[name] = isGroup ? withDefaults(result[name] ?? {}, value) : value;
    }
    return result;
}

const settings = withDefaults(DEFAULTS, await puter.kv.get('settings'));
```

A user who never changed anything has no `settings` key, so
[`puter.kv.get()`](/KV/get/) returns `null` and they get the defaults. Since
only changes are saved, you can change a default later. Users who never touched
that setting get the new default, and users who picked their own value keep it.

## Change a Setting

To change one setting, use the [`puter.kv.update()`](/KV/update/) method with a
path to it. A dot means "inside this group":

```js
await puter.kv.update('settings', { 'editor.fontSize': 16 });
```

Only that setting changes. If there's no `settings` key or `editor` group yet,
they're created. A path that ends at a group, such as `editor`, replaces the
whole group, so name each setting by its full path.

To change several settings at once, put them in the same object. They're saved
in one write:

```js
await puter.kv.update('settings', {
    theme: 'dark',
    'notifications.push': true,
});
```

[`puter.kv.update()`](/KV/update/) returns the saved settings, so you can
re-render right away:

```js
const saved = await puter.kv.update('settings', { theme: 'dark' });
render(withDefaults(DEFAULTS, saved));
```

To update other open tabs when settings change, [watch the
key](/recipes/watch-for-changes/).

## Save from a Settings Form

Paths are strings, so you can put each setting's path in your HTML and use one
handler for the whole form:

```html
<input type="number" data-setting="editor.fontSize">
<input type="checkbox" data-setting="editor.wordWrap">
<input type="checkbox" data-setting="notifications.push">
```

```js
form.addEventListener('change', async (event) => {
    const input = event.target;
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);

    await puter.kv.update('settings', { [input.dataset.setting]: value });
});
```

## Reset to the Default

To reset a setting, remove it with the [`puter.kv.remove()`](/KV/remove/)
method. Once it's gone, the default from your code applies again:

```js
await puter.kv.remove('settings', 'editor.fontSize');
```

Removing a group resets everything in it, and you can pass several paths in one
call. Removing something that was never saved does nothing:

```js
await puter.kv.remove('settings', 'editor', 'notifications');
```

To reset everything, delete the key with [`puter.kv.del()`](/KV/del/):

```js
await puter.kv.del('settings');
```

## Lists Inside Settings

Some settings are lists, like muted channels. Store them as a set inside a group
(see [Store a Set of Unique Values](/recipes/store-unique-values/)), so each
item can be added or removed on its own:

```js
const member = (value) => `["${ value.replace(/["\\]/g, '\\$&') }"]`;

await puter.kv.update('settings', { [`mutedChannels.${ member(channel) }`]: true });   // mute
await puter.kv.remove('settings', `mutedChannels.${ member(channel) }`);              // unmute
```

The `member()` helper wraps the name in brackets and quotes, so a channel name
with a dot in it isn't split into a path.

## Rename a Setting

If a new version of your app moves or renames a setting, move the saved value
when the app loads. This moves an old top-level `fontSize` into `editor`:

```js
const saved = await puter.kv.get('settings') ?? {};

if ( saved.fontSize !== undefined ) {
    await puter.kv.update('settings', { 'editor.fontSize': saved.fontSize });
    await puter.kv.remove('settings', 'fontSize');
}
```

The new path is written before the old one is removed, so if the app closes in
between, the next load finishes the move.

Turning a plain setting into a group needs the same move. A path can't go inside
a plain value, so while `theme` holds the string `'dark'`, writing `theme.mode`
rejects with `invalid_path`.
