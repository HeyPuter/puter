import {
    appsPermission,
    emailPermission,
    subdomainsPermission,
} from './lib/permissionStrings.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('../../index.js').Puter} Puter */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */

/**
 * Ask for a raw permission string, or several under one prompt. Unsupported
 * strings are denied silently. Stays on `puter.ui`, which owns the IPC.
 *
 * @param {Puter} puter
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
 * @param {Puter} puter
 * @param {PermsAccess} access
 * @returns {Promise<boolean>}
 */
async function requestAppsAccess (puter, access) {
    const whoami = await puter.auth.whoami();
    return await requestPermissions(puter, [
        appsPermission(whoami.uuid, access),
    ]);
}

/**
 * @param {Puter} puter
 * @param {PermsAccess} access
 * @returns {Promise<boolean>}
 */
async function requestSubdomainsAccess (puter, access) {
    const whoami = await puter.auth.whoami();
    return await requestPermissions(puter, [
        subdomainsPermission(whoami.uuid, access),
    ]);
}

// -- Deprecated aliases --

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
 * Request access to the user's email address, returning it when granted.
 *
 * @deprecated Use `request('email')`.
 * @this {PermsModule}
 * @returns {Promise<string | null | undefined>}
 */
export async function requestEmail () {
    let whoami = await this.puter.auth.whoami();
    // The grant is what puts the field on `whoami`, so it being present at all
    // means the access is already held — `null` included.
    if ( whoami.email !== undefined ) return whoami.email;

    const granted = await this.puter.ui.requestPermission({
        permission: emailPermission(whoami.uuid),
    });
    if ( granted ) {
        whoami = await this.puter.auth.whoami();
        return whoami.email;
    }
}

/**
 * @deprecated Use `request('apps')`.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestReadApps () {
    return requestAppsAccess(this.puter, 'read');
}

/**
 * @deprecated Use `request('apps', { access: 'write' })`.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestManageApps () {
    return requestAppsAccess(this.puter, 'write');
}

/**
 * @deprecated Use `request('subdomains')`.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestReadSubdomains () {
    return requestSubdomainsAccess(this.puter, 'read');
}

/**
 * @deprecated Use `request('subdomains', { access: 'write' })`.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export function requestManageSubdomains () {
    return requestSubdomainsAccess(this.puter, 'write');
}
