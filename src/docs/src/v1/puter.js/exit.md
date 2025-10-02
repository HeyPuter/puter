# `puter.exit()`

Will terminate the running application and close its window.

## Syntax
```js
puter.exit()
```

## Parameters
`puter.exit()` does not accept any parameters.

## Examples

<a href="https://puter.com/app/puterexit-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=exit&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D5eec2672-66dd-4d00-befc-fd774e95decb%26expires%3D10001673407659%26signature%3D2a6d87cfb1e2df2f6a0c8c8b45b7de719e048952b5bef877b6225a6dda19e82c" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <button id="exit-button">Exit App</button>
    <script>
        const exit_button = document.getElementById('exit-button');
        exit_button.addEventListener('click', () => {
            puter.exit();
        });
    </script>
</body>
</html>
```