---
title: Save User Settings
description: "Learn how to save user settings with Puter.js so they follow the user to every device, with defaults, nested groups, and resetting a setting back to its default."
tags: [kv, data-modeling]
order: 11
---

Most apps have settings: a theme, a font size, which notifications to send.
Saving them in `localStorage` keeps them in one browser, so they are gone on the
user's phone or after they clear their browser data. Saving them with
[`puter.kv`](/KV/) keeps them in the user's Puter account, so they follow the
user to every device and browser they sign in from.

This recipe keeps all settings in one key called `settings`, and saves only the
ones the user changed. Everything else comes from defaults in your code.

## Load Settings with Defaults

Write your defaults once, grouped the way your settings screen is:

```js
const DEFAULTS = {
    theme: 'light',
    editor: { fontSize: 14, wordWrap: true, tabSize: 4 },
    notifications: { email: true, push: false },
};
```

When the app starts, read the saved settings and lay them over the defaults. A
plain `{ ...DEFAULTS, ...saved }` only merges the top level, so a saved
`editor.fontSize` would wipe out the default `wordWrap` and `tabSize`. This small
function merges groups too:

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

A user who never changed anything has no `settings` key, which reads as `null`,
so they get the defaults.

Saving only the changes means you can improve a default later. Users who never
touched that setting get the new default, and users who chose their own value
keep it.

## Change a Setting

To change one setting, use the [`puter.kv.update()`](/KV/update/) method with a
path to it. A dot moves into a group:

```js
await puter.kv.update('settings', { 'editor.fontSize': 16 });
```

Only that one setting changes. The other settings in `editor` stay as they are.
If the user hasn't saved any settings yet, the key and the `editor` group are
created for you.

To change several settings at once, put them all in the object. They are saved
in one write:

```js
await puter.kv.update('settings', {
    theme: 'dark',
    'notifications.push': true,
});
```

Write the full path to each setting rather than the group object. Passing a
group replaces the whole group, and the settings you left out of it are
dropped:

```js
await puter.kv.update('settings', { editor: { tabSize: 2 } });
// editor is now { tabSize: 2 }. The saved fontSize is gone.
```

[`puter.kv.update()`](/KV/update/) returns the saved settings after the change,
so you can redraw without another read:

```js
const saved = await puter.kv.update('settings', { theme: 'dark' });
render(withDefaults(DEFAULTS, saved));
```

## Save from a Settings Form

Paths are plain strings, so a form can name each setting's path in its HTML and
one handler can save all of them:

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
method. With nothing saved for it, the default from your code applies again:

```js
await puter.kv.remove('settings', 'editor.fontSize');
```

Removing a whole group resets every setting in it, and you can name several
paths in one call:

```js
await puter.kv.remove('settings', 'editor', 'notifications');
```

Removing a setting that was never saved does nothing and doesn't throw. To reset
everything, delete the key with the [`puter.kv.del()`](/KV/del/) method:

```js
await puter.kv.del('settings');
```

## Lists Inside Settings

Some settings are lists, such as muted channels or blocked words. Store them as
a set inside a group, with each item as a field name and `true` as its value, as
in [Store a Set of Unique Values](/recipes/store-unique-values/). Each item can
then be added or removed on its own:

```js
const member = (value) => `["${ value.replace(/["\\]/g, '\\$&') }"]`;

await puter.kv.update('settings', { [`mutedChannels.${ member(channel) }`]: true });   // mute
await puter.kv.remove('settings', `mutedChannels.${ member(channel) }`);              // unmute
```

The `member()` helper wraps the name in brackets and quotes, so a channel name
with a dot in it is saved as one name instead of being split into a path.

## Rename a Setting

When a new version of your app moves or renames a setting, move the user's saved
value when the app loads. This moves an old top-level `fontSize` into `editor`:

```js
const saved = await puter.kv.get('settings') ?? {};

if ( saved.fontSize !== undefined ) {
    await puter.kv.update('settings', { 'editor.fontSize': saved.fontSize });
    await puter.kv.remove('settings', 'fontSize');
}
```

The new path is written before the old one is removed. If the app closes in
between, the next start sees `fontSize` still there and finishes the move.

## Notes

- A path can't go inside a setting that holds a plain value. If `theme` is the
  string `'dark'`, writing `theme.mode` is rejected with `invalid_path`. Rename
  the setting first, as above.
- Keep secrets such as API keys or tokens in their own keys, marked private, as
  shown in [Share Data Between Apps](/recipes/share-data-between-apps/#keep-an-entry-private).
- Settings are saved per app, so another app that uses the same key name has its
  own separate `settings`.
- To update other open tabs when the settings change, watch the key with
  [Events](/Events/).
