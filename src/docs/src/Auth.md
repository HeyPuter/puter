The Authentication API enables users to authenticate with your application using their Puter account.

This is essential for users to access the various Puter.js APIs integrated into your application. The auth API supports several features, including sign-in, sign-out, checking authentication status, and retrieving user information.

<h2 style="margin-top: 60px;">Examples</h2>
<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="sign-in"><span>Sign In</span></div>
    <div class="example-group" data-section="is-signed-in"><span>Check Sign In</span></div>
    <div class="example-group" data-section="get-user"><span>Get User</span></div>
    <div class="example-group" data-section="sign-out"><span>Sign Out</span></div>
</div>

<div class="example-content" data-section="sign-in" style="display:block;">

#### Initiates the sign in process for the user

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

</div>

<div class="example-content" data-section="is-signed-in">

#### Checks whether the user is signed into the application

```html;auth-is-signed-in
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.print(`Sign in status: ${puter.auth.isSignedIn()}`);
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="get-user">

#### Returns the user's basic information

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.auth.getUser().then(function(user) {
            puter.print(JSON.stringify(user));
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="sign-out">

#### Signs the user out of the application

```html;auth-sign-out
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.auth.signOut();
    </script>
</body>
</html>
```

</div>

## Functions

These authentication features are supported out of the box when using Puter.js:

- **[`puter.auth.signIn()`](/Auth/signIn/)** - Sign in a user
- **[`puter.auth.signOut()`](/Auth/signOut/)** - Sign out the current user
- **[`puter.auth.isSignedIn()`](/Auth/isSignedIn/)** - Check if a user is signed in
- **[`puter.auth.getUser()`](/Auth/getUser/)** - Get information about the current user

## Examples

You can see various Puter.js authentication features in action from the following examples:

- [Sign in](/playground/?example=auth-sign-in)
- [Sign Out](/playground/?example=auth-sign-out)
- [Check Sign In](/playground/?example=auth-is-signed-in)
- [Get User Information](/playground/?example=auth-get-user)
