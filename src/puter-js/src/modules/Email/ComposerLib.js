// ComposerLib is a small library for minimally composing spec compliant RFC822 EML files from certain user given parameters
// Multipart email files are handled as String'd FormData to save on Multipart parsing logic. The primary goal of this library
// is not necessarily high performance but high maintanability.

/**
 * One attachment: either inline base64 `content`, or a Puter FS reference
 * (`path`/`uid`) read server-side with the caller's — falling back to the
 * authorizing worker's — file permissions. FS references are streamed from
 * storage and never travel through the request, so prefer them for anything
 * larger than a few hundred kilobytes.
 *
 * @typedef {Object} EmailAttachment
 * @property {string} [filename] Required with `content`; defaults to the file's name for FS refs.
 * @property {string} [content] Base64 file body. Mutually exclusive with `path`/`uid`.
 * @property {string} [path] Puter FS path (supports `~/`). Mutually exclusive with `content`.
 * @property {string} [uid] Puter FS entry uid. Mutually exclusive with `content`.
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
        throw new Error("eml header key " + key + " is not valid ASCII");
    }

    if (Array.isArray(value)) {
        value.forEach((val) => {
            if (!isASCII(val)) {
                throw new Error("eml header value " + val + " is not valid ASCII");
            }
        })

        return `${key}: ${value.join(', ')}\r\n`;
    } else {
        if (!isASCII(value)) {
            throw new Error("eml header value " + value + " is not valid ASCII");
        }
        return `${key}: ${value}\r\n`;
    }
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
    throw new Error('Email must have text, html, or an attachment');
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
 */
export async function composeAttachment({ cid, content, contentType, filename, path, uid }) {
    if (path && content) {
        throw new Error("Path and Content are mutually exclusive");
    }
    if (!path && !content && !uid) {
        throw new Error("Attachment requires content, path, or uid");
    }
    if (uid) {
        throw new Error("uid attachments are not supported yet");
    }
    if (contentType && !filename) {
        throw new Error("filename parameter required for contentType");
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
        throw new Error("Attachment's filename cannot be determined automatically. Please provide filename!");
    }
    filename = filename.replaceAll('\\', '\\\\');
    filename = filename.replaceAll('"', '\\"');
    if (!isASCII(filename)) {
        throw new Error("filename must be ascii");
    }

    if (contentType) {
        mimeType = contentType;
    }

    if (!mimeType) {
        throw new Error("Attachment's mimetype cannot be determined automatically. Please provide contentType!");
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
 */
export async function compose({ from, to, cc, bcc, subject, replyTo, attachments = [], text, html }) {
    // --- Header constructing logic ---
    let headerLines = "MIME-Version: 1.0\r\n";

    headerLines += emlHeader('Date', getRFC822DateUTC());

    if (subject) {
        headerLines += emlHeader('Subject', subject);
    }
    if (to) {
        headerLines += emlHeader('To', to);
    } else {
        throw new Error("Cannot compose email without recipient!");
    }
    if (cc) {
        headerLines += emlHeader('cc', cc);
    }
    if (bcc) {
        headerLines += emlHeader('bcc', bcc);
    }
    if (replyTo) {
        headerLines += emlHeader('Reply-To', replyTo);
    }
    if (from) {
        headerLines += emlHeader('From', from);
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

    const inlineParts = await Promise.all(inlineAttachments.map(composeAttachment));
    const regularParts = await Promise.all(regularAttachments.map(composeAttachment));

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