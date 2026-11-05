---
title: puter.kv.flush()
description: Remove all key-value pairs from the user's own store for your app.
platforms: [websites, apps, nodejs, workers]
---

Removes every key-value pair from the user's key-value store for the current app. It's also available as `puter.kv.clear()`.

## Syntax

```js
puter.kv.flush()
```

## Parameters

None.

## Return value

A `Promise` that resolves to `true` once the store is empty, including when it was already empty.

## Errors

Flushing works only on your app's own store. To clear a prefix someone shared with you, delete its keys with [`puter.kv.del()`](/KV/del/). The promise rejects with these codes when given another store:

| Code | Meaning |
| -- | -- |
| `kv_handle_option_invalid` | Called with a `handle`, as in `flush({ handle })`. |
| `forbidden` | An app passed another app's `appUuid`. |

## Examples

```html;kv-flush
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a number of key-value pairs
            await puter.kv.set('name', 'Puter Smith');
            await puter.kv.set('age', 21);
            await puter.kv.set('isCool', true);
            puter.print("Key-value pairs created/updated<br>");

            // (2) Retrieve all keys
            const keys = await puter.kv.list();
            puter.print(`Keys are: ${keys}<br>`);

            // (3) Flush the key-value store
            await puter.kv.flush();
            puter.print('Key-value store flushed<br>');

            // (4) Retrieve all keys again, should be empty
            const keys2 = await puter.kv.list();
            puter.print(`Keys are now: ${keys2}<br>`);
        })();
    </script>
</body>
</html>
```
