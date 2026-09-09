---
title: puter.kv.incr()
description: Increment values in the user's own key-value store by a specified amount.
platforms: [websites, apps, nodejs, workers]
---

Increments the value of a key. If the key does not exist, it is initialized with 0 before performing the operation. An error is returned if the key contains a value of the wrong type or contains a string that can not be represented as integer. This operation is limited to 64 bit signed integers.

## Syntax

```js
puter.kv.incr(key)
puter.kv.incr(key, amount)
puter.kv.incr(key, pathAndAmount)
```

## Parameters

#### `key` (String) (required)

The key of the value to increment.

#### `amount` (Integer | Object) (optional)

The amount to increment the value by. Defaults to 1.

When `amount` is an object: Increments a property within an object value stored in the key.

- Key: the path to the property (e.g., `"user.score"`)
- Value: the amount to increment by

`amount` must be within **±9,007,199,254,740,991** (`Number.MAX_SAFE_INTEGER`); a larger one is applied clamped to that bound. A counter stays exact only while its total is inside the same range — store anything that has to count past it as a string with [`puter.kv.set()`](/KV/set/).

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically; sparse array elements are not created.

## Return Value

Returns the new value of the key after the increment operation.

## Examples

<strong class="example-title">Increment the value of a key</strong>

```html;kv-incr
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.incr('testIncrKey').then((newValue) => {
            puter.print(`New value: ${newValue}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Increment a property within an object value</strong>

```html;kv-incr-nested
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // If 'stats' contains: { user: { score: 10 } }
            await puter.kv.set('stats', {user: {score: 10}})

            // This increments user.score by 2
            const newValue = await puter.kv.incr('stats', {"user.score": 2});

            // newValue will be: { user: { score: 12 } }
            puter.print(`New value: ${JSON.stringify(newValue)}`);
        })();
    </script>
</body>
</html>
```
