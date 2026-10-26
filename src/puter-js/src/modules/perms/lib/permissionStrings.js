// How each resource maps onto a backend permission string, defined once so a
// request and its matching `check` can never name it differently.

/** @typedef {import('../types.js').PermsAccess} PermsAccess */
/** @typedef {import('../types.js').PermsKvShareAccess} PermsKvShareAccess */

/**
 * One component, escaped the way the server splits it back: `\` as `\\` and
 * `:` as `\C`.
 *
 * @param {string} component
 */
const escapeComponent = (component) =>
    component.replace(/\\/g, '\\\\').replace(/:/g, '\\C');

/** @param {string} userUuid */
export const emailPermission = (userUuid) => `user:${userUuid}:email:read`;

/** @param {string} userUuid @param {PermsAccess} access */
export const appsPermission = (userUuid, access) =>
    `apps-of-user:${userUuid}:${access}`;

/** @param {string} userUuid @param {PermsAccess} access */
export const subdomainsPermission = (userUuid, access) =>
    `subdomains-of-user:${userUuid}:${access}`;

/** @param {string} pathOrUid @param {PermsAccess} access */
export const fsPermission = (pathOrUid, access) =>
    `fs:${escapeComponent(pathOrUid)}:${access}`;

/** @param {string} appUid @param {PermsAccess} access */
export const appRootDirPermission = (appUid, access) =>
    `app-root-dir:${appUid}:${access}`;

export const BACKGROUND_EVENTS_PERMISSION = 'events:background';

/**
 * Share-delegation roots by the level of share they let the app create for its
 * user. Mirrors the server's list.
 *
 * @type {Readonly<Record<PermsKvShareAccess, string>>}
 */
export const KV_SHARE_ROOTS = Object.freeze({
    watch: 'kv-share',
    read: 'kv-share-read',
    write: 'kv-share-write',
});

/**
 * @param {string} userUuid
 * @param {string} appUid
 * @param {string[]} segments - Key segments, already validated.
 * @param {PermsKvShareAccess} access
 */
export const kvSharePermission = (userUuid, appUid, segments, access) =>
    ['manage', KV_SHARE_ROOTS[access], userUuid, appUid, ...segments].join(':');
