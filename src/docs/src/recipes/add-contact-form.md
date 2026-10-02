---
title: Add a Contact Form
description: "Learn how to add a contact form to your app or website with Puter.js, so every message a visitor sends lands in your email inbox."
tags: [workers, email]
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
you. `replyTo` is set to the visitor's address, so pressing reply in your inbox
writes back to them.

The email is sent with `me.puter`, which is your own Puter account as the
worker's owner. Sends are billed to you, and
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
sends an email billed to you. To keep a bot from flooding your inbox, add a
rate limit. Record the visitor's IP address in [`puter.kv`](/KV/) with an
expiry time, and while the key exists, the route answers `429` and sends
nothing.

Here is the complete worker file with a rate limit of one message every 3
minutes. Change `COOLDOWN_SECONDS` to fit your app:

```js
const CONTACT_TO = 'you@example.com';
const COOLDOWN_SECONDS = 3 * 60;

function toPrefix48(addr) {
  if (!addr.includes(':')) return addr; // IPv4: leave unchanged

  const [head, tail = ''] = addr.split('%')[0].split('::'); // drop zone ID
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];

  const parts = full.slice(0, 3).map(h => parseInt(h || '0', 16).toString(16));
  while (parts.length && parts[parts.length - 1] === '0') parts.pop();

  return `${parts.join(':')}::/48`;
}

async function isRateLimited (request) {
    const key = `contact:${toPrefix48(request.headers.get('x-real-ip'))}`;

    if ( await me.puter.kv.get(key) ) {
        return true;
    }

    const expireAt = Math.floor(Date.now() / 1000) + COOLDOWN_SECONDS;
    await me.puter.kv.set(key, true, expireAt);
    return false;
}

router.post('/contact', async ({ request }) => {
    const { name, email, message } = await request.json();
    if (!name || !email || !message) {
        return new Response('name, email and message are required', { status: 400 });
    }

    if ( await isRateLimited(request) ) {
        return new Response('Please wait a few minutes before sending another message', { status: 429 });
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

The `x-real-ip` header carries the visitor's IP address, and it cannot be faked to get around
the limit. The `toPrefix48()` helper handles both IPv4 and IPv6. An IPv4 address is used
as is. One IPv6 connection usually comes with a whole block of addresses, so an
IPv6 address is rate limited by its /48 prefix instead of the single address. The [`puter.kv.set()`](/KV/set/) method takes the expiry as a Unix
timestamp in seconds, and once it passes, the key is removed and the visitor
can send again.

The limit is checked after the fields are validated, so a form with a missing
field does not start the cooldown.
