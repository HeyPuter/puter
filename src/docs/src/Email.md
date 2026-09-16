---
title: Email
description: Read the user's Puter mailbox and send transactional email from your app with Puter.js.
platforms: [websites, apps, nodejs, workers]
---

The Email API lets your app read the user's Puter mailbox and send transactional email.

Every Puter account has an email address, `{username}@puter.email`. Mail sent to it is stored in the user's own cloud drive, so your app can list the inbox and read messages, attachments included, once the user grants access to their mailbox. Your app can also send transactional email — a signup confirmation, a receipt, an alert — from a Puter-controlled address, with no mail server, sending domain, or DKIM to set up. A recipient with a Puter account can be reached at `{username}@puter.email`: that copy is filed straight into their Puter mailbox rather than relayed, on any plan, as long as they have set their mailbox up.

With the [User-Pays Model](/user-pays-model/), the account making the call covers its own usage: mail lives in the user's storage, and sends land on the caller's allowance rather than yours.

<div class="info">Transactional email is available to accounts on a paid plan for now. A call from a free account fails with <code>402</code> <code>subscription_required</code>.</div>

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="list"><span>List Messages</span></div>
    <div class="example-group" data-section="get"><span>Read a Message</span></div>
    <div class="example-group" data-section="sendTransactional"><span>Send Transactional Email</span></div>
</div>

<div class="example-content" data-section="list" style="display:block;">

#### List the ten newest messages in the inbox

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

</div>

<div class="example-content" data-section="get">

#### Read the newest message

```html;email-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const { items } = await puter.email.list({ limit: 1 });
            if (items.length === 0) return puter.print('Inbox is empty');

            const message = await puter.email.get(items[0].id);
            puter.print(`From: ${message.from?.address}<br>`);
            puter.print(`Subject: ${message.subject}<br>`);
            puter.print(`<pre>${message.text}</pre>`);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="sendTransactional">

#### Send a transactional email from a worker

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

</div>

## Functions

- **[`puter.email.list()`](/Email/list/)** - List the messages in the user's mailbox, newest first
- **[`puter.email.get()`](/Email/get/)** - Fetch and parse one message, attachments included
- **[`puter.email.sendTransactional()`](/Email/sendTransactional/)** - Send a transactional email from your app

## Examples

You can see the Puter.js Email features in action from the following examples:

- [List messages](/playground/email-list/)
- [Read a message](/playground/email-get/)
