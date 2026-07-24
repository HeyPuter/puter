/** @typedef {import('./index.js').PermsModule} PermsModule */

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
 * Request read access to the user's apps.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export async function requestReadApps () {
    const whoami = await this.puter.auth.whoami();
    return await this.puter.ui.requestPermission({ permission: `apps-of-user:${whoami.uuid}:read` });
}

/**
 * Request write (manage) access to the user's apps.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export async function requestManageApps () {
    const whoami = await this.puter.auth.whoami();
    return await this.puter.ui.requestPermission({ permission: `apps-of-user:${whoami.uuid}:write` });
}

/**
 * Request read access to the user's subdomains.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export async function requestReadSubdomains () {
    const whoami = await this.puter.auth.whoami();
    return await this.puter.ui.requestPermission({ permission: `subdomains-of-user:${whoami.uuid}:read` });
}

/**
 * Request write (manage) access to the user's subdomains.
 * @this {PermsModule}
 * @returns {Promise<boolean>}
 */
export async function requestManageSubdomains () {
    const whoami = await this.puter.auth.whoami();
    return await this.puter.ui.requestPermission({ permission: `subdomains-of-user:${whoami.uuid}:write` });
}
