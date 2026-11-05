---
title: puter.kv.expire()
description: Set the time-to-live (TTL) in seconds for a key in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Sets a key's time-to-live (TTL) in seconds.

## Syntax

```js
puter.kv.expire(key, ttlSeconds)
puter.kv.expire(key, ttlSeconds, optConfig)
```

## Parameters

#### `key` (String) (required)

The key to expire.

#### `ttlSeconds` (Number) (required)

The number of seconds until the key is removed. A value of `0` or less expires the key right away.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument. It takes these properties:

- `handle` (String): Works on data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix, and the share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Works on another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value

A `Promise` that resolves to `true` once the TTL is set.

## Errors

With `handle`, the promise can reject with these codes:

| Code | Meaning |
| -- | -- |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, it isn't shared with you, or the call comes from an app other than the one whose data it shares. |
| `kv_handle_access_denied` | The share's access doesn't allow this method, or the key is private to the owner's app. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid`. |
| `kv_handle_key_invalid` | With `handle`, the key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Calls through a share are turned off on this deployment. |

## Keys that don't exist

A missing or already-expired key becomes an empty entry with the TTL you gave it, rather than staying absent. [`puter.kv.list()`](/KV/list/) shows it and [`puter.kv.get()`](/KV/get/) reads it as `null`, the same as a missing key. The old value, if there was one, doesn't come back. [`puter.kv.incr()`](/KV/incr/) rejects such an entry, the same as any non-number value.

To remove a key's TTL instead of setting one, use [`puter.kv.set()`](/KV/set/) or [`puter.kv.update()`](/KV/update/) with a `null` TTL.

## Examples

<strong class="example-title">Retrieve the value of a key after a 1-second expiration</strong>

```html;kv-expire
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a new key-value pair
            await puter.kv.set('name', 'Puter Smith');
            puter.print("Key-value pair 'name' created/updated<br>");

            // (2) Set key to expire in 1 second
            await puter.kv.expire('name', 1);
            
            // (3) Wait 2 seconds and get the value
            setTimeout(async () => {
                const name = await puter.kv.get('name');
                puter.print(`Value: ${name}`);
            }, 2000);
        })();
    </script>
</body>
</html>
```
