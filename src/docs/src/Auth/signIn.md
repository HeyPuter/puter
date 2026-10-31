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

- `email`: The user's email address, if your site already knows it. The popup opens on email sign-in with the address filled in, and the user doesn't need a password:
  - A Gmail or Outlook address gets a Google or Microsoft sign-in button, when the Puter deployment offers that provider.
  - Any other address gets a sign-in link by email. When the user opens the link in the same browser, the popup finishes signing them in and the promise resolves. A link opened on another device signs the user in to Puter on that device instead, and your page's popup keeps waiting until the user closes it.

  The user can still choose a different account or switch to password sign-in, so the account they sign in with may not have this address.

Each call completes from its own sign-in window, including when multiple calls run at once.

## Return value

A `Promise` that will resolve to a [`SignInResult`](/Objects/signinresult/) object when the user has signed in.

## Rejection

The promise will reject with an object containing an `error` code and a human-readable `msg` in the following cases:

- `popup_blocked`: The sign-in popup was blocked by the browser. This usually happens when `signIn()` is not called from a user action (such as a click event).

- `auth_window_closed`: The user closed the sign-in window (or cancelled the consent dialog) without completing the sign-in process.

- `invalid_email`: The `email` option isn't an email address. The promise rejects before any popup opens.

- `not_available_in_app`: `signIn()` was called from an app running on Puter. An app is already signed in as the user who launched it — the Puter session hands it a token at launch — so there is nothing for the popup to do. Use `puter.auth.getUser()` to read who that is.

- `unsupported_origin`: the page has no origin the browser will vouch for, so there is no app for Puter to issue a token to and no address to deliver it to. This happens when the page is opened straight from disk (`file://`) or sits in an iframe sandboxed without `allow-same-origin`. Serve the page over `http://localhost` or a real domain, or add `allow-same-origin` to the iframe's `sandbox` attribute.

The promise may also reject with the failure response returned by the authentication window itself.

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

To start the popup on email sign-in for a user your site already knows, pass their address:

```js
await puter.auth.signIn({ email: 'user@example.com' });
```

The limits on sign-in links are listed in [Rate Limits and Quotas](/rate-limits-and-quotas/#sign-in-links).
