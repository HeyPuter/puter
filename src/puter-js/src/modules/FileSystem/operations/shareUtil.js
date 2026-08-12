// Shared helpers for the sharing operations.

import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

/** @typedef {import('../types.js').Share} Share */
/** @typedef {import('../types.js').ShareRecipient} ShareRecipient */

/**
 * Normalizes recipients into the wire form. A bare string is read as an email
 * when it contains `@`, and as a username otherwise.
 *
 * @param {unknown} value
 * @returns {Array<{ email?: string, username?: string }>}
 */
export const toShareRecipients = (value) => {
    const list = Array.isArray(value) ? value : [value];
    return list
        .filter((entry) => entry !== undefined && entry !== null)
        .map((entry) => {
            if ( typeof entry === 'string' ) {
                const trimmed = entry.trim();
                return trimmed.includes('@')
                    ? { email: trimmed }
                    : { username: trimmed };
            }
            const record = /** @type {Record<string, unknown>} */ (entry);
            return {
                ...(record.email ? { email: String(record.email) } : {}),
                ...(record.username ? { username: String(record.username) } : {}),
            };
        });
};

/**
 * Collects whichever of `path`, `paths` or `uid` the caller supplied into the
 * wire form. Paths are made absolute; UIDs are passed through.
 *
 * @param {Record<string, unknown>} options
 * @param {(path: string) => string} [resolvePath]
 * @returns {Array<{ path?: string, uid?: string }>}
 */
export const toShareItems = (options, resolvePath = getAbsolutePathForApp) => {
    if ( options.uid !== undefined ) {
        const uids = Array.isArray(options.uid) ? options.uid : [options.uid];
        return uids.map((uid) => ({ uid: String(uid) }));
    }
    const raw = options.paths !== undefined ? options.paths : options.path;
    const paths = Array.isArray(raw) ? raw : [raw];
    return paths
        .filter((path) => path !== undefined && path !== null)
        .map((path) => ({ path: resolvePath(String(path)) }));
};

/**
 * Turns one wire share into the shape the SDK publishes.
 *
 * @param {Record<string, unknown>} row
 * @returns {Share}
 */
export const toShare = (row) => ({
    uid: /** @type {string} */ (row.uid),
    mode: /** @type {Share['mode']} */ (row.mode),
    path: /** @type {string} */ (row.path),
    entryUid: /** @type {string} */ (row.uid_entry ?? row.entryUid),
    isDir: Boolean(row.is_dir ?? row.isDir),
    issuer: /** @type {string | null} */ (row.issuer ?? null),
    holder: /** @type {string | null} */ (row.holder ?? null),
});
