---
title: Email
description: Send transactional email from your app — receipts, alerts, confirmations — through a worker, from a Puter-controlled address.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">Transactional email is available to accounts on a paid plan for now. A call from a free account fails with <code>402</code> <code>subscription_required</code>.</div>

The Puter.js Email API lets your app send **transactional email**: mail your app sends to a person because of something they did — a signup confirmation, a receipt, a password reset, an alert. It is not a mailing-list tool: a message reaches at most ten recipients, and every recipient can opt out of your app's mail with one click.

Mail goes out from a Puter-controlled address labelled with your app's title, for example `"My App" <my-app-no-reply@apps.puter.email>`, so you never set up a mail server, a sending domain, or DKIM. Replies go to your account email unless you say otherwise. A recipient with a Puter account can be reached at `<username>@puter.email`: that copy is filed straight into their Puter mailbox rather than relayed, on any plan, as long as they have set their mailbox up.

## How sending works

Every send is authorized by a **worker**. Either the worker sends directly, or your app sends with the user's session and passes the worker's token as `emailAccessToken`. In both cases the account that makes the call is the one billed and rate-limited — the [User-Pays Model](/user-pays-model/) — so your users' sends land on their own allowances rather than yours.

```js
// In a worker: the worker authorizes the send, the calling user pays for it.
router.post('/notify', async ({ request, user }) => {
    const { to, subject, text } = await request.json();
    return await user.puter.email.sendTransactional({
        to,
        subject,
        text,
        emailAccessToken: me.puter.authToken,
    });
});
```

## Functions

- **[`puter.email.sendTransactional()`](/Email/sendTransactional/)** - Send a transactional email from your app

## Recipient protections

Every message carries an unsubscribe link and a report-abuse link. Opting out is per app: a recipient who unsubscribes from your app stops getting your app's mail and still hears from other apps. Opted-out recipients are dropped from your later sends and come back in the result's `suppressed` array, so your app can stop asking. A send whose every `to` recipient has opted out is rejected.

## Mail the user sends as themselves

`puter.email.send()` is a separate surface: it sends a message from the user's own `<username>@puter.email` address, composed in the client and filed in the user's `~/.mail` folder. Use `sendTransactional()` when your app is the sender; use `send()` when the user is.
