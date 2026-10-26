import { KV_SHARE_ROOTS, kvSharePermission } from './lib/permissionStrings.js';
import { invalidArgument } from './lib/validate.js';

/** @typedef {import('./types.js').PermsKvShareAccess} PermsKvShareAccess */

const KV_KEY_SEPARATOR = ':';
const KV_SHARE_SEGMENT = /^[a-z0-9_.-]+$/;

/**
 * Longest permission the server stores. It binds before the 256-byte cap on a
 * `read` or `write` share's prefix, so that cap needs no check of its own.
 */
const PERMISSION_MAX_LEN = 255;

/**
 * The key segments a share prefix names. Mirrors the server's refusals, so a
 * bad prefix fails here instead of being denied without a prompt.
 *
 * @param {unknown} prefix
 * @returns {string[]}
 */
export function kvSharePrefixSegments (prefix) {
    if ( typeof prefix !== 'string' ) {
        throw invalidArgument('`prefix` must be a string');
    }
    if ( /[*?]/.test(prefix) ) {
        throw invalidArgument('`prefix` is a key prefix, not a pattern');
    }
    if ( prefix.includes('\\') ) {
        throw invalidArgument('`prefix` may not contain a backslash');
    }
    const segments = prefix.split(KV_KEY_SEPARATOR);
    if ( segments[segments.length - 1] === '' ) segments.pop();
    if ( segments.length === 0 ) {
        throw invalidArgument('`prefix` must name part of the app\'s data, not all of it');
    }
    if ( segments.some((segment) => segment === '') ) {
        throw invalidArgument('`prefix` may not have an empty key segment');
    }
    if ( segments.some((segment) => ! KV_SHARE_SEGMENT.test(segment)) ) {
        throw invalidArgument('`prefix` may only contain lowercase letters (a-z), digits, `_`, `.` and `-` between its `:` separators');
    }
    return segments;
}

/**
 * The delegation a `'kvShare'` request asks for: this app sharing a region of
 * the data it keeps for this user.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {Record<string, any>} whoami
 * @param {Record<string, unknown>} details
 * @returns {string}
 */
export function kvShareRequestPermission (puter, whoami, details) {
    const access = details.access ?? 'watch';
    if ( typeof access !== 'string' || ! Object.hasOwn(KV_SHARE_ROOTS, access) ) {
        throw invalidArgument(
            `access must be one of: ${Object.keys(KV_SHARE_ROOTS).join(', ')}`,
        );
    }
    const segments = kvSharePrefixSegments(details.prefix);
    // An app token's `whoami` names the app by uid.
    const appUid = whoami.app_name ?? puter.appID;
    if ( typeof appUid !== 'string' || appUid === '' ) {
        throw invalidArgument('only an app can ask to share the data it keeps');
    }
    const permission = kvSharePermission(
        whoami.uuid,
        appUid,
        segments,
        /** @type {PermsKvShareAccess} */ (access),
    );
    if ( permission.length > PERMISSION_MAX_LEN ) {
        const room = PERMISSION_MAX_LEN - (permission.length - segments.join(KV_KEY_SEPARATOR).length);
        throw invalidArgument(
            `\`prefix\` may be at most ${room} characters for this app with \`${access}\` access`,
        );
    }
    return permission;
}
