/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
/**
 * Authentication manager
 * Eventually this will want to retrieve stored credentials from somewhere, but for now
 * it simply uses whatever username and password are passed to the constructor.
 */
export class Authenticator {
    // Map of url string -> { username, password }
    #saved_auth_for_url = new Map();

    // { username, password } provided in the constructor
    #provided_auth;

    constructor({ username, password } = {}) {
        if (username && password) {
            this.#provided_auth = { username, password };
        }
    }

    /**
     * Gives you an object that can be included in the parameters to any isomorphic-git
     * function that wants authentication.
     * eg, `await git.push({ ...get_auth_callbacks(stderr), etc });`
     * @param stderr
     * @returns {{onAuth: ((function(*, *): Promise<*|undefined>)|*), onAuthFailure: *, onAuthSuccess: *}}
     */
    get_auth_callbacks(stderr) {
        return {
            onAuth: async (url, auth) => {
                if (this.#provided_auth)
                    return this.#provided_auth;
                if (this.#saved_auth_for_url.has(url))
                    return this.#saved_auth_for_url.get(url);
                // TODO: Look up saved authentication data from somewhere, based on the url.
                // TODO: Finally, request auth details from the user.
                stderr('Authentication required. Please specify --username and --password.');
            },
            onAuthSuccess: (url, auth) => {
                // TODO: Save this somewhere?
                this.#saved_auth_for_url.set(url, auth);
            },
            onAuthFailure: (url, auth) => {
                stderr(`Failed authentication for '${url}'`);
            },
        };
    }
}

export const authentication_options = {
    // FIXME: --username and --password are a horrible way of doing authentication,
    //        but we don't have other options right now. Remove them ASAP!
    username: {
        description: 'TEMPORARY: Username to authenticate with.',
        type: 'string',
        short: 'u',
    },
    password: {
        description: 'TEMPORARY: Password to authenticate with. For github.com, this needs to be a "Personal Access Token", created at https://github.com/settings/tokens with access to the repository.',
        type: 'string',
        short: 'p',
    },
}
