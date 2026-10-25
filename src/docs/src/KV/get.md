---
title: puter.kv.get()
description: Get the value stored in a key from the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

When passed a key, will return that key's value, or `null` if the key does not exist or has expired.

## Syntax
```js
puter.kv.get(key)
puter.kv.get(key, optConfig)
```

## Parameters
#### `key` (String) (required)
A string containing the name of the key you want to retrieve the value of.

#### `optConfig` (Object) (optional)

The last argument. It takes these properties:

- `handle` (String): Work on data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix. The share needs `read` or `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Work on another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value 
A `Promise` that will resolve to the key's value. If the key does not exist or has expired, it will resolve to `null`. An empty marker left by [`puter.kv.expire()`](/KV/expire/) or [`puter.kv.expireAt()`](/KV/expireAt/) also reads as `null`.

## Errors

With `handle`, the promise can reject with these codes:

| Code | Meaning |
| -- | -- |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, or it isn't shared with you. |
| `kv_handle_access_denied` | The share's access doesn't allow this method. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid` or `disableSharing`. |
| `kv_handle_key_invalid` | With `handle`, the key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Shares can't be used this way on this deployment. |

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
