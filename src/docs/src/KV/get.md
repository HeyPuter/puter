---
title: puter.kv.get()
description: Get the value stored in a key from the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Returns the value stored at a key, or `null` if the key doesn't exist or has expired.

## Syntax

```js
puter.kv.get(key)
puter.kv.get(key, optConfig)
```

## Parameters

#### `key` (String) (required)

The key to read.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument. It takes these properties:

- `handle` (String): Reads data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix, and the share needs `read` or `write` access. A key the owner's app keeps private reads as `null`. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Reads another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value

A `Promise` that resolves to the key's value, or `null` if the key doesn't exist or has expired. An empty entry left by [`puter.kv.expire()`](/KV/expire/) or [`puter.kv.expireAt()`](/KV/expireAt/) also reads as `null`.

## Errors

With `handle`, the promise can reject with these codes:

| Code | Meaning |
| -- | -- |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, it isn't shared with you, or the call comes from an app other than the one whose data it shares. |
| `kv_handle_access_denied` | The share is `watch` only. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid`. |
| `kv_handle_key_invalid` | The key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Calls through a share are turned off on this deployment. |

## Examples

<strong class="example-title">Retrieve the value of key 'name'</strong>

```html;kv-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a new key-value pair
            await puter.kv.set('name', 'Puter Smith');
            puter.print("Key-value pair 'name' created/updated<br>");

            // (2) Retrieve the value of key 'name'
            const name = await puter.kv.get('name');
            puter.print(`Name is: ${name}`);
        })();
    </script>
</body>
</html>
```
