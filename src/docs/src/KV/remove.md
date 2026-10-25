---
title: puter.kv.remove()
description: Remove values at one or more paths from a key in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Remove values from an existing key by path. Paths can target nested fields and array elements.

## Syntax

```js
puter.kv.remove(key, ...paths)
puter.kv.remove(key, ...paths, optConfig)
```

## Parameters

#### `key` (String) (required)

The key to remove values from.

#### `paths` (String[]) (required)

One or more paths to remove (for example, `"profile.bio"`).

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) deletes the whole entry, as [`puter.kv.del()`](/KV/del/) does, and resolves to `null`. Use non-negative integer indexes in brackets to address arrays. Removing an array element shifts later elements down by one index. A path may chain at most 31 levels; a deeper one rejects with `bad_request`. Quoted names can't be empty. All of a call's paths go into one write, so a call fits at most 1,500 path segments, and fewer when it has many paths or long ones; split larger changes across calls. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

#### `optConfig` (Object) (optional)

The last argument. It takes these properties:

- `handle` (String): Work on data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix. The share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Work on another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`. An expired key resolves to `null`. A call on another app's data with `optConfig.appUuid` also resolves to `null` when your app may delete that app's entries but not read them.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `arguments_required` | Called with no paths at all. |
| `paths_invalid` | Paths were not provided as separate string arguments. |
| `key_undefined` | No key was given. |
| `key_too_large` | The key is over the 1 KB limit. |
| `bad_request` | A malformed path (including an empty quoted name such as `[""]`), a path nested over 31 levels, two paths that overlap (including the same path twice) or conflict (one treats a shared step as a list index, the other as a field name), or more or longer paths than one write can apply (see [Rate Limits and Quotas](/rate-limits-and-quotas/)). |
| `forbidden` | Called with `optConfig.appUuid` for another app's data without permission, or the entry is private to that app. |
| `subject_does_not_exist` | `optConfig.appUuid` names an app that doesn't exist. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits and Quotas](/rate-limits-and-quotas/). |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, or it isn't shared with you. |
| `kv_handle_access_denied` | The share's access doesn't allow this method. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid` or `disableSharing`. |
| `kv_handle_key_invalid` | With `handle`, the key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Shares can't be used this way on this deployment. |

## Examples

<strong class="example-title">Remove nested fields from an object</strong>

```html;kv-remove
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('profile', { name: 'Puter', stats: { score: 10, level: 2 } });

            const updated = await puter.kv.remove('profile', 'stats.score');
            puter.print(`Updated profile: ${JSON.stringify(updated)}`);
        })();
    </script>
</body>
</html>
```
