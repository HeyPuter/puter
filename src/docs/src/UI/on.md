---
title: puter.ui.on()
description: Listens to broadcast events from Puter.
platforms: [apps]
---

Listens for broadcast events from Puter.

If the broadcast was received before you attached the handler, the handler is called immediately with the most recent value.


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

### Listen for language changes

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
