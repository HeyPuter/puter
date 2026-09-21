---
title: EmailMessage
description: A fully parsed message from the user's mailbox, returned by puter.email.get().
---

An `EmailMessage` object is a message from the user's mailbox, downloaded and parsed by [`puter.email.get()`](/Email/get/). It has every attribute of an [`EmailSummary`](/Objects/emailsummary/) plus the parsed contents below.

## Attributes

#### `id` (String)

The message id.

#### `folder` (String)

The folder the message was read from: `'inbox'` or `'sent'`.

#### `path` (String)

The path of the raw `message/rfc822` object in the user's cloud drive.

#### `uid` (String)

The file system uid of the raw object.

#### `size` (Number)

The size of the raw message in bytes.

#### `date` (String)

An ISO 8601 timestamp taken from the message's `Date` header, or the filing time when the header is missing or unparseable.

#### `subject` (String)

The full subject line.

#### `messageId` (String | null)

The `Message-ID` header, angle brackets included, or `null`.

#### `inReplyTo` (String | null)

The `In-Reply-To` header, or `null`.

#### `references` (String | null)

The `References` header, or `null`.

#### `from` (Object | null)

The sender, as `{ name, address }`, or `null` when the message has no `From` header.

#### `to` (Array)

The `To` recipients, each `{ name, address }`. An address group appears as `{ name, group: [...] }`.

#### `cc` (Array)

The `Cc` recipients, in the same shape as `to`.

#### `bcc` (Array)

The `Bcc` recipients, in the same shape as `to`. Only a message in the `sent` folder carries them.

#### `replyTo` (Array)

The `Reply-To` addresses, in the same shape as `to`.

#### `headers` (Array)

Every header of the message, each `{ key, originalKey, value }` where `key` is the lowercase name and `originalKey` preserves the original case.

#### `text` (String | null)

The plain-text body, or `null` when the message has none.

#### `html` (String | null)

The HTML body, or `null` when the message has none.

#### `attachments` (Array)

The message's attachments, each an [`EmailMessageAttachment`](/Objects/emailmessageattachment/) with its decoded bytes.
