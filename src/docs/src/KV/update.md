---
title: puter.kv.update()
description: Update one or more paths within a stored value.
platforms: [websites, apps, nodejs, workers]
---

Update one or more paths within the value stored at a key. You can update nested fields without overwriting the entire value.

## Syntax

```js
puter.kv.update(key, pathAndValueMap)
puter.kv.update(key, pathAndValueMap, ttlSeconds)
```

## Parameters

#### `key` (String) (required)

The key to update.

#### `pathAndValueMap` (Object) (required)

An object where each key is a dot-separated path (for example, `"profile.name"`) and each value is the new value for that path.

#### `ttlSeconds` (Number) (optional)

Time-to-live for the key, in seconds.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Examples

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
