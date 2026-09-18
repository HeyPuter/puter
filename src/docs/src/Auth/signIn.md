---
title: puter.auth.signIn()
description: Initiate sign in process in your application with user's Puter account.
platforms: [websites]
---

Initiates the sign in process for the user. This will open a popup window with the appropriate authentication method. Puter automatically handles the authentication process and will resolve the promise when the user has signed in.

It is important to note that all essential methods in Puter handle authentication automatically. This method is only necessary if you want to handle authentication manually, for example if you want to build your own custom authentication flow.

This is a website-only method. An app running on Puter is already signed in as the user who launched it, so calling it there rejects with `not_available_in_app`.

<div class="info">

The `puter.auth.signIn()` function must be triggered by a user action (such as a click event) because it opens a popup window. Most browsers block popups that are not initiated by user interactions.

</div>

## Syntax

```js
puter.auth.signIn()
puter.auth.signIn(options)
```

## Parameters

#### `options` (optional)

`options` is an object with the following properties:

- `attempt_temp_user_creation`: A boolean value that indicates whether to Puter should automatically create a temporary user. This is useful if you want to quickly onboard a user without requiring them to sign up. They can always sign up later if they want to.

- `request_auth`: A boolean value that asks the popup to let the user re-pick their account, even when your site already holds a token for them. Puter otherwise skips that prompt for a site it has seen before. Useful for an explicit "switch account" button.

- `email`: Open the popup on the sign-in link window with this address prefilled, instead of on the password window. The popup tells the user that your site is powered by Puter, emails them a sign-in link, and asks them to check their inbox. Clicking the link signs them in (creating and confirming a Puter account if the address is new) and lands them on `returnUrl`, already signed in. The tab that opened the popup is left behind, so this promise does not resolve on that path; treat the landing page as where the user continues. Use it when your app already knows who the user is, for example from your own login, so they never have to invent a Puter password. The sign-in link is also offered as an option on the password window, so users can reach it without this.

- `returnUrl`: The page a sign-in link sends the user to after signing in. Defaults to the current page. It must be on the same origin as the page calling `signIn()`; when the user lands there, Puter.js signs that page in, so the flow works even if the link is opened on another device.

## Return value

A `Promise` that will resolve to a [`SignInResult`](/Objects/signinresult/) object when the user has signed in.

## Rejection

The promise will reject with an object containing an `error` code and a human-readable `msg` in the following cases:

- `popup_blocked`: The sign-in popup was blocked by the browser. This usually happens when `signIn()` is not called from a user action (such as a click event).

- `auth_window_closed`: The user closed the sign-in window (or cancelled the consent dialog) without completing the sign-in process.

- `not_available_in_app`: `signIn()` was called from an app running on Puter. An app is already signed in as the user who launched it — the Puter session hands it a token at launch — so there is nothing for the popup to do. Use `puter.auth.getUser()` to read who that is.

- `invalid_email`: `email` was given but is not an email address.

- `invalid_return_url`: `returnUrl` is not an absolute http(s) URL on this page's origin.

The promise may also reject with the failure response returned by the authentication window itself.

## Examples

<strong class="example-title">Sign in with a popup</strong>

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

<strong class="example-title">Sign in with an emailed link</strong>

```html;auth-sign-in-email
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="sign-in">Continue with Puter</button>
    <script>
        // Your app already knows the user's email, for example from its own login.
        const email = 'user@example.com';

        document.getElementById('sign-in').addEventListener('click', async () => {
            // The popup sends a sign-in link to the address; the promise resolves
            // once the user has clicked it. returnUrl is where the link lands them.
            const res = await puter.auth.signIn({ email, returnUrl: location.href });
            puter.print('Signed in as ' + res.username);
        });
    </script>
</body>
</html>
```
