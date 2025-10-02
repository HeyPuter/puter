# `puter.setItem()`
When passed a key and a value, will add that key to the user's key-value store (specific to individual apps), or update that key's value if it already exists.

## Syntax
```js
puter.setItem(key, value)
```

## Parameters

#### `key` (String)
A string containing the name of the key you want to create/update. The maximum allowed `key` size is **1 MB**.

#### `value` (String)
A string containing the value you want to give the key you are creating/updating. The maximum allowed `value` size is **10 MB**.

## Return value 
A `Promise` that will resolve when the key-value pair has been created or updated.

## Examples

<a href="https://puter.com/app/setitem-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=setItem&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D6127b6b7-2725-495f-b492-d313d75e01e0%26expires%3D10001673402435%26signature%3D1f0223af2ff66b351cf1d32f2e4e54c8cbca4533c89f0fc447f135e6ce416e0d" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        puter.setItem('name', 'Puter Smith');
    </script>
</body>
</html>
```