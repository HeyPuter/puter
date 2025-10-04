Specify a function to execute when the one or more items have been opened. Items can be opened via a variety of methods such as: drag and dropping onto the app, double-clicking on an item, right-clicking on an item and choosing an app from the 'Open With...' submenu.

**Note** `onItemsOpened` is not called when items are opened using `showOpenFilePicker()`.

## Syntax
```js
puter.ui.onItemsOpened(handler)
```

## Parameters
#### `handler` (Function)
A function to execute after items are opened by user action.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.onItemsOpened(function(items){
            document.body.innerHTML = JSON.stringify(items);
        })
    </script>
</body>
</html>
```