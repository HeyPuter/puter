---
title: puter.ui.onLaunchedWithItems()
description: Executes a callback function if the app is launched with items.
platforms: [apps]
---

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

## Launching from a URL

An app can also be launched with a file straight from a link, by naming the
file in the `file` query parameter:

```
https://puter.com/app/<app-name>?file=<path>
```

The path may be absolute (`/username/Documents/report.docx`) or written
relative to the user's home directory (`~/Documents/report.docx`). The file is
handed to the app exactly as double-clicking it would, so `onLaunchedWithItems`
receives it and `wasLaunchedWithItems()` returns `true`.

If the file doesn't exist, or the user doesn't have access to it, the app is
launched with no items rather than failing to open.
