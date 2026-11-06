---
title: puter.ui.exitPictureInPicture()
description: Closes the picture-in-picture window your app opened.
platforms: [apps]
---

Closes the picture-in-picture window opened with [`puter.ui.requestPictureInPicture()`](/UI/requestPictureInPicture/), if one is open.

The window's `onClose` callback doesn't run when your app closes the window this way.

## Syntax
```js
puter.ui.exitPictureInPicture()
```

## Return value
A `Promise` that resolves to `true` if there was a window to close, `false` otherwise.

## Examples

### Close the picture-in-picture window from a button

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="exit">Exit picture-in-picture</button>
    <script>
        document.getElementById('exit').onclick = async () => {
            const wasOpen = await puter.ui.exitPictureInPicture();
            console.log(wasOpen ? 'closed' : 'nothing was open');
        };
    </script>
</body>
</html>
```
