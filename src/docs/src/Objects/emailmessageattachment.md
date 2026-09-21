---
title: EmailMessageAttachment
description: One attachment of a message returned by puter.email.get(), bytes included.
---

An `EmailMessageAttachment` object is one attachment of an [`EmailMessage`](/Objects/emailmessage/). The whole message is downloaded when it is read, so every attachment comes with its decoded bytes.

## Attributes

#### `filename` (String | null)

The attachment's file name, or `null` when the message did not give one.

#### `mimeType` (String)

The attachment's MIME type, for example `application/pdf`.

#### `disposition` (String | null)

`'attachment'`, `'inline'`, or `null` when the message did not say.

#### `contentId` (String) (optional)

The `Content-ID`, without angle brackets. Inline images are referenced from the HTML body as `cid:` URLs with this value.

#### `related` (Boolean) (optional)

`true` for parts referenced from the HTML body, such as inline images.

#### `size` (Number)

The byte length of `content`.

#### `content` (ArrayBuffer)

The decoded attachment bytes. Wrap them in a `Blob` to save or display them:

```js
new Blob([attachment.content], { type: attachment.mimeType })
```
