---
title: puter.kv.update()
description: Update one or more paths within a stored value in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Update one or more paths within the value stored at a key. You can update nested fields without overwriting the entire value. A missing or expired key is built from the paths you give, with no TTL unless you pass one.

## Syntax

```js
puter.kv.update(key, pathAndValueMap)
puter.kv.update(key, pathAndValueMap, ttl)
puter.kv.update({ key, pathAndValueMap, ttl })
```

## Parameters

#### `key` (String) (required)

The key to update.

#### `pathAndValueMap` (Object) (required)

An object where each key is a path (for example, `"profile.name"`) and each value is the new value for that path.

Each value follows the same limits as [`puter.kv.set()`](/KV/set/): **400 KB**, and every number within **±9,007,199,254,740,991** — a larger one is stored clamped to that bound.

#### `ttl` (Number | null) (optional)

Time-to-live in seconds. Omit it, or pass an empty string or `false`, to keep the key's current TTL; pass `null` to remove it. A numeric string such as `'60'` is read as that number. A positive number sets the TTL; `0` or a negative number expires the key right away. Any other value, such as `true`, an array, or `Infinity`, rejects with `ttl_invalid`.

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically; sparse array elements are not created. A path may chain at most 31 levels; a deeper one rejects with `bad_request`. Quoted names can't be empty. All of a call's paths go into one write, so a call fits at most 1,500 path segments and, with short field names, about 140 paths; split larger changes across calls. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `key_undefined` | No key was given. |
| `key_too_large` | The key is over the 1 KB limit. |
| `path_map_invalid` | `pathAndValueMap` is missing, empty, or not an object. |
| `ttl_invalid` | `ttl` isn't a finite number of seconds, a numeric string, `null`, an empty string, or `false`. |
| `invalid_path` | A path map addressed a field inside a stored number, boolean, null, string, or array, or went through a missing array element. |
| `value_too_large` | The write would take the stored value over 400 KB. |
| `bad_request` | A malformed path (including an empty quoted name such as `[""]`), a path nested over 31 levels, two paths that overlap or conflict (one treats a shared step as a list index, the other as a field name), more or longer paths than one write can apply (see [Rate Limits and Quotas](/rate-limits-and-quotas/)), a value nested more than 32 levels deep counting its path, or a single value over 400 KB. |
| `insufficient_funds` | No usage left on the account. |
| `forbidden` | Called with `optConfig.appUuid` for another app's data without permission, or the entry is private to that app. |
| `subject_does_not_exist` | `optConfig.appUuid` names an app that doesn't exist. |
| `response_timeout` | Too many writers on the key right now — retry. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits and Quotas](/rate-limits-and-quotas/). |

## Examples

<strong class="example-title">Update an element of a root array</strong>

```html;kv-update-root-array
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('players', [{ score: 1 }, { score: 2 }]);
            const updated = await puter.kv.update('players', { '[0].score': 10 });
            puter.print(JSON.stringify(updated));
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Update nested fields and refresh the TTL</strong>

```html;kv-update
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('profile', { name: 'Puter', stats: { score: 10 } });

            const updated = await puter.kv.update(
                'profile',
                { 'stats.score': 11, 'name': 'Puter Smith' },
                3600
            );

            puter.print(`Updated profile: ${JSON.stringify(updated)}`);
        })();
    </script>
</body>
</html>
```
