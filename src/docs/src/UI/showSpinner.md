Shows an overlay with a spinner in the center of the screen. If multiple instances of `puter.ui.showSpinner()` are called, only one spinner will be shown until all instances are hidden.

## Syntax
```js
puter.ui.showSpinner()
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