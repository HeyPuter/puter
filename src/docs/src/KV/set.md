When passed a key and a value, will add it to the user's key-value store, or update that key's value if it already exists.

<div class="info">Each app has its own private key-value store within each user's account. Apps cannot access the key-value stores of other apps - only their own.</div>

## Syntax
```js
puter.kv.set(key, value)
```

## Parameters

#### `key` (String) (required)
A string containing the name of the key you want to create/update. The maximum allowed `key` size is **1 KB**.

#### `value` (String | Number | Boolean | Object | Array)
A string containing the value you want to give the key you are creating/updating. The maximum allowed `value` size is **400 KB**.

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
