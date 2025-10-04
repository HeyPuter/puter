When passed a key, will return that key's value, or `null` if the key does not exist.

## Syntax
```js
puter.kv.get(key)
```

## Parameters
#### `key` (String) (required)
A string containing the name of the key you want to retrieve the value of.

## Return value 
A `Promise` that will resolve to the key's value. If the key does not exist, it will resolve to `null`.

## Examples

<strong class="example-title">Retrieve the value of key 'name'</strong>

```html;kv-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a new key-value pair
            await puter.kv.set('name', 'Puter Smith');
            puter.print("Key-value pair 'name' created/updated<br>");

            // (2) Retrieve the value of key 'name'
            const name = await puter.kv.get('name');
            puter.print(`Name is: ${name}`);
        })();
    </script>
</body>
</html>
```
