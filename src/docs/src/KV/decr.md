---
title: puter.kv.decr()
description: Decrement numeric values in key-value store by a specified amount.
platforms: [websites, apps, nodejs, workers]
---

Decrements the value of a key. If the key does not exist, it is initialized with 0 before performing the operation. An error is returned if the key contains a value of the wrong type or contains a string that can not be represented as integer.

## Syntax

```js
puter.kv.decr(key)
puter.kv.decr(key, amount)
puter.kv.decr(key, pathAndAmount)
```

## Parameters

#### `key` (String) (required)

The key of the value to decrement.

#### `amount` (Integer | Object) (optional)

The amount to decrement the value by. Defaults to 1.

When `amount` is an object: Decrements a property within an object value stored in the key.

- Key: the path to the property (e.g., `"user.score"`)
- Value: the amount to decrement by

## Return Value

Returns the new value of the key after the decrement operation.

## Examples

<strong class="example-title">Decrement the value of a key</strong>

```html;kv-decr
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.decr('testDecrKey').then((newValue) => {
            puter.print(`New value: ${newValue}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Decrement a property within an object value</strong>

```html;kv-decr-nested
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // If 'stats' contains: { user: { score: 10 } }
            await puter.kv.set('stats', {user: {score: 10}})

            // This decrements user.score by 2
            const newValue = await puter.kv.decr('stats', {"user.score": 2});

            // newValue will be: { user: { score: 8 } }
            puter.print(`New value: ${JSON.stringify(newValue)}`);
        })();
    </script>
</body>
</html>
```
