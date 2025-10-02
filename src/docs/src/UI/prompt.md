
Displays a prompt dialog by Puter. This will block the parent window until the user responds by pressing a button.

## Syntax
```js
puter.ui.prompt()
puter.ui.prompt(message)
puter.ui.prompt(message, placeholder)
```

## Parameters

#### `message` (optional)
A string to be displayed in the prompt dialog. If not set, the dialog will be empty. 

#### `placeholder` (optional)
A string to be displayed as a placeholder in the input field. If not set, the input field will be empty.


## Return value 
A `Promise` that resolves to the value of the input field when the user presses the OK button. If the user presses the Cancel button, the promise will resolve to `null`.

## Examples
```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.prompt('Please enter your name:', 'John Doe').then((resp) => {
            // print user's response to console
            console.log(resp);
        });
    </script>
</body>
</html>
```