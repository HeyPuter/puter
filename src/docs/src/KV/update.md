---
title: puter.kv.update()
description: Update one or more paths within a stored value in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Update one or more paths within the value stored at a key. You can update nested fields without overwriting the entire value.

## Syntax

```js
puter.kv.update(key, pathAndValueMap)
puter.kv.update(key, pathAndValueMap, ttl)
puter.kv.update({ key, pathAndValueMap, ttl })
```

## Parameters

#### `key` (String) (required)

The key to update.

#### `pathAndValueMap` (Object) (required)

An object where each key is a path (for example, `"profile.name"`) and each value is the new value for that path.

Each value follows the same limits as [`puter.kv.set()`](/KV/set/): **400 KB**, and every number within **±9,007,199,254,740,991** — a larger one is stored clamped to that bound.

#### `ttl` (Number) (optional)

Time-to-live for the key, in seconds.

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically; sparse array elements are not created.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Examples

<strong class="example-title">Update an element of a root array</strong>

```html;kv-update-root-array
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('players', [{ score: 1 }, { score: 2 }]);
            const updated = await puter.kv.update('players', { '[0].score': 10 });
            puter.print(JSON.stringify(updated));
        })();
    </script>
</body>
</html>
```

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
