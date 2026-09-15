// Shapes shared across the `puter.email` operations. JSDoc-only; no runtime exports.

/**
 * One attachment on an outgoing email: either base64 `content`, or a Puter FS
 * reference (`path`/`uid`). How a reference is read depends on the method:
 * `sendTransactional()` streams it server-side with the caller's (falling back
 * to the authorizing worker's) file permissions, so prefer it for anything
 * larger than a few hundred kilobytes; `send()` reads it in the client before
 * composing the message.
 *
 * @typedef {Object} EmailAttachment
 * @property {string} [filename] Required with `content`; defaults to the file's name for FS refs.
 * @property {string} [content] Base64 file body. Mutually exclusive with `path`/`uid`.
 * @property {string} [path] Puter FS path (supports `~/`). Mutually exclusive with `content`.
 * @property {string} [uid] Puter FS entry uid. Mutually exclusive with `content`.
 * @property {string} [contentType] MIME type of the attachment.
 * @property {string} [cid] Content-ID for an inline part, which the `html` body shows with
 * `<img src="cid:...">`. Printable ASCII without whitespace or angle brackets.
 */

/**
 * Which mailbox folder to read. `inbox` holds mail received at the user's
 * address, `sent` the user's own outgoing copies.
 *
 * @typedef {'inbox' | 'sent'} EmailFolder
 */

/**
 * One message as it appears in a listing. Built from the mailbox listing
 * alone, without opening the message, so `subject` is the first 80 characters
 * only and there is no sender: call `puter.email.get()` for the rest.
 *
 * @typedef {Object} EmailSummary
 * @property {string} id Message id (a uuidv7); pass it to `get()`.
 * @property {string} subject Subject, possibly truncated to 80 characters.
 * @property {string} date ISO 8601 timestamp of when the message was filed.
 * @property {number} size Size of the raw message in bytes.
 * @property {EmailFolder} folder The folder the message was listed from.
 * @property {string} path Filesystem path of the raw `message/rfc822` object.
 * @property {string} uid Filesystem uid of the raw object.
 */

/**
 * A parsed mailbox: `{ name, address }`, or a named group of them.
 *
 * @typedef {import('postal-mime').Address} EmailAddress
 */

/**
 * One header of a parsed message.
 *
 * @typedef {import('postal-mime').Header} EmailHeader
 */

/**
 * One attachment of a message returned by `get()`, bytes included.
 *
 * @typedef {Object} EmailMessageAttachment
 * @property {string | null} filename
 * @property {string} mimeType
 * @property {'attachment' | 'inline' | null} disposition
 * @property {string} [contentId] `Content-ID`, without the angle brackets, for inline references.
 * @property {boolean} [related] `true` for parts referenced from the HTML body (inline images).
 * @property {number} size Byte length of `content`.
 * @property {ArrayBuffer} content The decoded attachment bytes.
 */

/**
 * A fully parsed message, as returned by `get()`.
 *
 * @typedef {EmailSummary & {
 *   messageId: string | null,
 *   inReplyTo: string | null,
 *   references: string | null,
 *   from: EmailAddress | null,
 *   to: EmailAddress[],
 *   cc: EmailAddress[],
 *   bcc: EmailAddress[],
 *   replyTo: EmailAddress[],
 *   headers: EmailHeader[],
 *   text: string | null,
 *   html: string | null,
 *   attachments: EmailMessageAttachment[],
 * }} EmailMessage
 */

/**
 * Options for `list()`. Results are newest first. Every call returns one page;
 * pass the page's `cursor` back to fetch the next one.
 *
 * @typedef {Object} EmailListOptions
 * @property {EmailFolder} [folder] Folder to list. Default `'inbox'`.
 * @property {number} [limit] Maximum messages per page. Default 50, capped at 1000.
 * @property {string | null} [cursor] Opaque continuation cursor from a previous page; `null` or absent for the first page.
 */

/**
 * The `stream: true` form of `list()`: an async iterator of pages.
 *
 * @typedef {EmailListOptions & { stream: true }} EmailListStreamOptions
 */

/**
 * The options form of `get()`.
 *
 * @typedef {Object} EmailGetOptions
 * @property {string} id Message id, from a listing.
 * @property {EmailFolder} [folder] Folder the message is in. Default `'inbox'`.
 * @property {boolean} [raw] When `true`, resolve with the raw `message/rfc822` bytes as a `Blob` instead of parsing.
 */

export {};
