---
title: Add a Contact Form
description: "Learn how to add a contact form to your app or website with Puter.js, so every message a visitor sends lands in your email inbox."
tags: [workers, email, kv]
order: 39
---

Many apps and websites need a contact form, so visitors can reach you without
you publishing your email address. Sending that message to your inbox needs
code that runs outside the visitor's browser, which usually means running a
mail server or signing up for a form service.

With Puter.js, a [serverless worker](/Workers/) receives the form and sends it
to your email with [`puter.email.sendTransactional()`](/Email/sendTransactional/).
There is no server or sending domain to set up.

## Write the Worker

The worker has one route that reads the form fields and emails them to you.
Put your own email address in `CONTACT_TO`:

```js
const CONTACT_TO = 'you@example.com';

router.post('/contact', async ({ request }) => {
    const { name, email, message } = await request.json();
    if (!name || !email || !message) {
        return new Response('name, email and message are required', { status: 400 });
    }

    await me.puter.email.sendTransactional({
        to: CONTACT_TO,
        replyTo: email,
        subject: `Contact form: ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
    });

    return { ok: true };
});
```

The recipient is fixed in the worker, so the form can only ever send mail to
you. The `replyTo` field is the visitor's address, so pressing reply in your
inbox writes back to them.

The email is sent with [`me.puter`](/Workers/router/#integration-with-puter-js), which
is Puter.js signed in as you, the worker's owner. Sends are billed to you, and
[transactional email](/Email/sendTransactional/) needs your account to be on a
paid plan.

To collect more fields, such as a phone number or a topic, read them from the
request body and add them to `text`.

## Deploy the Worker

Deploy the worker to get its URL, such as `https://my-contact.puter.work`. The
[Workers deployment guide](/Workers/#deployment) covers each way to deploy.

## Add the Form

The form is plain HTML with one input per field the worker reads:

```html
<form id="contact-form">
    <input name="name" placeholder="Your name" required>
    <input name="email" type="email" placeholder="Your email" required>
    <textarea name="message" placeholder="Your message" required></textarea>
    <button type="submit">Send</button>
</form>
```

## Send the Form to the Worker

When the form is submitted, post its fields to the worker as JSON:

```js
const WORKER_URL = 'https://my-contact.puter.work';
const form = document.getElementById('contact-form');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const res = await fetch(`${WORKER_URL}/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });

        if (res.ok) {
            form.reset();
            alert('Thanks, your message was sent.');
        } else {
            alert(await res.text());
        }
    } catch {
        alert('Something went wrong. Please try again.');
    }
});
```

The request is a plain `fetch()`, so visitors do not need a Puter account to
use the form.

Every message sent through the form now arrives in your email inbox.

## Limit How Often a Visitor Can Send

Anyone who knows the worker's URL can call the `/contact` route, and every call
sends an email billed to you. To keep a bot from flooding your inbox, give each
visitor a cooldown. The route writes a key for the visitor's IP address in your
[key-value store](/KV/) with an expiry, and while the key exists, it answers
`429` and sends nothing.

Here is the complete worker file with a cooldown of 3 minutes. Change
`COOLDOWN_SECONDS` to fit your app:

```js
const CONTACT_TO = 'you@example.com';
const COOLDOWN_SECONDS = 3 * 60;

function toPrefix48(address) {
    if (!address.includes(':')) return address;   // IPv4

    const [head, tail = ''] = address.split('%')[0].split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];

    const prefix = groups.slice(0, 3).map(group => parseInt(group || '0', 16).toString(16));
    while (prefix.length && prefix[prefix.length - 1] === '0') prefix.pop();

    return `${prefix.join(':')}::/48`;
}

router.post('/contact', async ({ request }) => {
    const { name, email, message } = await request.json();
    if (!name || !email || !message) {
        return new Response('name, email and message are required', { status: 400 });
    }

    const key = `contact:${toPrefix48(request.headers.get('x-real-ip'))}`;
    const expireAt = Math.floor(Date.now() / 1000) + COOLDOWN_SECONDS;
    if (!await me.puter.kv.set(key, true, expireAt, { onlyIfAbsent: true })) {
        return new Response('Please wait a few minutes before sending another message', { status: 429 });
    }

    try {
        await me.puter.email.sendTransactional({
            to: CONTACT_TO,
            replyTo: email,
            subject: `Contact form: ${name}`,
            text: `From: ${name} <${email}>\n\n${message}`,
        });
    } catch {
        await me.puter.kv.del(key);   // the visitor can try again right away
        return new Response('Your message could not be sent, please try again', { status: 502 });
    }

    return { ok: true };
});
```

The `onlyIfAbsent` option makes [`puter.kv.set()`](/KV/set/) write the key only
when it doesn't exist yet, and resolve to `false` when it does. Checking and
starting the cooldown is one call, so two requests sent at the same moment
can't both get through. The third argument is when the key expires, as a Unix
timestamp in seconds. Once it passes, the key is gone and the visitor can send
again.

The `x-real-ip` header carries the visitor's IP address, and it can't be faked
to get around the limit. The `toPrefix48()` helper leaves an IPv4 address as it
is. One IPv6 connection usually comes with a whole block of addresses, so an
IPv6 address is limited by its /48 prefix instead of the single address.

The cooldown starts after the fields are validated, so a form with a missing
field doesn't start it. If the email can't be sent, the key is deleted so the
visitor can try again.
