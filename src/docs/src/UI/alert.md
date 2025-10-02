
Displays an alert dialog by Puter. Puter improves upon the traditional browser alerts by providing more flexibility. For example, you can customize the buttons displayed.

`puter.ui.alert()` will block the parent window until user responds by pressing a button.

## Syntax
```js
puter.ui.alert(message)
puter.ui.alert(message, buttons)
```

## Parameters

#### `message` (optional)
A string to be displayed in the alert dialog. If not set, the dialog will be empty. 

#### `buttons` (optional)
An array of objects that define the buttons to be displayed in the alert dialog. Each object must have a `label` property. The `value` property is optional. If it is not set, the `label` property will be used as the value. The `type` property is optional and can be set to `primary`, `success`, `info`, `warning`, or `danger`. If it is not set, the default type will be used.


## Return value 
A `Promise` that resolves to the value of the button pressed. If the `value` property of button is set it is returned, otherwise `label` property will be returned.

## Examples
```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // display an alert with a message and three different types of buttons
        puter.ui.alert('Please press a button!', [
            {
                label: 'Hello :)',
                value: 'hello',
                type: 'primary',
            },
            {
                label: 'Bye :(',
                type: 'danger',
            },
            {
                label: 'Cancel',
            },
        ]).then((resp) => {
            // print user's response to console
            console.log(resp);
        });
    </script>
</body>
</html>
```