# `puter.onItemsOpened()`
Specify a function to execute when the one or more items have been opened. Items can be opened via a variety of methods such as: drag and dropping onto the app, double-clicking on an item, right-clicking on an item and choosing an app from the 'Open With...' submenu.

**Note** `onItemsOpened` is not called when items are opened using `showOpenFilePicker()`.

## Syntax
```js
puter.onItemsOpened(handler)
```

## Parameters
#### `handler` (Function)
A function to execute after items are opened by user action.

## Examples

<a href="https://puter.com/app/onitemsopened-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=onItemsOpened&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D2aac958f-6b94-4a29-adf0-538ff0dc04f2%26expires%3D10001673402328%26signature%3Dea46a00a97a01b327c41a03d73f7a9cb2ccd4e445543568240468c9c85331841" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        puter.onItemsOpened(function(items){
            document.body.innerHTML = JSON.stringify(items);
        })
    </script>
</body>
</html>
```