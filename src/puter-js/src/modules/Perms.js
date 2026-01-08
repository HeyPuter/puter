export default class Perms {
    constructor (puter) {
        this.puter = puter;
        this.authToken = puter.authToken;
        this.APIOrigin = puter.APIOrigin;
    }
    setAuthToken (authToken) {
        this.authToken = authToken;
    }
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }
    async req_ (route, body) {
        try {
            const resp = await fetch(this.APIOrigin + route, {
                method: body ? 'POST' : 'GET',
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json',
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            if ( resp.headers.get('content-type')?.includes('application/json') ) {
                return await resp.json();
            }
            return { message: await resp.text(), code: 'unknown_error' };
        } catch (e) {
            return { message: e.message, code: 'internal_error' };
        }
    }

    // Grant Permissions
    async grantUser (target_username, permission) {
        return await this.req_('/auth/grant-user-user', {
            target_username, permission,
        });
    }

    async grantGroup (group_uid, permission) {
        return await this.req_('/auth/grant-user-group', {
            group_uid, permission,
        });
    }

    async grantApp (app_uid, permission) {
        return await this.req_('/auth/grant-user-app', {
            app_uid, permission,
        });
    }

    async grantAppAnyUser (app_uid, permission) {
        return await this.req_('/auth/grant-dev-app', {
            app_uid, permission,
        });
    }

    async grantOrigin (origin, permission) {
        return await this.req_('/auth/grant-user-app', {
            origin, permission,
        });
    }

    // Revoke Permissions
    async revokeUser (target_username, permission) {
        return await this.req_('/auth/revoke-user-user', {
            target_username, permission,
        });
    }

    async revokeGroup (group_uid, permission) {
        return await this.req_('/auth/revoke-user-group', {
            group_uid, permission,
        });
    }

    async revokeApp (app_uid, permission) {
        return await this.req_('/auth/revoke-user-app', {
            app_uid, permission,
        });
    }

    async revokeAppAnyUser (app_uid, permission) {
        return await this.req_('/auth/revoke-dev-app', {
            app_uid, permission,
        });
    }

    async revokeOrigin (origin, permission) {
        return await this.req_('/auth/revoke-user-app', {
            origin, permission,
        });
    }

    // Group Management
    async createGroup (metadata = {}, extra = {}) {
        return await this.req_('/group/create', {
            metadata, extra,
        });
    }
    async addUsersToGroup (uid, usernames) {
        return await this.req_('/group/add-users', {
            uid,
            users: usernames ?? [],
        });
    }
    async removeUsersFromGroup (uid, usernames) {
        return await this.req_('/group/remove-users', {
            uid,
            users: usernames ?? [],
        });
    }
    async listGroups () {
        return await this.req_('/group/list');
    }

    /**
     * @deprecated use .request() instead
     */
    requestPermission (...a) {
        return this.request(...a);
    };

    /**
     * Request a specific permission string to be granted. Note that some
     * permission strings are not supported and will be denied silently.
     * @param {string} permission - permission string to request
     * @returns {boolean} true if permission was granted, false otherwise
     */
    async request (permission) {
        // note: we cannot move this fully from "puter.ui" without
        // a significant refactor because the UI module contains
        // all of the IPC communication logic.
        return await this.puter.ui.requestPermission({ permission });
    };

    // #region shorthand functions
    /**
     * Request to see a user's email. If the user has already granted this
     * permission the user will not be prompted and their email address
     * will be returned. If the user grants permission their email address will
     * be returned. If the user does not allow access `undefined` will be
     * returned. If the user does not have an email address, the value of their
     * email address will be `null`.
     *
     * @return {string|null|undefined} An email address or undefined
     */
    async requestEmail () {
        let whoami;
        whoami = await this.puter.auth.whoami();
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
     * Request read access to the user's Desktop folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Desktop path or undefined
     */
    async requestReadDesktop () {
        return this.requestFolder_('Desktop', 'read');
    }

    /**
     * Request write access to the user's Desktop folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Desktop path or undefined
     */
    async requestWriteDesktop () {
        return this.requestFolder_('Desktop', 'write');
    }

    /**
     * Request read access to the user's Documents folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Documents path or undefined
     */
    async requestReadDocuments () {
        return this.requestFolder_('Documents', 'read');
    }

    /**
     * Request write access to the user's Documents folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Documents path or undefined
     */
    async requestWriteDocuments () {
        return this.requestFolder_('Documents', 'write');
    }

    /**
     * Request read access to the user's Pictures folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Pictures path or undefined
     */
    async requestReadPictures () {
        return this.requestFolder_('Pictures', 'read');
    }

    /**
     * Request write access to the user's Pictures folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Pictures path or undefined
     */
    async requestWritePictures () {
        return this.requestFolder_('Pictures', 'write');
    }

    /**
     * Request read access to the user's Videos folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Videos path or undefined
     */
    async requestReadVideos () {
        return this.requestFolder_('Videos', 'read');
    }

    /**
     * Request write access to the user's Videos folder. If the user has already
     * granted this permission the user will not be prompted and the path will
     * be returned. If the user grants permission the path will be returned.
     * If the user does not allow access `undefined` will be returned.
     *
     * @return {string|undefined} The Videos path or undefined
     */
    async requestWriteVideos () {
        return this.requestFolder_('Videos', 'write');
    }

    /**
     * Request read access to the user's apps. If the user has already granted
     * this permission the user will not be prompted and `true` will be returned.
     * If the user grants permission `true` will be returned. If the user does
     * not allow access `false` will be returned.
     *
     * @return {boolean} Whether read access to apps was granted
     */
    async requestReadApps () {
        const whoami = await this.puter.auth.whoami();
        const granted = await this.puter.ui.requestPermission({
            permission: `apps-of-user:${whoami.uuid}:read`,
        });
        return granted;
    }

    /**
     * Request write (manage) access to the user's apps. If the user has already
     * granted this permission the user will not be prompted and `true` will be
     * returned. If the user grants permission `true` will be returned. If the
     * user does not allow access `false` will be returned.
     *
     * @return {boolean} Whether manage access to apps was granted
     */
    async requestManageApps () {
        const whoami = await this.puter.auth.whoami();
        const granted = await this.puter.ui.requestPermission({
            permission: `apps-of-user:${whoami.uuid}:write`,
        });
        return granted;
    }

    /**
     * Request read access to the user's subdomains. If the user has already
     * granted this permission the user will not be prompted and `true` will be
     * returned. If the user grants permission `true` will be returned. If the
     * user does not allow access `false` will be returned.
     *
     * @return {boolean} Whether read access to subdomains was granted
     */
    async requestReadSubdomains () {
        const whoami = await this.puter.auth.whoami();
        const granted = await this.puter.ui.requestPermission({
            permission: `subdomains-of-user:${whoami.uuid}:read`,
        });
        return granted;
    }

    /**
     * Request write (manage) access to the user's subdomains. If the user has
     * already granted this permission the user will not be prompted and `true`
     * will be returned. If the user grants permission `true` will be returned.
     * If the user does not allow access `false` will be returned.
     *
     * @return {boolean} Whether manage access to subdomains was granted
     */
    async requestManageSubdomains () {
        const whoami = await this.puter.auth.whoami();
        const granted = await this.puter.ui.requestPermission({
            permission: `subdomains-of-user:${whoami.uuid}:write`,
        });
        return granted;
    }

    /**
     * Internal helper to request access to a user's special folder.
     * @private
     * @param {string} folderName - The name of the folder (Desktop, Documents, Pictures, Videos)
     * @param {string} accessLevel - The access level (read, write)
     * @return {string|undefined} The folder path or undefined
     */
    async requestFolder_ (folderName, accessLevel) {
        const whoami = await this.puter.auth.whoami();
        const folderPath = `/${whoami.username}/${folderName}`;

        // Check if we already have access by trying to stat the folder
        try {
            await this.puter.fs.stat({ path: folderPath });

            // If we can stat the folder, we have at least read access
            if ( accessLevel !== 'write' ) {
                return folderPath;
            }
        } catch (e) {
            // No access yet, need to request permission
        }

        const granted = await this.puter.ui.requestPermission({
            permission: `fs:${folderPath}:${accessLevel}`,
        });

        if ( granted ) {
            return folderPath;
        }

        return undefined;
    }
    // #endregion
}
