/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

let server_info = null;

export async function fetchServerInfo(api_origin, auth_token) {
    if (server_info) return server_info;

    try {
        const res = await $.ajax({
            url: api_origin + "/version",
            type: 'GET',
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer " + auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                }
            }
        });
        server_info = {
            version: res.version,
            location: res.location,
            deployTimestamp: res.deploy_timestamp
        };
        return server_info;
    } catch (error) {
        console.error('Failed to fetch server info:', error);
        throw error;
    }
}
