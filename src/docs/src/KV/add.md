---
title: puter.kv.add()
description: Add values to an existing key or nested path in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Add values to an existing key. When you pass an array, its elements are appended to the array stored at the key. When you pass an object, each key is treated as a path and the value is added at that path.

## Syntax

```js
puter.kv.add(key, value)
puter.kv.add(key, pathAndValue)
```

## Parameters

#### `key` (String) (required)

The key to add values to.

#### `value` (String | Number | Boolean | Object | Array) (optional)

The value to add to the key. Defaults to `1` when omitted.

An array is appended element by element, so wrap a single value in an array to append it as one element: `puter.kv.add('scores', [5])` appends `5`.

#### `pathAndValue` (Object) (optional)

An object where each key is a dot-separated path (for example, `"profile.tags"`) and each value is the value (or values) to add at that path.

Appended values follow the same limits as [`puter.kv.set()`](/KV/set/): **400 KB**, and every number within **±9,007,199,254,740,991** — a larger one is stored clamped to that bound.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Examples

<strong class="example-title">Append to an array stored at a key</strong>

```html;kv-add-array
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('scores', [1, 2, 3, 4]);

            // Each element of the array you pass is appended
            const updated = await puter.kv.add('scores', [5]);
            puter.print(`Updated scores: ${JSON.stringify(updated)}<br>`);

            // Passing several values appends all of them
            const extended = await puter.kv.add('scores', [6, 7]);
            puter.print(`Extended scores: ${JSON.stringify(extended)}`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Add values to an array inside an object</strong>

```html;kv-add
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('profile', { tags: ['alpha'] });

            const updated = await puter.kv.add('profile', { 'tags': ['beta', 'gamma'] });
            puter.print(`Updated profile: ${JSON.stringify(updated)}`);
        })();
    </script>
</body>
</html>
```
