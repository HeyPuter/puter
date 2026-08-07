import { req } from './lib/req.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {Promise<Record<string, unknown>>} PermResult */

// -- Grant --

/**
 * Grants a permission to another user.
 * @this {PermsModule}
 * @param {string} username
 * @param {string} permission
 * @returns {PermResult}
 */
export async function grantUser (username, permission) {
    return await req(this.puter, '/auth/grant-user-user', { target_username: username, permission });
}

/**
 * Grants a permission to a group.
 * @this {PermsModule}
 * @param {string} groupUid
 * @param {string} permission
 * @returns {PermResult}
 */
export async function grantGroup (groupUid, permission) {
    return await req(this.puter, '/auth/grant-user-group', { group_uid: groupUid, permission });
}

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
 * Revokes a permission from another user.
 * @this {PermsModule}
 * @param {string} username
 * @param {string} permission
 * @returns {PermResult}
 */
export async function revokeUser (username, permission) {
    return await req(this.puter, '/auth/revoke-user-user', { target_username: username, permission });
}

/**
 * Revokes a permission from a group.
 * @this {PermsModule}
 * @param {string} groupUid
 * @param {string} permission
 * @returns {PermResult}
 */
export async function revokeGroup (groupUid, permission) {
    return await req(this.puter, '/auth/revoke-user-group', { group_uid: groupUid, permission });
}

/**
 * Revokes a permission from an app.
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
