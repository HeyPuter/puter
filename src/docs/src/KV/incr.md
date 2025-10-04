Increments the value of a key. If the key does not exist, it is initialized with 0 before performing the operation. An error is returned if the key contains a value of the wrong type or contains a string that can not be represented as integer. This operation is limited to 64 bit signed integers.

## Syntax

```js
puter.kv.incr(key)
puter.kv.incr(key, amount)
```

## Parameters

#### `key` (string) (required)

The key of the value to increment.

#### `amount` (integer) (optional)

The amount to increment the value by. Defaults to 1.


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
