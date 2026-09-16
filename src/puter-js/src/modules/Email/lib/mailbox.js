import { PuterJSError } from '../../../lib/PuterJSError.js';

/** @typedef {import('../types.js').EmailFolder} EmailFolder */
/** @typedef {import('../types.js').EmailSummary} EmailSummary */

// A mailbox is a folder of `message/rfc822` objects under `~/.mail`, one
// subfolder per UTC day, each object named `{uuidv7}--{base64url(subject)}`.
// Everything here derives from that layout and touches no network.

/** @type {Record<EmailFolder, string>} */
export const FOLDER_DIRS = { inbox: 'objects', sent: 'sent' };

export const DEFAULT_FOLDER = /** @type {EmailFolder} */ ('inbox');
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRY_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})--(.*)$/i;
const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {unknown} folder @returns {EmailFolder} */
export const normalizeFolder = (folder) => {
    if ( folder === undefined ) return DEFAULT_FOLDER;
    if ( typeof folder === 'string' && Object.prototype.hasOwnProperty.call(FOLDER_DIRS, folder) ) {
        return /** @type {EmailFolder} */ (folder);
    }
    throw new PuterJSError(`Unknown folder: ${ String(folder) }`, 'invalid_request');
};

/** @param {unknown} limit @returns {number} */
export const normalizeLimit = (limit) => {
    if ( limit === undefined ) return DEFAULT_LIMIT;
    if ( typeof limit !== 'number' || ! Number.isFinite(limit) || limit < 1 ) {
        throw new PuterJSError('`limit` must be a positive number', 'invalid_request');
    }
    return Math.min(Math.floor(limit), MAX_LIMIT);
};

/** @param {EmailFolder} folder */
export const folderRoot = (folder) => `~/.mail/${ FOLDER_DIRS[folder] }`;

/** @param {EmailFolder} folder @param {string} day */
export const dayPath = (folder, day) => `${ folderRoot(folder) }/${ day }`;

/** @param {unknown} id @returns {id is string} */
export const isUuidV7 = (id) => typeof id === 'string' && UUID_V7.test(id);

/** @param {string} name */
export const isDayName = (name) => DAY_NAME.test(name);

/**
 * The instant a v7 uuid was minted: its first 48 bits are Unix milliseconds.
 *
 * @param {string} id
 * @returns {Date}
 */
export const uuidV7Date = (id) => new Date(parseInt(id.slice(0, 8) + id.slice(9, 13), 16));

/** @param {Date} date @returns {string} `YYYY-MM-DD` in UTC. */
export const dayOf = (date) => date.toISOString().slice(0, 10);

/**
 * The day folders a message with this id can live in, most likely first. The
 * folder name is stamped a moment before the uuid, so a message can straddle
 * midnight, and the uuid clock can run slightly ahead under load.
 *
 * @param {string} id
 * @returns {string[]}
 */
export const candidateDays = (id) => {
    const minted = uuidV7Date(id);
    return [0, 1, -1].map(offset => dayOf(new Date(minted.getTime() + offset * DAY_MS)));
};

/**
 * @param {string} encoded base64url, as the writers produce it
 * @returns {string} Empty when the segment cannot be decoded.
 */
export const decodeSubject = (encoded) => {
    if ( ! encoded ) return '';
    try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for ( let i = 0; i < binary.length; i++ ) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        return '';
    }
};

/**
 * @param {string} name
 * @returns {{ id: string, subject: string } | null} Null for anything that is not a mail object.
 */
export const parseEntryName = (name) => {
    const match = ENTRY_NAME.exec(name);
    if ( ! match ) return null;
    return { id: match[1].toLowerCase(), subject: decodeSubject(match[2]) };
};

/**
 * @param {{ name: string, path: string, uid: string, size?: number | null, is_dir?: boolean | number }} entry a readdir entry
 * @param {EmailFolder} folder
 * @returns {EmailSummary | null}
 */
export const toSummary = (entry, folder) => {
    if ( entry.is_dir ) return null;
    const parsed = parseEntryName(entry.name);
    if ( ! parsed ) return null;
    return {
        id: parsed.id,
        subject: parsed.subject,
        date: uuidV7Date(parsed.id).toISOString(),
        size: Number(entry.size ?? 0),
        folder,
        path: entry.path,
        uid: entry.uid,
    };
};

/**
 * Where a listing resumes: the day folder being walked and, while it still has
 * pages, the readdir cursor within it.
 *
 * @typedef {{ folder: EmailFolder, day: string, fsCursor?: string }} ListPosition
 */

/** @param {ListPosition} position @returns {string} */
export const encodeCursor = ({ folder, day, fsCursor }) => {
    const payload = { v: 1, f: folder, d: day, ...(fsCursor ? { c: fsCursor } : {}) };
    return btoa(JSON.stringify(payload));
};

/**
 * @param {unknown} cursor
 * @param {EmailFolder} folder The folder being listed; a cursor from another folder is refused.
 * @returns {ListPosition | undefined}
 */
export const decodeCursor = (cursor, folder) => {
    if ( cursor === undefined || cursor === null ) return undefined;
    let payload;
    try {
        payload = JSON.parse(atob(String(cursor)));
    } catch (e) {
        throw new PuterJSError('Invalid cursor', 'invalid_request');
    }
    if ( ! payload || payload.v !== 1 || typeof payload.d !== 'string' || ! isDayName(payload.d) ) {
        throw new PuterJSError('Invalid cursor', 'invalid_request');
    }
    if ( payload.f !== folder ) {
        throw new PuterJSError('Cursor does not match the requested folder', 'invalid_request');
    }
    return { folder, day: payload.d, ...(typeof payload.c === 'string' ? { fsCursor: payload.c } : {}) };
};

/** A readdir on a folder that was never created. @param {unknown} e */
export const isMissingDirectory = (e) => {
    const code = /** @type {{ code?: string } | null} */ (e)?.code;
    return code === 'subject_does_not_exist' || code === 'not_found';
};
