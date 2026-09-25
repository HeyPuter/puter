import PostalMime from 'postal-mime';
import { iteratePages } from '../../lib/pagination.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import {
    candidateDays, dayPath, isMissingDirectory, isUuidV7, normalizeFolder, toSummary,
} from './lib/mailbox.js';

/** @typedef {import('./types.js').EmailFolder} EmailFolder */
/** @typedef {import('./types.js').EmailGetOptions} EmailGetOptions */
/** @typedef {import('./types.js').EmailMessage} EmailMessage */
/** @typedef {import('./types.js').EmailMessageAttachment} EmailMessageAttachment */
/** @typedef {import('./types.js').EmailSummary} EmailSummary */

const DIRECTORY_PAGE_LIMIT = 1000;

/**
 * The listing entry for `id`, or null. The id names the day it was filed
 * under, so this is one listing of one day folder in the common case.
 *
 * @this {import('./Email.js').EmailModule}
 * @param {EmailFolder} folder
 * @param {string} id
 * @returns {Promise<EmailSummary | null>}
 */
async function locate (folder, id) {
    const prefix = `${ id }--`;
    for ( const day of candidateDays(id) ) {
        const fetchPage = pageParams => this.puter.fs.readdir({
            path: dayPath(folder, day),
            limit: DIRECTORY_PAGE_LIMIT,
            ...pageParams,
        });
        try {
            for await ( const page of iteratePages(fetchPage) ) {
                const entry = page.items.find(item => item.name.toLowerCase().startsWith(prefix));
                if ( entry ) return toSummary(entry, folder);
            }
        } catch (e) {
            if ( ! isMissingDirectory(e) ) throw e;
        }
    }
    return null;
}

/** @param {import('postal-mime').Attachment} part @returns {EmailMessageAttachment} */
const toAttachment = (part) => {
    let content;
    if ( part.content instanceof ArrayBuffer ) {
        content = part.content;
    } else if ( typeof part.content === 'string' ) {
        content = new TextEncoder().encode(part.content).buffer;
    } else {
        content = part.content.buffer.slice(part.content.byteOffset, part.content.byteOffset + part.content.byteLength);
    }
    return {
        filename: part.filename,
        mimeType: part.mimeType,
        disposition: part.disposition,
        ...(part.contentId !== undefined ? { contentId: part.contentId } : {}),
        ...(part.related !== undefined ? { related: part.related } : {}),
        size: content.byteLength,
        content: /** @type {ArrayBuffer} */ (content),
    };
};

/**
 * @param {EmailSummary} summary
 * @param {import('postal-mime').Email} parsed
 * @returns {EmailMessage}
 */
const toMessage = (summary, parsed) => {
    const headerDate = parsed.date ? new Date(parsed.date) : null;
    return {
        ...summary,
        subject: parsed.subject ?? summary.subject,
        date: headerDate && ! Number.isNaN(headerDate.getTime()) ? headerDate.toISOString() : summary.date,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: parsed.references ?? null,
        from: parsed.from ?? null,
        to: parsed.to ?? [],
        cc: parsed.cc ?? [],
        bcc: parsed.bcc ?? [],
        replyTo: parsed.replyTo ?? [],
        headers: parsed.headers,
        text: parsed.text ?? null,
        html: parsed.html ?? null,
        attachments: parsed.attachments.map(toAttachment),
    };
};

/**
 * @overload
 * @param {string} id
 * @returns {Promise<EmailMessage>}
 */
/**
 * @overload
 * @param {EmailGetOptions & { raw: true }} options
 * @returns {Promise<Blob>}
 */
/**
 * @overload
 * @param {EmailGetOptions & { raw?: false }} options
 * @returns {Promise<EmailMessage>}
 */
/**
 * Reads one message by id. Downloads the whole raw message (up to 25 MiB)
 * and parses it, resolving with an {@link EmailMessage} whose attachments
 * carry their bytes. With `raw: true` it resolves with the unparsed
 * `message/rfc822` `Blob` instead.
 *
 * Rejects with `not_found` when no message with that id is in the folder
 * (`inbox` unless `folder` says otherwise).
 *
 * @this {import('./Email.js').EmailModule}
 * @param {string | EmailGetOptions} idOrOptions
 * @returns {Promise<EmailMessage | Blob>}
 */
export async function get (idOrOptions) {
    const options = typeof idOrOptions === 'string' ? { id: idOrOptions } : idOrOptions;
    if ( options === null || typeof options !== 'object' ) {
        throw new PuterJSError('`id` is required', 'invalid_request');
    }
    if ( ! isUuidV7(options.id) ) {
        throw new PuterJSError('`id` must be a message id from a listing', 'invalid_request');
    }
    const id = options.id.toLowerCase();
    const folder = normalizeFolder(options.folder);

    const summary = await locate.call(this, folder, id);
    if ( ! summary ) {
        throw new PuterJSError('No such message', 'not_found');
    }

    const blob = await this.puter.fs.read(summary.path);
    if ( options.raw === true ) return blob;

    const parsed = await PostalMime.parse(blob);
    return toMessage(summary, parsed);
}
