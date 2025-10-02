Decrements the value of a key. If the key does not exist, it is initialized with 0 before performing the operation. An error is returned if the key contains a value of the wrong type or contains a string that can not be represented as integer.


## Syntax

```js
puter.kv.decr(key)
puter.kv.decr(key, amount)
```

## Parameters

#### `key` (string) (required)

The key of the value to decrement.

#### `amount` (integer) (optional)

The amount to decrement the value by. Defaults to 1.

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
