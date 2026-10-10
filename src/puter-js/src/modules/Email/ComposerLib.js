// ComposerLib is a small library for minimally composing spec compliant RFC822 EML files from certain user given parameters
// Multipart email files are handled as String'd FormData to save on Multipart parsing logic. The primary goal of this library
// is not necessarily high performance but high maintanability.

import { PuterJSError } from '../../lib/PuterJSError.js';

/** Every refusal here is the caller's input; the SDK error contract wants a code. */
const invalid = (message) => new PuterJSError(message, 'invalid_request');

/**
 * One attachment: either inline base64 `content`, or a Puter FS reference
 * (`path`/`uid`) read server-side with the caller's file permissions; a `uid`
 * falls back to the authorizing worker's. FS references are streamed from
 * storage and never travel through the request, so prefer them for anything
 * larger than a few hundred kilobytes.
 *
 * @typedef {Object} EmailAttachment
 * @property {string} [filename] Required with `content`; defaults to the file's name for FS refs.
 * @property {string} [content] Base64 file body. Mutually exclusive with `path`/`uid`.
 * @property {string} [path] Puter FS path (supports `~/`, the caller's home). Mutually exclusive with `content`.
 * @property {string} [uid] Puter FS entry uid; the only way to attach a file of the worker owner's. Mutually exclusive with `content`.
 * @property {string|undefined} [cid] Email content ID for inline images
 * @property {string} [contentType] MIME type of the attachment.
 */

/**
 * Arguments given to compose to compose an rfc822 eml object
 *
 * @typedef {Object} EmailComposeOptions
 * @property {string | string[]} to Recipient address(es).
 * @property {string} subject
 * @property {string} [text] Plain-text body. At least one of `text` / `html` is required.
 * @property {string} [html] HTML body.
 * @property {string | string[]} [cc]
 * @property {string | string[]} [bcc]
 * @property {string} [replyTo]
 * @property {EmailAttachment[]} [attachments]
 */


export function getRFC822DateUTC(date = new Date()) {
    // .toUTCString() returns: "Fri, 11 Sep 2026 21:30:00 GMT"
    return date.toUTCString().replace('GMT', '+0000');
}

export function emlHeader(key, value) {
    if (!isASCII(key)) {
        throw invalid("eml header key " + key + " is not valid ASCII");
    }

    if (Array.isArray(value)) {
        value.forEach((val) => {
            if (!isASCII(val)) {
                throw invalid("eml header value " + val + " is not valid ASCII");
            }
        })

        return `${key}: ${value.join(', ')}\r\n`;
    } else {
        if (!isASCII(value)) {
            throw invalid("eml header value " + value + " is not valid ASCII");
        }
        return `${key}: ${value}\r\n`;
    }
}

// UTF-8 bytes per encoded word: 45 bytes is 60 base64 characters, which with
// the `=?UTF-8?B?` and `?=` wrapping stays inside RFC 2047's 75.
const ENCODED_WORD_BYTES = 45;

const bytesToBase64 = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

/**
 * Header text as RFC 2047 encoded words: printable ASCII comes back as is,
 * anything else as `=?UTF-8?B?...?=` words split on character boundaries and
 * folded onto continuation lines. Control characters are refused either way:
 * they have no business in a header, encoded or not.
 *
 * @param {string} text
 * @returns {string}
 */
export function encodeWord(text) {
    if (typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) {
        throw invalid("eml header value " + text + " is not valid");
    }
    if (isASCII(text)) return text;

    const encoder = new TextEncoder();
    const words = [];
    let pending = [];
    for (const char of text) {
        const bytes = encoder.encode(char);
        if (pending.length + bytes.length > ENCODED_WORD_BYTES) {
            words.push(pending);
            pending = [];
        }
        pending.push(...bytes);
    }
    if (pending.length > 0) words.push(pending);
    return words.map(word => `=?UTF-8?B?${bytesToBase64(word)}?=`).join('\r\n ');
}

/**
 * One address-list entry, its display name encoded when it needs to be. The
 * address itself has to stay ASCII: mail without SMTPUTF8 has no encoding
 * for it.
 *
 * @param {string} entry `addr@host` or `Name <addr@host>`
 * @returns {string}
 */
