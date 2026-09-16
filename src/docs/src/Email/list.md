---
title: puter.email.list()
description: List the messages in the user's mailbox, newest first, one page at a time.
platforms: [websites, apps, nodejs, workers]
---

Lists the messages in one folder of the user's mailbox, newest first. Every call returns one page of `items` plus, while more pages exist, a `cursor` to pass back for the next one. Listing reads the mailbox's folder structure only, so it never downloads a message: each item carries the subject, date, and size, and `puter.email.get()` fetches the rest.

The mailbox belongs to the user, so it is protected like the rest of their files. An app reads it only after the user grants `fs:/{username}/.mail:read`, for example with `puter.perms.request('permission', { permission: `fs:/${username}/.mail:read` })`.

## Syntax

```js
puter.email.list()
puter.email.list(options)
```

## Parameters

#### `options` (Object) (optional)

- `folder` (String): `'inbox'` for mail received at the user's address, `'sent'` for their outgoing copies. Default `'inbox'`.
- `limit` (Number): Maximum messages per page. Default `50`, capped at `1000`.
- `cursor` (String | null): The `cursor` from the previous page. `null` or absent fetches the first page.
- `stream` (Boolean): When `true`, returns an async iterator of pages for `for await ... of` instead of a single page.

`offset` and `includeTotal` are not supported for mailboxes; passing either rejects with `invalid_request`.

## Return value

A `Promise` that resolves to an [`EmailListPage`](/Objects/emaillistpage/) object: its `items` are [`EmailSummary`](/Objects/emailsummary/) objects, newest first, and its `cursor` is present only while more pages exist. A page may hold fewer than `limit` items while more pages exist, so iterate until `cursor` is absent rather than checking the page size. A mailbox that has never received mail lists as `{ items: [] }`.

With `stream: true`, the method returns an `AsyncIterableIterator` of [`EmailListPage`](/Objects/emaillistpage/) objects instead.

## Errors

Rejects with an object carrying a `code`:

- `invalid_request`: an unknown `folder`, a non-positive `limit`, a malformed cursor or one from a different folder, or `offset`/`includeTotal`.
- Filesystem errors pass through unchanged. In particular, an app that has not been granted `fs:/{username}/.mail:read` gets the permission error the filesystem returns.

## Examples

<strong class="example-title">List the ten newest messages</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const page = await puter.email.list({ limit: 10 });
            for (const message of page.items) {
                puter.print(`${message.date}  ${message.subject}<br>`);
            }
            if (page.cursor) puter.print('More messages available.');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Walk the whole sent folder with a cursor</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            let cursor = null;
            let count = 0;
            do {
                const page = await puter.email.list({ folder: 'sent', limit: 100, cursor });
                count += page.items.length;
                cursor = page.cursor;
            } while (cursor);
            puter.print(`${count} sent messages`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Stream pages</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            for await (const page of puter.email.list({ stream: true, limit: 25 })) {
                for (const message of page.items) {
                    puter.print(`${message.subject}<br>`);
                }
            }
        })();
    </script>
</body>
</html>
```
