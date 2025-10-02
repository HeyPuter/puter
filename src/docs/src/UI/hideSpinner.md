Hides the active spinner instance.

## Syntax
```js
puter.ui.hideSpinner()
```

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // show the spinner
        puter.ui.showSpinner();

        // hide the spinner after 3 seconds
        setTimeout(()=>{
            puter.ui.hideSpinner();
        }, 3000);
    </script>
</body>
</html>
```