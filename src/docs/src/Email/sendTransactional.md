---
title: puter.email.sendTransactional()
description: Send a transactional email from your app — authorized by a worker, sent from a Puter-controlled address, with attachments and inline images.
platforms: [websites, apps, nodejs, workers]
---

Sends one transactional email from your app. Every send must be authorized by a worker: call it from inside a worker, or pass the worker's token as `emailAccessToken`. The account that makes the call is the one billed and rate-limited.

<div class="info">Transactional email is available to accounts on a paid plan for now. A call from a free account fails with <code>402</code> <code>subscription_required</code>. Under the <a href="/user-pays-model/">User-Pays Model</a> that is the plan of the <em>calling</em> account — your users when your app sends with their session, your own when the worker sends directly.</div>

## Syntax

```js
puter.email.sendTransactional(to, subject, body)
puter.email.sendTransactional(options)
```

## Parameters

#### `to` (String | Array) (required)

One recipient address, or an array of them.

#### `subject` (String) (required)

A single line of up to **998** characters.

#### `body` (String) (required in the positional form)

A plain-text body. Shorthand for `text`; use the options form for anything else.

#### `options` (Object)

- `to` (String | Array) (required) - Recipient address(es).
- `subject` (String) (required) - As above.
- `text` (String) - Plain-text body. At least one of `text` and `html` is required.
- `html` (String) - HTML body. An inline image is shown with `<img src="cid:...">` — see `cid` under `attachments`.
- `cc` (String | Array) - Carbon-copy recipient(s).
- `bcc` (String | Array) - Blind-copy recipient(s). At most **10** recipients across `to`, `cc` and `bcc`.
- `replyTo` (String) - Where replies go. Defaults to the confirmed account email of the app's owner (the worker's owner when the worker runs under no app). While that address is unconfirmed, the message goes out without a Reply-To and replies bounce.
- `emailAccessToken` (String) - A worker's auth token — inside a worker, `me.puter.authToken`. Required when the caller is not itself a worker. The caller stays the billed and rate-limited identity.
- `attachments` (Array) - Up to **10** attachments, **25 MB** in total. Each is an object:
  - `filename` (String) - Required with `content`; defaults to the file's name for a `path`/`uid` attachment.
  - `content` (String) - The file body as base64. Mutually exclusive with `path`/`uid`.
  - `path` (String) - A Puter path (`~/` allowed). The file is read on the server with the caller's file permissions, falling back to the worker owner's, and streamed rather than uploaded — prefer this over `content` for anything larger than a few hundred kilobytes.
  - `uid` (String) - A Puter file uid, as an alternative to `path`.
  - `contentType` (String) - MIME type. Detected from the file for `path`/`uid` attachments.
  - `cid` (String) - Content-ID that makes the attachment an inline part of the `html` body: with `cid: 'logo'`, `<img src="cid:logo">` shows it. Printable ASCII with no whitespace or angle brackets. Inline parts are billed like any other attachment.

## Return value

A `Promise` that resolves to an object:

- `messageId` (String | null) - The `Message-ID` of the first delivery: the transport's for a relayed copy, the stored message's for a Puter mailbox.
- `cost` (Number) - What the send was charged, in microcents.
- `suppressed` (Array) - Recipients (lowercased) dropped because they unsubscribed from your app's mail. The message went to the others.
- `failed` (Array) - Recipients (lowercased) whose delivery failed. Everyone else got their copy — retry with just these addresses.

Each recipient gets a private copy of the message, so the unsubscribe link in one copy can only act for the mailbox that received it. Per-recipient failures come back in `failed` rather than failing the call; the promise rejects only when no recipient could be delivered, or when every `to` recipient has unsubscribed (`400`).

In case of an error, the `Promise` rejects with `{ message, code }`. Codes you may see:

- `unauthorized` (401) - No signed-in account.
- `forbidden` (403) - The caller is not a worker and no valid worker token was passed as `emailAccessToken`; or a listener refused the send.
- `subscription_required` (402) - The calling account is not on a paid plan.
- `insufficient_funds` (402) - The calling account has no usage credit left for this send.
- `bad_request` (400) - Invalid arguments: a bad address, a missing body, too many recipients, an invalid attachment.
- `not_found` (404) - Every recipient was a Puter address with no mailbox to receive in.
- `too_many_requests` (429) - Over the rate limit; see [Rate Limits and Quotas](/rate-limits-and-quotas/#email).

## Recipients on Puter

A recipient at a Puter address, `<username>@puter.email`, is a Puter user, and their copy is not relayed: it is filed straight into their Puter mailbox, the `~/.mail` folder in their own cloud drive, whatever plan they are on. Only an account that has set its mailbox up can receive this way. A Puter address that belongs to no account, or to one that has never opened its mailbox, comes back in `failed` like any other undeliverable recipient. The copy carries the same From address, footer and opt-out links as a relayed one.

## From address and replies

Mail goes out from a Puter-controlled address minted for your app — `<app-name>-no-reply@apps.puter.email`, labelled with your app's title — so you never configure a sending domain, and a recipient's filters can tell your app's mail from every other app's. You cannot set `from`: the address is what proves the mail came through Puter, and the app is where the name and identity come from.

Recipients who hit reply reach `replyTo`. Left unset, that is the confirmed account email of the app's owner. Set it explicitly to route replies to a shared inbox instead.

## Recipient protections

Every message carries an unsubscribe link and a report-abuse link. Opting out is per app: a recipient who unsubscribes from your app stops getting your app's mail and still hears from other apps. Opted-out recipients are dropped from your later sends and reported back in `suppressed`, so your app can stop asking them.

## Limits and cost

Sends are rate-limited per calling account; the numbers are on [Rate Limits and Quotas](/rate-limits-and-quotas/#email). A send costs a flat charge per message plus a per-byte charge for attachments, and is charged to the calling account. A send that reaches nobody is not charged.

## Examples

<strong class="example-title">Send a plain-text notification from a worker</strong>

```js
// The worker is the caller, so its owner is billed and rate-limited.
router.post('/api/alert', async ({ request }) => {
    const { to, message } = await request.json();
    return await me.puter.email.sendTransactional(
        to,
        'Something needs your attention',
        message,
    );
});
```

<strong class="example-title">Let the user pay for their own sends</strong>

```js
// The user's session makes the call; the worker's token authorizes it.
router.post('/api/receipt', async ({ request, user }) => {
    const { to, orderId } = await request.json();
    const result = await user.puter.email.sendTransactional({
        to,
        subject: `Your receipt for order ${orderId}`,
        html: `<p>Thanks for your order <b>${orderId}</b>.</p>`,
        text: `Thanks for your order ${orderId}.`,
        replyTo: 'support@example.com',
        emailAccessToken: me.puter.authToken,
    });
    return { sent: true, suppressed: result.suppressed, failed: result.failed };
});
```

<strong class="example-title">Attach a file and show an inline image</strong>

```js
router.post('/api/invoice', async ({ request, user }) => {
    const { to } = await request.json();
    return await user.puter.email.sendTransactional({
        to,
        subject: 'Your invoice',
        html: '<img src="cid:logo" alt="Acme"><p>Your invoice is attached.</p>',
        attachments: [
            // Streamed from the worker owner's storage; shown inline via the cid.
            { path: '~/Public/logo.png', cid: 'logo' },
            // Streamed from the user's own storage as a regular attachment.
            { path: '~/Documents/invoice.pdf' },
        ],
        emailAccessToken: me.puter.authToken,
    });
});
```
