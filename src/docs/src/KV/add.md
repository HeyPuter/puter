---
title: puter.kv.add()
description: Add values to an existing key or nested path.
platforms: [websites, apps, nodejs, workers]
---

Add values to an existing key. When you pass an object, each key is treated as a path and the value is added at that path.

## Syntax

```js
puter.kv.add(key, value)
puter.kv.add(key, pathAndValue)
```

## Parameters

#### `key` (String) (required)

The key to add values to.

#### `value` (String | Number | Boolean | Object | Array) (optional)

The value to add to the key.

#### `pathAndValue` (Object) (optional)

An object where each key is a dot-separated path (for example, `"profile.tags"`) and each value is the value (or values) to add at that path.

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Examples

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
