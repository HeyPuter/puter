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
                const jsonResult = await resp.json();
                if ( resp.status !== 200 ) {
                    jsonResult.error = true;
                }
                return jsonResult;
            }
            return { error: true, message: await resp.text(), code: 'unknown_error' };
        } catch (e) {
            return { error: true, message: e.message, code: 'internal_error' };
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
     * Request read access to the root directory of one of the user's apps,
     * identified by its resource request code (e.g. from app.resource_request_code).
     * If the user grants permission, returns the filesystem item for that directory.
     * If the user denies or an error occurs, returns undefined.
     *
     * @param {string} resourceRequestCode - The resource request code (e.g. `${app.uid}:root_dir`)
     * @return {Promise<object|undefined>} The directory fs item (stat) or undefined
     */
    async requestReadAppRootDir (app_uid) {
        return await this.#requestAppRootDir('read', app_uid);
    }

    /**
     * Request write access to the root directory of one of the user's apps,
     * identified by its resource request code (e.g. from app.resource_request_code).
     * If the user grants permission, returns the filesystem item for that directory.
     * If the user denies or an error occurs, returns undefined.
     *
     * @param {string} resourceRequestCode - The resource request code (e.g. `${app.uid}:root_dir`)
     * @return {Promise<object|undefined>} The directory fs item (stat) or undefined
     */
    async requestWriteAppRootDir (app_uid) {
        return await this.#requestAppRootDir('write', app_uid);
    }

    async #requestAppRootDir (access, app_uid) {
        if ( typeof app_uid === 'object' && app_uid !== null ) {
            app_uid = app_uid.uid;
        }
        if ( typeof app_uid !== 'string' ) {
            throw new Error('parameter app_uid must be a strinkg');
        }

        let result;
        const fetchIt = async () => result = await this.req_('/auth/request-app-root-dir', {
            app_uid,
            access: 'read',
        });
        await fetchIt();
        if ( ! result.error ) return result;

        // Request permission
        app_uid = (typeof app_or_uuid === 'object') && app_uid !== null
            ? app_uid.uid : app_uid;
        const readAppRootDirPermission = `app-root-dir:${app_uid}:read`;
        const granted = await this.puter.ui.requestPermission({
            permission: readAppRootDirPermission,
        });

        if ( granted ) {
            await fetchIt();

            // If the server has cache invalidation issues, we still want this
            // to work anyway. This is a hack, but also a reasonable safeguard.
            let delay = 100;
            const maxTotalWait = 5000;
            let totalWaited = 0;
            while ( result.error && totalWaited < maxTotalWait ) {
                await new Promise(r => setTimeout(r, delay));
                totalWaited += delay;
                await fetchIt();
                if ( ! result.error ) break;
                delay = Math.min(delay * 2, Math.max(100, maxTotalWait - totalWaited));
            }
        }
        if ( ! result.error ) return result;
        return undefined;
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
