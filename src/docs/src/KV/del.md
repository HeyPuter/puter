---
title: puter.kv.del()
description: Remove keys from the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Removes a key from the user's key-value store. Deleting a key that doesn't exist does nothing and resolves the same way.

## Syntax

```js
puter.kv.del(key)
puter.kv.del(key, optConfig)
```

## Parameters

#### `key` (String) (required)

The key to remove.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument. It takes these properties:

- `handle` (String): Deletes from data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix, and the share needs `write` access. A key the owner's app keeps private reads as missing through the share, so deleting it resolves to `true` and leaves it in place. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Deletes from another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

## Return value

A `Promise` that resolves to `true` once the key is gone.

## Errors

With `handle`, the promise can reject with these codes:

| Code | Meaning |
| -- | -- |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, it isn't shared with you, or the call comes from an app other than the one whose data it shares. |
| `kv_handle_access_denied` | The share's access is below `write`. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid`. |
| `kv_handle_key_invalid` | The key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Calls through a share are turned off on this deployment. |

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
