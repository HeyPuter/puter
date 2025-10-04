Specify a callback function to execute if the app is launched with items. `onLaunchedWithItems` will be called if one or more items are opened via double-clicking on items, right-clicking on items and choosing the app from the 'Open With...' submenu.

## Syntax
```js
puter.ui.onLaunchedWithItems(handler)
```

## Parameters
#### `handler` (Function)
A function to execute after items are opened by user action. The function will be passed an array of items. Each items is either a file or a directory.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.onLaunchedWithItems(function(items){
            document.body.innerHTML = JSON.stringify(items);
        })
    </script>
</body>
</html>
```