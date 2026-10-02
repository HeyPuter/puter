---
title: puter.kv.expire()
description: Set the time-to-live (TTL) in seconds for a key in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Set the time-to-live (TTL) in seconds for a key in the key-value store.

## Syntax

```js
puter.kv.expire(key, ttlSeconds)
```

## Parameters

#### `key` (String) (required)

A string containing the name of the key.

#### `ttlSeconds` (Number) (required)

The number of seconds until the key is removed from the key-value store. `0` or less expires the key immediately.

## Return value

A `Promise` that will resolve to `true` when the expiration has been set.

## Keys That Don't Exist

A missing or already-expired key becomes an empty entry with the TTL you gave it, rather than staying absent. [`puter.kv.list()`](/KV/list/) shows it and [`puter.kv.get()`](/KV/get/) reads it as `null`, the same as a missing key — the old value, if there was one, never comes back. [`puter.kv.incr()`](/KV/incr/) rejects such an entry, the same as any non-number value.

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
                puter.print("Value :", name);
            }, 2000);
        })();
    </script>
</body>
</html>
```
