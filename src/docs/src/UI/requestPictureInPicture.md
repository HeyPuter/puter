---
title: puter.ui.requestPictureInPicture()
description: Floats a page of your app in an always-on-top picture-in-picture window.
platforms: [apps]
---

Opens a page of your app in a picture-in-picture window.

A picture-in-picture window is a small always-on-top window that stays in view while the user works in other windows or tabs.

Browsers only let a top-level page open a Document Picture-in-Picture window, and an app runs inside an iframe — so calling `documentPictureInPicture.requestWindow()` yourself fails with `NotAllowedError`. Puter opens the window on your app's behalf and loads the page you name in it.

The page must come from your app's own origin. Inside it, your app's main frame is one of `window.parent.opener.frames`: probe them in a `try`/`catch` (frames from other origins throw), and the two pages can share objects directly — a `MediaStream`, which `postMessage` cannot carry, included. `BroadcastChannel` works between them as well.

Call it from a user gesture such as a click; browsers refuse otherwise. One window per app: asking again replaces the one that is up.

## Syntax
```js
puter.ui.requestPictureInPicture(options)
```

## Parameters

#### `options` (Object) (required)

| Option | Type | Description |
|--------|------|-------------|
| `url` | `String` | Required. The page to show in the window. Resolved against your app's own page, and must be on the same origin. |
| `width` | `Number` | Window width in CSS pixels. The browser may clamp it. |
| `height` | `Number` | Window height in CSS pixels. The browser may clamp it. |
| `onClose` | `Function` | Runs when the window closes other than through [`puter.ui.exitPictureInPicture()`](/UI/exitPictureInPicture/), typically when the user closes it. |

## Return value
A `Promise` that resolves once the window is up.

## Errors

The promise rejects with an error named the way the DOM would name it:

- `NotSupportedError` — the browser has no Document Picture-in-Picture, or the code isn't running as an app on the Puter desktop.
- `NotAllowedError` — not called from a user gesture.
- `SecurityError` — `url` is not on your app's origin.
- `TypeError` — `url` is not a URL.

## Examples

### Float a page from a button

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="pip">Picture-in-picture</button>
    <script>
        document.getElementById('pip').onclick = async () => {
            try {
                await puter.ui.requestPictureInPicture({
                    url: '/pip.html',
                    width: 400,
                    height: 300,
                    onClose: () => console.log('the user closed it'),
                });
            } catch (err) {
                console.error(err.name, err.message);
            }
        };
    </script>
</body>
</html>
```

### Reach the main frame from the floating page

```html
<!-- pip.html -->
<html>
<body>
    <video id="v" autoplay muted playsinline></video>
    <script>
        // The desktop opened this window, so its opener is the desktop, and
        // your app's main frame is one of the desktop's frames — the only
        // one this page is allowed to read.
        const opener = window.parent.opener;
        for (let i = 0; i < opener.frames.length; i++) {
            try {
                const main = opener.frames[i];
                if (main.myAppStream) {
                    document.getElementById('v').srcObject = main.myAppStream;
                    break;
                }
            } catch (e) {
                // a frame from another origin
            }
        }
    </script>
</body>
</html>
```
