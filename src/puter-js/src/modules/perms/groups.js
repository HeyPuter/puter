import { req } from './lib/req.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {Promise<Record<string, unknown>>} PermResult */

/**
 * Creates a new group.
 * @this {PermsModule}
 * @param {Record<string, unknown>} [metadata]
 * @param {Record<string, unknown>} [extra]
 * @returns {PermResult}
 */
export async function createGroup (metadata = {}, extra = {}) {
    return await req(this.puter, '/group/create', { metadata, extra });
}

/**
 * Adds users to a group by username.
 * @this {PermsModule}
 * @param {string} uid
 * @param {string[]} usernames
 * @returns {PermResult}
 */
export async function addUsersToGroup (uid, usernames) {
    return await req(this.puter, '/group/add-users', { uid, users: usernames ?? [] });
}

/**
 * Removes users from a group by username.
 * @this {PermsModule}
 * @param {string} uid
 * @param {string[]} usernames
 * @returns {PermResult}
 */
export async function removeUsersFromGroup (uid, usernames) {
    return await req(this.puter, '/group/remove-users', { uid, users: usernames ?? [] });
}

/**
 * Lists the caller's groups.
 * @this {PermsModule}
 * @returns {PermResult}
 */
export async function listGroups () {
    return await req(this.puter, '/group/list');
}
