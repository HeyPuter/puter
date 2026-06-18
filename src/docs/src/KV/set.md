---
title: puter.kv.set()
description: Save or update values in key-value store.
platforms: [websites, apps, nodejs, workers]
---

When passed a key and a value, will add it to the user's key-value store, or update that key's value if it already exists.

<div class="info">Each app has its own private key-value store within each user's account. Apps cannot access the key-value stores of other apps - only their own.</div>

## Syntax

```js
puter.kv.set(key, value)
puter.kv.set(key, value, expireAt)
puter.kv.set({ key, value, expireAt })
puter.kv.set([ { key, value, expireAt }, ... ])
puter.kv.set({ items: [ { key, value, expireAt }, ... ] })
```

## Parameters

#### `key` (String) (required)

A string containing the name of the key you want to create/update. The maximum allowed `key` size is **1 KB**.

#### `value` (String | Number | Boolean | Object | Array)

A string containing the value you want to give the key you are creating/updating. The maximum allowed `value` size is **400 KB**.

#### `expireAt` (Number) (optional)

A number containing when the key should expire in timestamp seconds.

#### `items` (Array) (batch only)

An array of `{ key, value, expireAt? }` objects, set in a single request. Each `key` is required and follows the same **1 KB** key / **400 KB** value limits. You can pass the array directly (`set([...])`) or wrapped in an object (`set({ items: [...] })`).

You may also pass a single object instead of positional arguments: `set({ key, value, expireAt })`.

## Return value

A `Promise` that will resolves to `true` when the key-value pair has been created or the existing key's value has been updated.

## Examples

<strong class="example-title">Create a new key-value pair</strong>

```html;kv-set
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.set('name', 'Puter Smith').then((success) => {
            puter.print(`Key-value pair created/updated: ${success}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Set multiple key-value pairs at once</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set([
                { key: 'name', value: 'Puter Smith' },
                { key: 'age',  value: 21 },
            ]);
            puter.print('Batch set complete');
        })();
    </script>
</body>
</html>
```