function encodeAddress(entry) {
    if (isASCII(entry)) return entry;
    const match = /^\s*(.*?)\s*<([^<>]*)>\s*$/.exec(String(entry));
    if (!match || !isASCII(match[2])) {
        throw invalid("eml address " + entry + " is not valid ASCII");
    }
    const name = match[1].replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1');
    return `${encodeWord(name)} <${match[2]}>`;
}

/** A free-text header (Subject), RFC 2047 encoded when not plain ASCII. */
export function textHeader(key, value) {
    if (!isASCII(key)) {
        throw invalid("eml header key " + key + " is not valid ASCII");
    }
    return `${key}: ${encodeWord(value)}\r\n`;
}

/**
 * An address-list header (To, Cc, Bcc, Reply-To, From) with non-ASCII display
 * names encoded. A string is one entry, or an ASCII list passed through as is.
 */
export function addressHeader(key, value) {
    if (!isASCII(key)) {
        throw invalid("eml header key " + key + " is not valid ASCII");
    }
    const entries = Array.isArray(value) ? value : [value];
    return `${key}: ${entries.map(encodeAddress).join(', ')}\r\n`;
}

export function determineTopLevelMimeType({ attachments = [], text, html }) {
    const inlineAttachments = attachments.filter(a => a.cid);
    const regularAttachments = attachments.filter(a => !a.cid);

    if (regularAttachments.length > 0) {
        return { isMultiPart: true, mimeType: 'multipart/mixed' };
    }
    if (inlineAttachments.length > 0) {
        return { isMultiPart: true, mimeType: 'multipart/related' };
    }
    if (text && html) {
        return { isMultiPart: true, mimeType: 'multipart/alternative' };
    }
    if (text) {
        return { isMultiPart: false, mimeType: 'text/plain; charset=UTF-8' };
    }
    if (html) {
        return { isMultiPart: false, mimeType: 'text/html; charset=UTF-8' };
    }
    throw invalid('Email must have text, html, or an attachment');
}


async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Use a chunked approach or reduction to prevent call stack overflow on massive files
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}
export const isASCII = (str) => /^[\x20-\x7E]*$/.test(str);



/**
 * Composes a multipart email attachment
 *
 * @param {EmailAttachment} attachment
 * @param {import('../../index.js').Puter} [puter] Reads `path` attachments; the module's own instance.
 */
export async function composeAttachment({ cid, content, contentType, filename, path, uid }, puter = globalThis.puter) {
    if (path && content) {
        throw invalid("Path and Content are mutually exclusive");
    }
    if (!path && !content && !uid) {
        throw invalid("Attachment requires content, path, or uid");
    }
    if (uid) {
        throw invalid("uid attachments are not supported yet");
    }
    if (contentType && !filename) {
        throw invalid("filename parameter required for contentType");
    }

    let b64emailContent = content;
    let mimeType;
    if (path) {
        const blob = await puter.fs.read(path);
        if (!filename) {
            filename = path.split('/').pop();
        }
        b64emailContent = await blobToBase64(blob);
        mimeType = blob.type;
    }

    if (!filename) {
        throw invalid("Attachment's filename cannot be determined automatically. Please provide filename!");
    }
    filename = filename.replaceAll('\\', '\\\\');
    filename = filename.replaceAll('"', '\\"');
    if (!isASCII(filename)) {
        throw invalid("filename must be ascii");
    }

    if (contentType) {
        mimeType = contentType;
    }

    if (!mimeType) {
        throw invalid("Attachment's mimetype cannot be determined automatically. Please provide contentType!");
    }

    mimeType += ';name="' + filename + '"';

    let headerLines = '';
    headerLines += emlHeader('Content-Type', mimeType);
    headerLines += emlHeader('Content-Transfer-Encoding', 'base64');
    if (cid) {
        headerLines += emlHeader('Content-ID', `<${cid}>`);
        headerLines += emlHeader('Content-Disposition', 'inline;filename="' + filename + '"');
    } else {
        headerLines += emlHeader('Content-Disposition', 'attachment;filename="' + filename + '"');
    }
    headerLines += '\r\n';

    return headerLines + b64emailContent;
}

export function combineParts(parts, boundary) {
    // The CRLF before each delimiter belongs to the delimiter, not the part,
    // so parts never need a trailing line break of their own.
    return parts.map(part => `--${boundary}\r\n${part}\r\n`).join('') + `--${boundary}--\r\n`;
}

