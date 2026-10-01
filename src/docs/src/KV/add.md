---
title: puter.kv.add()
description: Add values to an existing key or nested path in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Add values to an existing key. When you pass an array, its elements are appended to the array stored at the key. When you pass an object, each key is treated as a path and the value is added at that path. A missing or expired key starts from an empty array (or, for a path map, an object holding an empty array at each path).

## Syntax

```js
puter.kv.add(key, value)
puter.kv.add(key, pathAndValue)
```

## Parameters

#### `key` (String) (required)

The key to add values to.

#### `value` (String | Number | Boolean | Object (read as a path map) | Array) (optional)

The value to add to the key. Defaults to `1` when omitted.

An array is appended element by element, so wrap a single value in an array to append it as one element: `puter.kv.add('scores', [5])` appends `5`.

#### `pathAndValue` (Object) (optional)

An object where each key is a path (for example, `"profile.tags"`) and each value is the value (or values) to add at that path.

Appended values follow the same limits as [`puter.kv.set()`](/KV/set/): **400 KB**, and every number within **±9,007,199,254,740,991** — a larger one is stored clamped to that bound.

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically; sparse array elements are not created. A path may chain at most 31 levels; a deeper one rejects with `bad_request`. Quoted names can't be empty. All of a call's paths go into one write, so a call fits at most 1,500 path segments and, with short field names, about 140 paths; split larger changes across calls. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

A plain object is read as a path map, never appended as an element: to append an object, wrap it in an array, as in `puter.kv.add('log', [{ at, event }])`.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `key_undefined` | No key was given. |
| `key_too_large` | The key is over the 1 KB limit. |
| `arguments_required` | Called with no arguments at all. |
| `value_not_a_list` | The value, or with a path map the field at a path, holds something other than a list. |
| `invalid_path` | A path map addressed a field inside a stored number, boolean, null, string, or array, or went through a missing array element. A bare object is a path map, so adding one to a list lands here; wrap it in an array to append it as one element. |
| `value_too_large` | The append would take the stored value over 400 KB. |
| `bad_request` | A malformed path (including an empty quoted name such as `[""]`), a path nested over 31 levels, two paths that overlap or conflict (one treats a shared step as a list index, the other as a field name), more or longer paths than one write can apply (see [Rate Limits and Quotas](/rate-limits-and-quotas/)), a value nested more than 32 levels deep counting its path and the list, or a single added value over 400 KB. |
| `insufficient_funds` | No usage left on the account. |
| `forbidden` | Called with `optConfig.appUuid` for another app's data without permission, or the entry is private to that app. |
| `subject_does_not_exist` | `optConfig.appUuid` names an app that doesn't exist. |
| `response_timeout` | Too many writers on the key right now — retry. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits and Quotas](/rate-limits-and-quotas/). |

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
