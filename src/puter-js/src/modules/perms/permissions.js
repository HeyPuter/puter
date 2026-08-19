import { PuterJSError } from '../../lib/PuterJSError.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */

/** @param {unknown} accessLevel @returns {PermsAccess} */
const assertAccess = (accessLevel) => {
    if ( accessLevel !== 'read' && accessLevel !== 'write' ) {
        throw new PuterJSError(
            'parameter accessLevel must be `read` or `write`',
            'invalid_argument',
        );
    }
    return accessLevel;
};

/**
 * Request a specific permission string to be granted. Note that some
 * permission strings are not supported and will be denied silently.
 *
 * @this {PermsModule}
 * @param {string} permission - The permission string to request.
 * @returns {Promise<boolean>} `true` if the permission was granted.
 */
export async function request (permission) {
    // Note: this cannot move fully off of `puter.ui` without a significant
    // refactor, because the UI module owns all of the IPC communication logic.
    return await this.puter.ui.requestPermission({ permission });
}

/**
 * @deprecated Use {@link request} instead.
 * @this {PermsModule}
 * @param {...unknown} args
 * @returns {Promise<boolean>}
 */
export function requestPermission (...args) {
    return this.request(...args);
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
        permission: `user:${whoami.uuid}:email:read`,
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
        permission: `apps-of-user:${whoami.uuid}:${access}`,
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
        permission: `subdomains-of-user:${whoami.uuid}:${access}`,
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
