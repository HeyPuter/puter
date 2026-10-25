---
title: puter.kv.del()
description: Remove keys from the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

When passed a key, will remove that key from the key-value storage. If there is no key with the given name in the key-value storage, nothing will happen.

## Syntax
```js
puter.kv.del(key)
puter.kv.del(key, optConfig)
```

## Parameters
#### `key` (String) (required)
A string containing the name of the key you want to remove.

#### `optConfig` (Object) (optional)

The last argument. It takes these properties:

- `handle` (String): Work on data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix. The share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Work on another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value 
A `Promise` that will resolve to `true` when the key has been removed.

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

<strong class="example-title">Delete the key 'name'</strong>

```html;kv-del
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // create a new key-value pair
            await puter.kv.set('name', 'Puter Smith');
            puter.print("Key-value pair 'name' created/updated<br>");

            // delete the key 'name'
            await puter.kv.del('name');
            puter.print("Key-value pair 'name' deleted<br>");

            // try to retrieve the value of key 'name'
            const name = await puter.kv.get('name');
            puter.print(`Name is now: ${name}`);
        })();
    </script>
</body>
</html>
```
