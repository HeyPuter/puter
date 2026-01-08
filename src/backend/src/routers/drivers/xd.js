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
const eggspress = require('../../api/eggspress');

const init_client_js = code => {
    return `
        document.addEventListener('DOMContentLoaded', function() {
            (${code})();
        });
    `;
};

const script = async function script () {
    const call = async ({
        interface_name,
        method_name,
        params,
    }) => {
        const response = await fetch('/drivers/call', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                interface: interface_name,
                method: method_name,
                params,
            }),
        });
        return await response.json();
    };

    const fcall = async ({
        interface_name,
        method_name,
        params,
    }) => {
        // multipart request
        const form = new FormData();
        form.append('interface', interface_name);
        form.append('method', method_name);
        for ( const k in params ) {
            form.append(k, params[k]);
        }
        const response = await fetch('/drivers/call', {
            method: 'POST',
            body: form,
        });
        return await response.json();
    };

    /* global window */
    window.addEventListener('message', async event => {
        const { id, interface: interface_, method, params } = event.data;
        let has_file = false;
        for ( const k in params ) {
            if ( params[k] instanceof File ) {
                has_file = true;
                break;
            }
        }
        const result = has_file ? await fcall({
            interface_name: interface_,
            method_name: method,
            params,
        }) : await call({
            interface_name: interface_,
            method_name: method,
            params,
        });
        const response = {
            id,
            result,
        };
        event.source.postMessage(response, event.origin);
    });
};

/**
 * POST /drivers/xd
 *
 * This endpoint services the document which receives
 * cross-document messages from the SDK and forwards
 * them to the Puter Driver API.
 */
module.exports = eggspress('/drivers/xd', {
    auth: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    res.type('text/html');
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Puter Driver API</title>
                <script>
                    ${init_client_js(script)}
                </script>
            </head>
            <body></body>
        </html>
    `);
});
