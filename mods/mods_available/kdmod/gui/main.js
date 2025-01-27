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
const request_examples = [
    {
        name: 'entity storage app read',
        fetch: async (args) => {
            return await fetch(`${window.api_origin}/drivers/call`, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${puter.authToken}`,
                },
                body: JSON.stringify({
                    interface: 'puter-apps',
                    method: 'read',
                    args,
                }),
                method: "POST",
            });
        },
        out: async (resp) => {
            const data = await resp.json();
            if ( ! data.success ) return data;
            return data.result;
        },
        exec: async function exec (...a) {
            const resp = await this.fetch(...a);
            return await this.out(resp);
        },
    },
    {
        name: 'entity storage app select all',
        fetch: async () => {
            return await fetch(`${window.api_origin}/drivers/call`, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${puter.authToken}`,
                },
                body: JSON.stringify({
                    interface: 'puter-apps',
                    method: 'select',
                    args: { predicate: [] },
                }),
                method: "POST",
            });
        },
        out: async (resp) => {
            const data = await resp.json();
            if ( ! data.success ) return data;
            return data.result;
        },
        exec: async function exec (...a) {
            const resp = await this.fetch(...a);
            return await this.out(resp);
        },
    },
    {
        name: 'grant permission from a user to a user',
        fetch: async (user, perm) => {
            return await fetch(`${window.api_origin}/auth/grant-user-user`, {
            "headers": {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${puter.authToken}`,
            },
            "body": JSON.stringify({
                target_username: user,
                permission: perm,
            }),
            "method": "POST",
            });
        },
        out: async (resp) => {
            const data = await resp.json();
            return data;
        },
        exec: async function exec (...a) {
            const resp = await this.fetch(...a);
            return await this.out(resp);
        },
    },
    {
        name: 'write file',
        fetch: async (path, str) => {
            const endpoint = `${window.api_origin}/write`;
            const token = puter.authToken;
        
            const blob = new Blob([str], { type: 'text/plain' });
            const formData = new FormData();
            formData.append('create_missing_ancestors', true);
            formData.append('path', path);
            formData.append('size', 8);
            formData.append('overwrite', true);
            formData.append('file', blob, 'something.txt');
        
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            return await response.json();
        },
    }
];

globalThis.reqex = request_examples;

globalThis.service_script(api => {
    api.on_ready(() => {
    });
});
