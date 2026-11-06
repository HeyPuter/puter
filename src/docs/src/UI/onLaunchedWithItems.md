---
title: puter.ui.onLaunchedWithItems()
description: Executes a callback function if the app is launched with items.
platforms: [apps]
---

Sets a callback function to run if the app is launched with items.

The callback runs when the user opens one or more items with the app, by double-clicking them, or by right-clicking them and choosing the app from the 'Open With...' submenu.

## Syntax
```js
puter.ui.onLaunchedWithItems(handler)
```

## Parameters
#### `handler` (Function)
A function to execute after items are opened by user action. The function will be passed an array of items. Each items is either a file or a directory.

## Launching from a URL

An app can also be launched with a file straight from a link, by naming the
file in the `file` query parameter:

```
https://puter.com/app/<app-name>?file=<path>
```

The path may be absolute (`/username/Documents/report.docx`) or written
relative to the user's home directory (`~/Documents/report.docx`). Because the
link, not the user, picked the file, Puter first asks the user to allow the app
access to it. Once allowed, the file is handed to the app exactly as
double-clicking it would, so `onLaunchedWithItems` receives it and
`wasLaunchedWithItems()` returns `true`.

If the file doesn't exist, the user can't reach it or declines the prompt, or
the path names a folder, the app is launched with no items rather than failing
to open.

## Examples

### Show the items the app was launched with

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
