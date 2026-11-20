---
title: puter.ui.onWindowClose()
description: Executes a function when the window is about to close.
platforms: [apps]
---

Sets a function to run when the window is about to close.

For example, the function runs right after the user presses the window's 'X' button.

**Note** `onWindowClose` is not called when app is closed using `puter.exit()`.

## Syntax
```js
puter.ui.onWindowClose(handler)
```

## Parameters
#### `handler` (Function)
A function to execute when the window is going to close.


## Examples
### Run code before the window closes

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