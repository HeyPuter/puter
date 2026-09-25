// How each resource maps onto a backend permission string, defined once so a
// request and its matching `check` can never name it differently.

/** @typedef {import('../types.js').PermsAccess} PermsAccess */

/** @param {string} userUuid */
export const emailPermission = (userUuid) => `user:${userUuid}:email:read`;

/** @param {string} userUuid @param {PermsAccess} access */
export const appsPermission = (userUuid, access) =>
    `apps-of-user:${userUuid}:${access}`;

/** @param {string} userUuid @param {PermsAccess} access */
export const subdomainsPermission = (userUuid, access) =>
    `subdomains-of-user:${userUuid}:${access}`;

/** @param {string} path @param {PermsAccess} access */
export const fsPermission = (path, access) => `fs:${path}:${access}`;

/** @param {string} appUid @param {PermsAccess} access */
export const appRootDirPermission = (appUid, access) =>
    `app-root-dir:${appUid}:${access}`;
