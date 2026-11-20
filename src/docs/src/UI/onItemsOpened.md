---
title: puter.ui.onItemsOpened()
description: Executes a function when one or more items have been opened.
platforms: [apps]
---

Sets a function to run when one or more items are opened in your app.

Items can be opened in several ways, such as dragging and dropping them onto the app, double-clicking an item, or right-clicking an item and choosing the app from the 'Open With...' submenu.

**Deprecated** This handler also fires when items are dropped onto the app. New code should handle the `drop` event for drag-and-drop instead.

**Note** `onItemsOpened` is not called when items are opened using `showOpenFilePicker()`.

## Syntax
```js
puter.ui.onItemsOpened(handler)
```

## Parameters
#### `handler` (Function)
A function to execute after items are opened by user action.

## Examples

### Show the items opened in the app

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