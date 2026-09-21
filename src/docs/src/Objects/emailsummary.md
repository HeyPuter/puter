---
title: EmailSummary
description: One message as it appears in a mailbox listing from puter.email.list().
---

An `EmailSummary` object represents one message in a page returned by [`puter.email.list()`](/Email/list/). It is built from the mailbox listing alone, without opening the message, so it carries what the listing knows: the id, a subject, the filing time, and the size. Pass its `id` to [`puter.email.get()`](/Email/get/) for the full [`EmailMessage`](/Objects/emailmessage/).

## Attributes

#### `id` (String)

The message id. Unique within a folder; pass it to `puter.email.get()`.

#### `subject` (String)

The subject line, possibly truncated to 80 characters. The full subject is on the [`EmailMessage`](/Objects/emailmessage/).

#### `date` (String)

An ISO 8601 timestamp of when the message was filed in the mailbox.

#### `size` (Number)

The size of the raw message in bytes.

#### `folder` (String)

The folder the message was listed from: `'inbox'` or `'sent'`.

#### `path` (String)

The path of the raw `message/rfc822` object in the user's cloud drive. It works with the file system API directly, for example `puter.fs.read(path)` or `puter.fs.delete(path)`.

#### `uid` (String)

The file system uid of the raw object.
