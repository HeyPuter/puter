---
title: puter.email.get()
description: Fetch and parse one message from the user's mailbox by its id.
platforms: [websites, apps, nodejs, workers]
---

Reads one message by the `id` a listing returned. The whole raw message is downloaded and parsed, so the result carries the full subject, sender and recipients, the text and HTML bodies, every header, and each attachment with its bytes. Pass `raw: true` to get the unparsed `message/rfc822` bytes as a `Blob` instead.

## Syntax

```js
puter.email.get(id)
puter.email.get(options)
```

## Parameters

#### `id` (String) (required)

The message id from `puter.email.list()`. Looks up the inbox.

#### `options` (Object)

- `id` (String) (required): The message id.
- `folder` (String): `'inbox'` or `'sent'`. Default `'inbox'`. A message id is unique within a folder, so a sent message must be read with `folder: 'sent'`.
- `raw` (Boolean): When `true`, resolve with the raw message `Blob` and skip parsing. Default `false`.

## Return value

A `Promise` that resolves to the parsed message:

```js
{
    id: '019...',
    folder: 'inbox',
    path: '/alice/.mail/objects/2026-03-15/019...--WW91ciBvcmRlcg',
    uid: 'a1b2c3...',
    size: 48213,
    date: '2026-03-15T12:34:56.000Z',   // the Date header, or the filing time if unparseable
    subject: 'Your order has shipped',
    messageId: '<abc@example.com>',
    inReplyTo: null,
    references: null,
    from: { name: 'Example Shop', address: 'orders@example.com' },
    to: [{ name: 'Alice', address: 'alice@puter.email' }],
    cc: [],
    bcc: [],                            // populated only on sent copies
    replyTo: [],
    headers: [{ key: 'subject', originalKey: 'Subject', value: 'Your order has shipped' }, /* ... */],
    text: 'Hi Alice, ...',
    html: '<p>Hi Alice, ...</p>',       // null when the message has no HTML part
    attachments: [
        {
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            disposition: 'attachment',
            size: 30211,
            content: ArrayBuffer         // the decoded bytes
        }
    ]
}
```

With `raw: true`, the `Promise` resolves to a `Blob` of the message exactly as it was received.

Messages can be up to 25 MiB, and `get()` holds the whole message in memory while parsing. For a message list, use `puter.email.list()` and read messages one at a time as the user opens them.

## Errors

Rejects with an object carrying a `code`:

- `invalid_request`: `id` is missing or not a message id.
- `not_found`: no message with that id in the folder.
- Filesystem errors pass through unchanged, including the permission error an app gets without `fs:/{username}/.mail:read`.

## Examples

<strong class="example-title">Read the newest message in the inbox</strong>

```html;email-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const { items } = await puter.email.list({ limit: 1 });
            if (items.length === 0) return puter.print('Inbox is empty');

            const message = await puter.email.get(items[0].id);
            puter.print(`From: ${message.from?.name} &lt;${message.from?.address}&gt;<br>`);
            puter.print(`Subject: ${message.subject}<br>`);
            puter.print(`<pre>${message.text}</pre>`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Save every attachment of a message to the user's Documents</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const { items } = await puter.email.list({ limit: 1 });
            if (items.length === 0) return puter.print('Inbox is empty');

            const message = await puter.email.get(items[0].id);
            for (const attachment of message.attachments) {
                const name = attachment.filename ?? 'attachment';
                await puter.fs.write(`~/Documents/${name}`, new Blob([attachment.content], { type: attachment.mimeType }));
                puter.print(`Saved ${name} (${attachment.size} bytes)<br>`);
            }
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Download the raw message</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const { items } = await puter.email.list({ folder: 'sent', limit: 1 });
            if (items.length === 0) return puter.print('Nothing sent yet');

            const blob = await puter.email.get({ id: items[0].id, folder: 'sent', raw: true });
            const text = await blob.text();
            puter.print(`<pre>${text.slice(0, 2000)}</pre>`);
        })();
    </script>
</body>
</html>
```
