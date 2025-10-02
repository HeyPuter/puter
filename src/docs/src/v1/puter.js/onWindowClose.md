# `puter.onWindowClose()`
Specify a function to execute when the window is about to close. For example the provided function will run right after  the 'X' button of the window has been pressed.

**Note** `onWindowClose` is not called when app is closed using `puter.exit()`.

## Syntax
```js
puter.onWindowClose(handler)
```

## Parameters
#### `handler` (Function)
A function to execute when the window is going to close.


## Examples

<a href="https://puter.com/app/onwindowclose-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=onWindowClose&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D83ff59b4-0f99-4e5e-afbe-2cfe233ea76b%26expires%3D10001673402340%26signature%3D7b3542d531e0bf89258b4b52ad818b711c97c658e7b2cdd5bc4bcdcd70d4bfe8" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        puter.onWindowClose(function(){
            alert('Window is about to close!')
            puter.exit();
        })
    </script>
</body>
</html>
```