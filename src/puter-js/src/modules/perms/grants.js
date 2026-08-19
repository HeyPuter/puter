import { req } from './lib/req.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {Promise<Record<string, unknown>>} PermResult */

// These resolve to a parsed result object (with `error: true` set on failure)
// rather than rejecting — callers inspect `result.error` instead of catching.

// -- Grant --

/**
 * Grants a permission to an app.
 * @this {PermsModule}
 * @param {string} appUid
 * @param {string} permission
 * @returns {PermResult}
 */
export async function grantApp (appUid, permission) {
    return await req(this.puter, '/auth/grant-user-app', { app_uid: appUid, permission });
}

/**
 * Grants a permission to an app for any user (developer grant).
 * @this {PermsModule}
 * @param {string} appUid
 * @param {string} permission
 * @returns {PermResult}
 */
export async function grantAppAnyUser (appUid, permission) {
    return await req(this.puter, '/auth/grant-dev-app', { app_uid: appUid, permission });
}

/**
 * Grants a permission to an origin.
 * @this {PermsModule}
 * @param {string} origin
 * @param {string} permission
 * @returns {PermResult}
 */
export async function grantOrigin (origin, permission) {
    return await req(this.puter, '/auth/grant-user-app', { origin, permission });
}

// -- Revoke --

/**
 * Revokes a permission from an app. `'*'` revokes every permission the user has
 * granted it, which is what uninstalling an app does.
 * @this {PermsModule}
 * @param {string} appUid
 * @param {string} permission
 * @returns {PermResult}
 */
export async function revokeApp (appUid, permission) {
    return await req(this.puter, '/auth/revoke-user-app', { app_uid: appUid, permission });
}

/**
 * Revokes an app's any-user (developer) permission.
 * @this {PermsModule}
 * @param {string} appUid
 * @param {string} permission
 * @returns {PermResult}
 */
export async function revokeAppAnyUser (appUid, permission) {
    return await req(this.puter, '/auth/revoke-dev-app', { app_uid: appUid, permission });
}

/**
 * Revokes a permission from an origin.
 * @this {PermsModule}
 * @param {string} origin
 * @param {string} permission
 * @returns {PermResult}
 */
export async function revokeOrigin (origin, permission) {
    return await req(this.puter, '/auth/revoke-user-app', { origin, permission });
}
