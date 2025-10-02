Initiates the sign in process for the user. This will open a popup window with the appropriate authentication method. Puter automatically handles the authentication process and will resolve the promise when the user has signed in.

It is important to note that all essential methods in Puter handle authentication automatically. This method is only necessary if you want to handle authentication manually, for example if you want to build your own custom authentication flow.

## Syntax

```js
puter.auth.signIn();
puter.auth.signIn(options);
```

## Parameters

#### `options` (optional)
`options` is an object with the following properties:

- `attempt_temp_user_creation`: A boolean value that indicates whether to Puter should automatically create a temporary user. This is useful if you want to quickly onboard a user without requiring them to sign up. They can always sign up later if they want to.

## Return value

A `Promise` that will resolve to `true` when the user has signed in. The promise will never reject.

## Example

```html;auth-sign-in
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="sign-in">Sign in</button>
    <script>
        // Because signIn() opens a popup window, it must be called from a user action.
        document.getElementById('sign-in').addEventListener('click', async () => {
            // signIn() will resolve when the user has signed in.
            await puter.auth.signIn().then((res) => {
                puter.print('Signed in<br>' + JSON.stringify(res));
            });
        });
    </script>
</body>
</html>
```
