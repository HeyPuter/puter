# `puter.removeItem()`
When passed a key, will remove that key from the key-value storage if it exists. If there is no item associated with the given key, this method will do nothing.

## Syntax
```js
puter.removeItem(key)
```

## Parameters
#### `key` (String)
A string containing the name of the key you want to remove.

## Return value 
A `Promise` that will resolve when the item associated with the key has been removed.

## Examples

<a href="https://puter.com/app/removeitem-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=removeItem&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D7e5be901-43be-4a35-9c97-eeb8dde9fe12%26expires%3D10001673402351%26signature%3D9f08499aab7166e99b9dadb64a5430b11c6a2d4d4fb3208f8a34a14396b94de9" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // removes the item associated with key 'myFancyKey'
        puter.removeItem('myFancyKey');
    </script>
</body>
</html>
```