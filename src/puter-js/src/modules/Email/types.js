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

export {};
