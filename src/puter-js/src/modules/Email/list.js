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

// Day folders read per directory page. Small on purpose: a listing resumes
// from the page its cursor's day came from, so this bounds what every later
// page re-reads before reaching its own day. About a month of a mailbox that
// gets mail daily.
const DAY_PAGE_LIMIT = 30;

/**
 * The day folders in `folder`, newest first, read a directory page at a time
 * starting at `daysCursor`. Each day comes with the cursor of the page it was
 * read from, which is where a later listing can pick the walk back up. A
 * mailbox that was never written to has no folder at all, which walks as
 * empty.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {EmailFolder} folder
 * @param {string | undefined} daysCursor
 * @returns {AsyncGenerator<{ day: string, daysCursor?: string }>}
 */
async function* walkDays (puter, folder, daysCursor) {
    let cursor = daysCursor ?? null;
    while ( true ) {
        /** @type {{ items: Array<Record<string, any>>, cursor?: string }} */
        let page;
        try {
            page = await puter.fs.readdir({
                path: folderRoot(folder),
                limit: DAY_PAGE_LIMIT,
                sortBy: 'name',
                sortOrder: 'desc',
                cursor,
            });
        } catch (e) {
            if ( ! isMissingDirectory(e) ) throw e;
            return;
        }
        for ( const entry of page.items ) {
            if ( entry.is_dir && isDayName(entry.name) ) {
                yield { day: entry.name, ...(cursor ? { daysCursor: cursor } : {}) };
            }
        }
        if ( ! page.cursor ) return;
        cursor = page.cursor;
    }
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
    const days = walkDays(this.puter, folder, position?.daysCursor);
    /** @type {EmailSummary[]} */
    const items = [];

    // Resume at the cursor's day; a day folder deleted since the cursor was
    // issued means continuing from the next older one.
    let next = await days.next();
    while ( position && ! next.done && next.value.day > position.day ) {
        next = await days.next();
    }
    let fsCursor = position && ! next.done && next.value.day === position.day ? position.fsCursor : undefined;

    while ( ! next.done && items.length < limit ) {
        const { day, daysCursor } = next.value;
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
            return { items, cursor: encodeCursor({ folder, day, fsCursor, daysCursor }) };
        }
        next = await days.next();
    }

    if ( ! next.done ) {
        const { day, daysCursor } = next.value;
        return { items, cursor: encodeCursor({ folder, day, daysCursor }) };
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
