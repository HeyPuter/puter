---
title: puter.kv.remove()
description: Remove values at one or more paths from a key in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Remove values from an existing key by path. Paths can target nested fields and array elements.

## Syntax

```js
puter.kv.remove(key, ...paths)
```

## Parameters

#### `key` (String) (required)

The key to remove values from.

#### `paths` (String[]) (required)

One or more paths to remove (for example, `"profile.bio"`).

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. Removing an array element shifts later elements down by one index.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Examples

<strong class="example-title">Remove nested fields from an object</strong>

```html;kv-remove
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('profile', { name: 'Puter', stats: { score: 10, level: 2 } });

            const updated = await puter.kv.remove('profile', 'stats.score');
            puter.print(`Updated profile: ${JSON.stringify(updated)}`);
        })();
    </script>
</body>
</html>
```