/**
 *
 * @param {EmailComposeOptions} param0
 * @param {import('../../index.js').Puter} [puter] The module's own instance: who the mail is from, and
 * whose storage `path` attachments are read from.
 */
export async function compose({ from, to, cc, bcc, subject, replyTo, attachments = [], text, html }, puter = globalThis.puter) {
    // --- Header constructing logic ---
    let headerLines = "MIME-Version: 1.0\r\n";

    headerLines += emlHeader('Date', getRFC822DateUTC());

    if (subject) {
        headerLines += textHeader('Subject', subject);
    }
    if (to) {
        headerLines += addressHeader('To', to);
    } else {
        throw invalid("Cannot compose email without recipient!");
    }
    if (cc) {
        headerLines += addressHeader('cc', cc);
    }
    if (bcc) {
        headerLines += addressHeader('bcc', bcc);
    }
    if (replyTo) {
        headerLines += addressHeader('Reply-To', replyTo);
    }
    if (from) {
        headerLines += addressHeader('From', from);
    } else {
        // Add From Block (hardcoded to puter.email for now)
        const userinfo = await puter.getUser();
        headerLines += emlHeader('From', userinfo.username + '@puter.email');
    }

    const { isMultiPart, mimeType } = determineTopLevelMimeType({ attachments, text, html });
    const boundary1 = crypto.randomUUID();
    if (isMultiPart) {
        headerLines += emlHeader('Content-Type', `${mimeType}; boundary="${boundary1}"`);
    } else {
        headerLines += emlHeader('Content-Type', `${mimeType}`);
    }

    headerLines += '\r\n';

    // --- Body Constructing Logic ---
    // No attachments, not multipart, easy return
    if (!isMultiPart) {
        return headerLines + (text || html);
    }

    const textLeaf =  emlHeader('Content-Type', 'text/plain; charset=UTF-8') + '\r\n' + text;
    const htmlLeaf = emlHeader('Content-Type', 'text/html; charset=UTF-8') + '\r\n' + html;

    // No attachments at all -> top level IS multipart/alternative; text/html sit directly under boundary1.
    if (attachments.length === 0) {
        return headerLines + combineParts([textLeaf, htmlLeaf], boundary1);
    }

    const inlineAttachments = attachments.filter(a => a.cid);
    const regularAttachments = attachments.filter(a => !a.cid);

    const inlineParts = await Promise.all(inlineAttachments.map(a => composeAttachment(a, puter)));
    const regularParts = await Promise.all(regularAttachments.map(a => composeAttachment(a, puter)));

    // Build the text/html content as one part. Only wrap it in its own nested
    // multipart/alternative (fresh boundary) when both text and html are present.
    let contentPart = null;
    if (text && html) {
        const altBoundary = crypto.randomUUID();
        contentPart = emlHeader('Content-Type', `multipart/alternative; boundary="${altBoundary}"`) + "\r\n";
        contentPart += combineParts([textLeaf, htmlLeaf], altBoundary);
    } else if (text) {
        contentPart = textLeaf;
    } else if (html) {
        contentPart = htmlLeaf;
    }

    // Inline (cid) attachments: wrap content + inline images in multipart/related.
    // If there are no regular attachments, related IS the top level (reuse boundary1).
    // Otherwise it nests one level inside multipart/mixed with its own boundary.
    let nextLevelPart;
    if (inlineAttachments.length > 0) {
        const relatedChildren = [contentPart, ...inlineParts].filter(Boolean);
        if (regularAttachments.length === 0) {
            return headerLines + combineParts(relatedChildren, boundary1);
        }
        const relatedBoundary = crypto.randomUUID();
        nextLevelPart = emlHeader('Content-Type', `multipart/related; boundary="${relatedBoundary}"`) + '\r\n';
        nextLevelPart += combineParts(relatedChildren, relatedBoundary);
    } else {
        nextLevelPart = contentPart;
    }

    // Regular attachments: top level is multipart/mixed, containing nextLevelPart + each attachment.
    const mixedChildren = [nextLevelPart, ...regularParts].filter(Boolean);
    return headerLines + combineParts(mixedChildren, boundary1);
}