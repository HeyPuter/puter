export default class Perms {
    constructor (context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
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
        whoami = await puter.auth.whoami();
        if ( whoami.email !== undefined ) return whoami.email;
        const granted = await this.puter.ui.requestPermission({
            permission: `user:${whoami.uuid}:email:read`,
        });
        if ( granted ) {
            whoami = await this.puter.auth.whoami();
        }
        return whoami.email;
    }
    // #endregion
}
