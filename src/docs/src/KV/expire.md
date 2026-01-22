---
title: puter.kv.expire()
description: Set the time-to-live (TTL) in seconds for a key in the key-value store.
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

The number of seconds until the key is removed from the key-value store.

## Return value

A `Promise` that will resolve to `true` when the expiration has been set.

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
