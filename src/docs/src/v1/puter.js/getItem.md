# `puter.getItem()`
When passed a key, will return that key's value, or `null` if the key does not exist.

## Syntax
```js
puter.getItem(key)
```

## Parameters
#### `key` (String)
A string containing the name of the key you want to retrieve the value of.

## Return value 
A `Promise` that will resolve to a string containing the value of the key. If the key does not exist, it will resolve to `null`.

## Examples

<a href="https://puter.com/app/getitem-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=getItem&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D0f50655a-695b-4c2f-aaae-00a2c54817e2%26expires%3D10001673402274%26signature%3Da8bb4f89801dafaa31b75e9d960e09c24a356501bf237411b01820314e441b9f" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Retrieves the value of key 'name', if exists, and prints it to the browser console
        puter.getItem('name').then((value)=>{
            console.log(value)
        });
    </script>
</body>
</html>
```