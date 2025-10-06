Obtain a connection to the app that launched this app.

## Syntax
```js
puter.ui.parentApp()
```

## Parameters
`puter.ui.parentApp()` does not accept any parameters.

## Return value 
An [`AppConnection`](/Objects/AppConnection) to the parent, or null if there is no parent app.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        const parent = puter.ui.parentApp();
        if (!parent) {
            alert('This app was launched directly');
        } else {
            alert('This app was launched by another app');
            parent.postMessage("Hello, parent!");
        }
    </script>
</body>
</html>
```
