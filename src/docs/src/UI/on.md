---
title: puter.ui.on()
description: Listens to broadcast events from Puter.
platforms: [apps]
---

Listen to broadcast events from Puter. If the broadcast was received before attaching the handler, then the handler is called immediately with the most recent value.


## Syntax
```js
puter.ui.on(eventName, handler)
```

## Parameters

#### `eventName` (String)
Name of the event to listen to.

#### `handler` (Function)
Callback function run when the broadcast event is received.

## Broadcasts
Possible broadcasts are:

#### `localeChanged`
Sent on app startup, and whenever the user's locale on Puter is changed. The value passed to `handler` is:
```js
{
    language, // (String) Language identifier, such as 'en' or 'pt-BR'
}
```

#### `themeChanged`
Sent on app startup, and whenever the user's desktop theme on Puter is changed. The value passed to `handler` is:
```js
{
    palette: {
        primaryHue,         // (Float) Hue of the theme color
        primarySaturation,  // (String) Saturation of the theme color as a percentage, with % sign
        primaryLightness,   // (String) Lightness of the theme color as a percentage, with % sign
        primaryAlpha,       // (Float) Opacity of the theme color from 0 to 1
        primaryColor,       // (String) CSS color value for text
    }
}
```

#### `connection`
Sent when another app requests a connection to your app. The value passed to `handler` is:
```js
{
    conn,    // (AppConnection) Connection to the app that initiated the request
    accept,  // (Function) Call accept(value) to accept the connection; `value` is sent back to the requester
    reject,  // (Function) Call reject(value) to reject the connection; `value` is sent back to the requester
}
```

## Examples

```html
<html>
<body>
<script src="https://js.puter.com/v2/"></script>
<script>
    puter.ui.on('localeChanged', function(locale) {
        alert(`User's preferred language code is: ${locale.language}!`);
    })
</script>
</body>
</html>
```
