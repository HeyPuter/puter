import { iteratePages } from '../../lib/pagination.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import {
    dayPath, decodeCursor, encodeCursor, folderRoot, isDayName, isMissingDirectory,
    normalizeFolder, normalizeLimit, toSummary,
} from './lib/mailbox.js';

/** @typedef {import('./types.js').EmailFolder} EmailFolder */
/** @typedef {import('./types.js').EmailListOptions} EmailListOptions */
/** @typedef {import('./types.js').EmailListStreamOptions} EmailListStreamOptions */
/** @typedef {import('./types.js').EmailSummary} EmailSummary */
/** @typedef {import('../../lib/types.js').ListPage<EmailSummary>} EmailListPage */
/** @typedef {import('./lib/mailbox.js').ListPosition} ListPosition */

// Page size for the SDK's own walks over the mailbox's day folders.
const DIRECTORY_PAGE_LIMIT = 1000;

/**
 * Every day folder in `folder`, newest first. A mailbox that was never
 * written to has no folder at all, which lists as empty.
 *
 * @this {import('./Email.js').EmailModule}
 * @param {EmailFolder} folder
 * @returns {Promise<string[]>}
 */
async function listDays (folder) {
    const fetchPage = pageParams => this.puter.fs.readdir({
        path: folderRoot(folder),
        limit: DIRECTORY_PAGE_LIMIT,
        sortBy: 'name',
        sortOrder: 'desc',
        ...pageParams,
    });
    const days = [];
    try {
        for await ( const page of iteratePages(fetchPage) ) {
            for ( const entry of page.items ) {
                if ( entry.is_dir && isDayName(entry.name) ) days.push(entry.name);
            }
        }
    } catch (e) {
        if ( ! isMissingDirectory(e) ) throw e;
    }
    return days.sort().reverse();
}

/**
 * One page of the listing: walks day folders newest first, reading each
 * newest-message-first, until `limit` messages are collected or the folder
 * runs out.
 *
 * @this {import('./Email.js').EmailModule}
 * @param {EmailFolder} folder
 * @param {number} limit
 * @param {ListPosition | undefined} position
 * @returns {Promise<EmailListPage>}
 */
async function fetchPage (folder, limit, position) {
    const days = await listDays.call(this, folder);
    /** @type {EmailSummary[]} */
    const items = [];

    // Resume at the cursor's day; a day folder deleted since the cursor was
    // issued means continuing from the next older one.
    let dayIndex = position ? days.findIndex(day => day <= position.day) : 0;
    if ( dayIndex === -1 ) return { items };
    let fsCursor = position && days[dayIndex] === position.day ? position.fsCursor : undefined;

    while ( dayIndex < days.length && items.length < limit ) {
        const day = days[dayIndex];
        // Keep reading this day until the page is full or the day is spent:
        // entries that are not mail objects are skipped, and skipping must
        // not shorten the page while the same day still has messages.
        while ( items.length < limit ) {
            /** @type {{ items: Array<Record<string, any>>, cursor?: string }} */
            let page;
            try {
                page = await this.puter.fs.readdir({
                    path: dayPath(folder, day),
                    sortBy: 'name',
                    sortOrder: 'desc',
                    limit: limit - items.length,
                    cursor: fsCursor ?? null,
                });
            } catch (e) {
                if ( ! isMissingDirectory(e) ) throw e;
                page = { items: [] };
            }
            for ( const entry of page.items ) {
                const summary = toSummary(entry, folder);
                if ( summary ) items.push(summary);
            }
            fsCursor = page.cursor;
            if ( ! fsCursor ) break;
        }
        if ( fsCursor ) {
            return { items, cursor: encodeCursor({ folder, day, fsCursor }) };
        }
        dayIndex += 1;
    }

    if ( dayIndex < days.length ) {
        return { items, cursor: encodeCursor({ folder, day: days[dayIndex] }) };
    }
    return { items };
}

/**
 * @overload
 * @param {EmailListStreamOptions} options
 * @returns {AsyncIterableIterator<EmailListPage>}
 */
/**
 * @overload
 * @param {EmailListOptions} [options]
 * @returns {Promise<EmailListPage>}
 */
/**
 * Lists the messages in a mailbox folder, newest first, one page at a time.
 * Resolves with `{ items, cursor? }`: `cursor` is present while more pages
 * exist, and a page may hold fewer than `limit` items before the end. With
 * `stream: true` it instead returns an async iterator of pages for
 * `for await ... of`.
 *
 * Each item is an {@link EmailSummary} built from the mailbox listing alone,
 * so listing never downloads a message. Reading the inbox of an app's user
 * requires the `fs:/{username}/.mail:read` permission.
 *
 * @this {import('./Email.js').EmailModule}
 * @param {EmailListOptions & { stream?: boolean, offset?: unknown, includeTotal?: unknown }} [options]
 * @returns {Promise<EmailListPage> | AsyncIterableIterator<EmailListPage>}
 */
export function list (options = {}) {
    if ( options === null || typeof options !== 'object' || Array.isArray(options) ) {
        throw new PuterJSError('`options` must be an object', 'invalid_request');
    }
    if ( options.offset !== undefined ) {
        throw new PuterJSError('`offset` is not supported; pass `cursor` to resume from a position.', 'invalid_request');
    }
    if ( options.includeTotal !== undefined ) {
        throw new PuterJSError('`includeTotal` is not supported for mailboxes.', 'invalid_request');
    }
    const folder = normalizeFolder(options.folder);
    const limit = normalizeLimit(options.limit);
    const start = decodeCursor(options.cursor, folder);

    if ( options.stream === true ) {
        return iteratePages(
            pageParams => fetchPage.call(this, folder, limit, decodeCursor(pageParams.cursor, folder)),
            { cursor: options.cursor ?? null },
        );
    }
    return fetchPage.call(this, folder, limit, start);
}
