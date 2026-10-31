---
title: puter.kv.add()
description: Add values to an existing key or nested path in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Adds values to the list stored at a key. When you pass an array, its elements are appended to that list. When you pass an object, each of its keys is a path, and its value is added to the list at that path. A missing or expired key starts from an empty list, or for a path map, an object holding an empty list at each path.

## Syntax

```js
puter.kv.add(key, value)
puter.kv.add(key, pathAndValue)
puter.kv.add(key, value, optConfig)
```

## Parameters

#### `key` (String) (required)

The key to add values to.

#### `value` (String | Number | Boolean | Object (read as a path map) | Array) (optional)

The value to add to the key. Defaults to `1` when omitted.

An array is appended element by element, so wrap a single value in an array to append it as one element. For example, `puter.kv.add('scores', [5])` appends `5`.

#### `pathAndValue` (Object) (optional)

An object where each key is a path (for example, `"profile.tags"`) and each value is the value (or values) to add at that path.

Appended values follow the same limits as in [`puter.kv.set()`](/KV/set/). The stored value can be at most **399 KB**, and every number must be within **±9,007,199,254,740,991**. A larger number is stored clamped to that bound.

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically, but sparse array elements aren't. A path may chain at most 31 levels, and a deeper one rejects with `bad_request`. Quoted names can't be empty. All of a call's paths go into one write, so a call fits at most 1,500 path segments and, with short field names, about 140 paths. Split larger changes across calls. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

A plain object is read as a path map, never appended as an element. To append an object, wrap it in an array, as in `puter.kv.add('log', [{ at, event }])`.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument. It takes these properties:

- `handle` (String): Works on data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix, and the share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Works on another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

Pass `optConfig` after `value`, as in `puter.kv.add('tags', ['new'], { handle })`. An object in the place of `value` is read as a path map.

## Return value

A `Promise` that resolves to the updated value stored at `key`.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `key_undefined` | No key was given. |
| `key_too_large` | The key is over the 1 KB limit. |
| `arguments_required` | Called with no arguments at all. |
| `value_not_a_list` | The value, or with a path map the field at a path, holds something other than a list. |
| `invalid_path` | A path map addressed a field inside a stored number, boolean, null, string, or array, or went through a missing array element. A bare object is a path map, so adding one to a list lands here. Wrap it in an array to append it as one element. |
| `value_too_large` | An added value is over 399 KB, or the append would take the stored value over 399 KB. |
| `bad_request` | A malformed path (including an empty quoted name such as `[""]`), a path nested over 31 levels, two paths that overlap or conflict (one treats a shared step as a list index, the other as a field name), more or longer paths than one write can apply (see [Rate Limits and Quotas](/rate-limits-and-quotas/)), or a value nested more than 32 levels deep counting its path and the list. |
| `insufficient_funds` | No usage left on the account. |
| `forbidden` | Called with `optConfig.appUuid` for another app's data without permission, or the entry is private to that app. |
| `subject_does_not_exist` | `optConfig.appUuid` names an app that doesn't exist. |
| `response_timeout` | Too many writers on the key at once. Try again. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits and Quotas](/rate-limits-and-quotas/). |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, it isn't shared with you, or the call comes from an app other than the one whose data it shares. |
| `kv_handle_access_denied` | The share's access doesn't allow this method, or the key is private to the owner's app. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid`. |
| `kv_handle_key_invalid` | With `handle`, the key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Calls through a share are turned off on this deployment. |

## Examples

<strong class="example-title">Append to an array stored at a key</strong>

```html;kv-add-array
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('scores', [1, 2, 3, 4]);

            // Each element of the array you pass is appended
            const updated = await puter.kv.add('scores', [5]);
            puter.print(`Updated scores: ${JSON.stringify(updated)}<br>`);

            // Passing several values appends all of them
            const extended = await puter.kv.add('scores', [6, 7]);
            puter.print(`Extended scores: ${JSON.stringify(extended)}`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Add values to an array inside an object</strong>

```html;kv-add
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('profile', { tags: ['alpha'] });

            const updated = await puter.kv.add('profile', { 'tags': ['beta', 'gamma'] });
            puter.print(`Updated profile: ${JSON.stringify(updated)}`);
        })();
    </script>
</body>
</html>
```
