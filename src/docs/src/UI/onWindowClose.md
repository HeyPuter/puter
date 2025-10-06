Specify a function to execute when the window is about to close. For example the provided function will run right after  the 'X' button of the window has been pressed.

**Note** `onWindowClose` is not called when app is closed using `puter.exit()`.

## Syntax
```js
puter.ui.onWindowClose(handler)
```

## Parameters
#### `handler` (Function)
A function to execute when the window is going to close.


## Examples
```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.onWindowClose(function(){
            alert('Window is about to close!')
            puter.exit();
        })
    </script>
</body>
</html>
```