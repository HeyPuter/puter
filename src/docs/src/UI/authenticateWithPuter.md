Presents a dialog to the user to authenticate with their Puter account.

## Syntax

```js
puter.ui.authenticateWithPuter()
```

## Parameters
None.

## Return value
A `Promise` that will resolve to `true`. If the user cancels the dialog, the promise will be rejected with an error.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Presents a dialog to the user to authenticate with their Puter account.
        puter.ui.authenticateWithPuter().then((user)=>{
            console.log(user)
        });
    </script>
</body>
</html>
```