Returns an array of all keys in the user's key-value store for the current app. If the user has no keys, the array will be empty.

## Syntax
```js
puter.kv.list()
puter.kv.list(pattern)
puter.kv.list(returnValues = false)
puter.kv.list(pattern, returnValues = false)
```

## Parameters
#### `pattern` (String) (optional)
If set, only keys that match the given pattern will be returned. The pattern can contain the `*` wildcard character, which matches any number of characters. For example, `abc*` will match all keys that start with `abc`, such as `abc`, `abc123`, `abc123xyz`, etc. Default is `*`, which matches all keys.

#### `returnValues` (Boolean) (optional)
If set to `true`, the returned array will contain objects with both `key` and `value` properties. If set to `false`, the returned array will contain only the keys. Default is `false`.

## Return value
A `Promise` that will resolve to an array of all keys (and values, if `returnValues` is set to `true`) the user's key-value store for the current app. If the user has no keys, the array will be empty. 

## Examples

<strong class="example-title">Retrieve all keys in the user's key-value store for the current app</strong>

```html;kv-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a number of key-value pairs
            await puter.kv.set('name', 'Puter Smith');
            await puter.kv.set('age', 21);
            await puter.kv.set('isCool', true);
            puter.print("Key-value pairs created/updated<br><br>");

            // (2) Retrieve all keys
            const keys = await puter.kv.list();
            puter.print(`Keys are: ${keys}<br><br>`);

            // (3) Retrieve all keys and values
            const key_vals = await puter.kv.list(true);
            puter.print(`Keys and values are: ${(key_vals).map((key_val) => key_val.key + ' => ' + key_val.value)}<br><br>`);

            // (4) Match keys with a pattern
            const keys_matching_pattern = await puter.kv.list('is*');
            puter.print(`Keys matching pattern are: ${keys_matching_pattern}<br>`);

            // (5) Delete all keys (cleanup)
            await puter.kv.del('name');
            await puter.kv.del('age');
            await puter.kv.del('isCool');
        })();
    </script>
</body>
```
