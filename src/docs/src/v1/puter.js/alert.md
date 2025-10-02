# `puter.alert()`

Displays an alert dialog by Puter. Puter improves upon the traditional browser alerts by providing more flexibility. For example, you can customize the buttons displayed.

`puter.alert()` will block the parent window until user responds by pressing a button.

## Syntax
```js
puter.alert()
puter.alert(message)
puter.alert(message, buttons)
```

## Parameters

#### `message` (optional)
A string to be displayed in the alert dialog. If not set, the dialog will be empty. 

#### `buttons` (optional)
An array of objects that define the buttons to be displayed in the alert dialog. Each object must have a `label` property. The `value` property is optional. If it is not set, the `label` property will be used as the value. The `type` property is optional and can be set to `primary`, `success`, `info`, `warning`, or `danger`. If it is not set, the default type will be used.


## Return value 
A `Promise` that resolves to the value of the button pressed. If the `value` property of button is set it is returned, otherwise `label` property will be returned.

## Examples

<a href="https://puter.com/app/alert-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=alert&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D52a51837-4dd8-45da-9f65-481aa593a729%26expires%3D10001673401545%26signature%3D9301897f198ba028caf0b73ecb0fd67df678d55f5438a0292089ea9eb63ace8a" target="_blank" class="example-code-link">⤓ Download</a>
```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // display an alert with a message and three different types of buttons
        puter.alert('Please press a button!', [
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