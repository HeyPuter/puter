---
title: puter.ui.exitPictureInPicture()
description: Closes the picture-in-picture window your app opened.
platforms: [apps]
---

Closes the picture-in-picture window opened with [`puter.ui.requestPictureInPicture()`](/UI/requestPictureInPicture/), if one is up. Its `onClose` callback does not run for this — you asked for the close.

## Syntax
```js
puter.ui.exitPictureInPicture()
```

## Return value
A `Promise` that resolves to `true` if there was a window to close, `false` otherwise.

## Examples

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
