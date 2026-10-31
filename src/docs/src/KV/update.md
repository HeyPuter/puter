---
title: puter.kv.update()
description: Update one or more paths within a stored value in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Updates one or more paths inside the value stored at a key, without replacing the whole value. A missing or expired key is built from the paths you give, with no TTL unless you pass one.

## Syntax

```js
puter.kv.update(key, pathAndValueMap)
puter.kv.update(key, pathAndValueMap, ttl)
puter.kv.update(key, pathAndValueMap, ttl, optConfig)
puter.kv.update({ key, pathAndValueMap, ttl })
```

## Parameters

#### `key` (String) (required)

The key to update.

#### `pathAndValueMap` (Object) (required)

An object where each key is a path (for example, `"profile.name"`) and each value is the new value for that path.

Each value follows the same limits as in [`puter.kv.set()`](/KV/set/). The stored value can be at most **399 KB**, and every number must be within **±9,007,199,254,740,991**. A larger number is stored clamped to that bound.

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically, but sparse array elements aren't. A path may chain at most 31 levels, and a deeper one rejects with `bad_request`. Quoted names can't be empty. All of a call's paths go into one write, so a call fits at most 1,500 path segments and, with short field names, about 140 paths. Split larger changes across calls. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

#### `ttl` (Number | null) (optional)

Time-to-live in seconds. Omit it, or pass an empty string or `false`, to keep the key's current TTL. Pass `null` to remove it. A positive number sets the TTL, and `0` or a negative number expires the key right away. A numeric string such as `'60'` is read as that number. Any other value, such as `true`, an array, or `Infinity`, rejects with `ttl_invalid`.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument. It takes these properties:

- `handle` (String): Works on data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix, and the share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Works on another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value

A `Promise` that resolves to the updated value stored at `key`.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `key_undefined` | No key was given. |
| `key_too_large` | The key is over the 1 KB limit. |
| `path_map_invalid` | `pathAndValueMap` is missing, empty, or not an object. |
| `ttl_invalid` | `ttl` isn't a finite number of seconds, a numeric string, `null`, an empty string, or `false`. |
| `invalid_path` | A path map addressed a field inside a stored number, boolean, null, string, or array, or went through a missing array element. |
| `value_too_large` | The write would take the stored value over 399 KB. |
| `bad_request` | A malformed path (including an empty quoted name such as `[""]`), a path nested over 31 levels, two paths that overlap or conflict (one treats a shared step as a list index, the other as a field name), more or longer paths than one write can apply (see [Rate Limits and Quotas](/rate-limits-and-quotas/)), a value nested more than 32 levels deep counting its path, or a single value over 399 KB. |
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

<strong class="example-title">Update an element of a root array</strong>

```html
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
