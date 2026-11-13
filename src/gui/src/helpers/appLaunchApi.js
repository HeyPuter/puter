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

/** Server calls an app launch makes, kept free of desktop globals for the app browser embed. */

/**
 * @typedef {object} AppLaunchServer
 * @property {string} [apiOrigin]
 * @property {string} [authToken] - the GUI session token
 */

/**
 * Fetches the token the app signs in with.
 *
 * @param {{ appUid?: string } & AppLaunchServer} options
 */
export const fetchUserAppTokenForLaunch = async ({
    appUid,
    apiOrigin = window.api_origin,
    authToken = window.auth_token,
} = {}) => {
    if ( ! appUid ) {
        return {
            token: null,
            reason: 'missing-app-uid',
        };
    }

    try {
        const response = await fetch(`${apiOrigin}/auth/get-user-app-token`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ app_uid: appUid }),
            method: 'POST',
        });

        let responseBody;
        try {
            responseBody = await response.json();
        } catch ( error ) {
            responseBody = null;
        }

        if ( response.ok && responseBody?.token ) {
            return {
                token: responseBody.token,
            };
        }

        return {
            token: null,
            reason: 'token-request-failed',
            status: response.status,
            responseCode: responseBody?.code ?? responseBody?.error?.code,
            responseMessage: responseBody?.message ?? responseBody?.error?.message,
            responseBody,
            attempts: 1,
        };
    } catch ( error ) {
        return {
            token: null,
            reason: 'network-error',
            error,
            attempts: 1,
        };
    }
};

/**
 * Records the open with the server (`/rao`), which keeps the user's recent apps.
 *
 * @param {{ appUid: string, socketId?: string } & AppLaunchServer} options
 */
export const reportAppOpen = ({
    appUid,
    socketId,
    apiOrigin = window.api_origin,
    authToken = window.auth_token,
}) => {
    $.ajax({
        url: `${apiOrigin}/rao`,
        type: 'POST',
        data: JSON.stringify({
            original_client_socket_id: socketId,
            app_uid: appUid,
        }),
        async: true,
        contentType: 'application/json',
        headers: {
            'Authorization': `Bearer ${authToken}`,
        },
    });
};
