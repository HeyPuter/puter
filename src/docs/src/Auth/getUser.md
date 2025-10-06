Returns the user's basic information.


## Syntax

```js
puter.auth.getUser();
```

## Parameters

None

## Return value

A promise that resolves to an object containing the user's basic information. The user's basic information is an object with the following properties:

- `uuid` - The user's UUID. This is a unique identifier that can be used to identify the user.
- `username` - The user's username.
- `email_confirmed` - Whether the user has confirmed their email address.

## Example

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
