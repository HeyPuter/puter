import {
    appsPermission,
    emailPermission,
    subdomainsPermission,
} from './lib/permissionStrings.js';
import { assertAccess } from './lib/validate.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */

/**
 * Ask for a raw permission string, or several under one prompt. Unsupported
 * strings are denied silently. Stays on `puter.ui`, which owns the IPC.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {string[]} permissions
 * @returns {Promise<boolean>}
 */
export async function requestPermissions (puter, permissions) {
    // Scalar form for a lone permission: the shape the dialog dedupes on.
    return permissions.length === 1
        ? await puter.ui.requestPermission({ permission: permissions[0] })
        : await puter.ui.requestPermission({ permissions });
}

/**
 * @deprecated Use {@link import('./request.js').request} instead.
 * @this {PermsModule}
 * @param {...unknown} args
 * @returns {Promise<boolean>}
 */
export function requestPermission (...args) {
    return this.request(
        .../** @type {[string, Record<string, unknown> | undefined]} */ (args),
    );
}

/**
 * Request to see the user's email. If already granted, the user is not
 * prompted and their email is returned.
 *
 * @this {PermsModule}
 * @returns {Promise<string | null | undefined>} The email if granted, `null`
 * if granted but no email is on file, or `undefined` if access is denied.
 */
export async function requestEmail () {
    let whoami = await this.puter.auth.whoami();
    if ( whoami.email !== undefined ) return whoami.email;

    const granted = await this.puter.ui.requestPermission({
        permission: emailPermission(whoami.uuid),
    });
    if ( granted ) {
        whoami = await this.puter.auth.whoami();
    }
    return whoami.email;
}

/**
 * Request access to the user's apps. `write` covers managing them (create,
 * update, delete) as well as reading them.
 *
 * @this {PermsModule}
 * @param {PermsAccess} [accessLevel] - Defaults to `'read'`.
 * @returns {Promise<boolean>} `true` if the permission was granted.
 */
export async function requestApps (accessLevel = 'read') {
    const access = assertAccess(accessLevel);
    const whoami = await this.puter.auth.whoami();
    return await this.puter.ui.requestPermission({
        permission: appsPermission(whoami.uuid, access),
    });
}

/**
 * Request access to the user's subdomains. `write` covers managing them as well
 * as reading them.
 *
 * @this {PermsModule}
 * @param {PermsAccess} [accessLevel] - Defaults to `'read'`.
 * @returns {Promise<boolean>} `true` if the permission was granted.
 */
export async function requestSubdomains (accessLevel = 'read') {
    const access = assertAccess(accessLevel);
    const whoami = await this.puter.auth.whoami();
    return await this.puter.ui.requestPermission({
        permission: subdomainsPermission(whoami.uuid, access),
    });
}

// -- Deprecated aliases --

/**
 * @deprecated Use {@link requestApps} instead.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestReadApps () {
    return this.requestApps('read');
}

/**
 * @deprecated Use {@link requestApps} instead.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestManageApps () {
    return this.requestApps('write');
}

/**
 * @deprecated Use {@link requestSubdomains} instead.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestReadSubdomains () {
    return this.requestSubdomains('read');
}

/**
 * @deprecated Use {@link requestSubdomains} instead.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestManageSubdomains () {
    return this.requestSubdomains('write');
}
