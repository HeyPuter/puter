---
title: Email
description: Read the user's Puter mailbox, and send transactional email from your app — receipts, alerts, confirmations — through a worker, from a Puter-controlled address.
platforms: [websites, apps, nodejs, workers]
---

The Puter.js Email API has two halves. Your app can **read the user's mailbox**: every Puter account has an address, `{username}@puter.email`, and the mail it receives is stored in the user's own cloud drive as standard `message/rfc822` objects. And your app can **send transactional email**: mail your app sends to a person because of something they did — a signup confirmation, a receipt, a password reset, an alert.

## Reading the user's mailbox

Mail sent to `{username}@puter.email` lands under the user's `~/.mail` folder, one object per message, and the user's own outgoing mail is kept there too. `list()` pages through a folder newest first without downloading a single message, and `get()` fetches and parses one message, attachments included.

The mailbox belongs to the user, so it is protected like the rest of their files. Your app reads it only after the user grants `fs:/{username}/.mail:read`:

```js
const user = await puter.auth.getUser();
const granted = await puter.perms.request('permission', {
    permission: `fs:/${user.username}/.mail:read`,
});
```

Storage is the source of truth: a message is a file, and its `path` comes back on every listing item, so `puter.fs.read()` and `puter.fs.delete()` work on it directly.

```html;email-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const page = await puter.email.list({ limit: 10 });
            for (const message of page.items) {
                puter.print(`${message.date}  ${message.subject}<br>`);
            }
        })();
    </script>
</body>
</html>
```

## Sending transactional email

<div class="info">Transactional email is available to accounts on a paid plan for now. A call from a free account fails with <code>402</code> <code>subscription_required</code>.</div>

Transactional email is not a mailing-list tool: a message reaches at most ten recipients, and every recipient can opt out of your app's mail with one click.

Mail goes out from a Puter-controlled address labelled with your app's title, for example `"My App" <my-app-no-reply@apps.puter.email>`, so you never set up a mail server, a sending domain, or DKIM. Replies go to your account email unless you say otherwise.

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

### Recipient protections

Every message carries an unsubscribe link and a report-abuse link. Opting out is per app: a recipient who unsubscribes from your app stops getting your app's mail and still hears from other apps. Opted-out recipients are dropped from your later sends and come back in the result's `suppressed` array, so your app can stop asking. A send whose every `to` recipient has opted out is rejected.

### Mail the user sends as themselves

`puter.email.send()` is a separate surface: it sends a message from the user's own `<username>@puter.email` address, composed in the client and filed in the user's `~/.mail` folder, where `list({ folder: 'sent' })` finds it. Use `sendTransactional()` when your app is the sender; use `send()` when the user is.

## Functions

- **[`puter.email.list()`](/Email/list/)** - List the messages in the user's mailbox, newest first
- **[`puter.email.get()`](/Email/get/)** - Fetch and parse one message, attachments included
- **[`puter.email.sendTransactional()`](/Email/sendTransactional/)** - Send a transactional email from your app
