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

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import registerOAuthRoutes from './oauth.js';

const routes = {};
registerOAuthRoutes({
    get: (path, handler) => {
        routes[`GET ${path}`] = handler;
    },
    post: (path, handler) => {
        routes[`POST ${path}`] = handler;
    },
});

const call = (method, pathAndQuery, init = {}) =>
    routes[`${method} ${pathAndQuery.split('?')[0]}`]({
        request: new Request(`https://mcp.example${pathAndQuery}`, { method, ...init }),
    });

const registerClient = async (redirectUris) => {
    const res = await call('POST', '/register', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: redirectUris }),
    });
    return { status: res.status, body: await res.json() };
};

const authorize = (params) =>
    call('GET', `/authorize?${new URLSearchParams({ response_type: 'code', ...params })}`);

describe('mcp oauth bridge', () => {
    it('delivers the token to a registered redirect_uri', async () => {
        const redirectUri = 'https://client.example/callback';
        const { body: client } = await registerClient([redirectUri]);
        const verifier = 'a-verifier-long-enough-for-pkce-0123456789abcdef';

        const res = await authorize({
            client_id: client.client_id,
            redirect_uri: redirectUri,
            state: 'client-state',
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
        });
        expect(res.status).toBe(302);
        const authme = new URL(res.headers.get('Location'));
        expect(authme.searchParams.get('action')).toBe('authme');

        // What authme does once the user approves.
        const callbackUrl = new URL(authme.searchParams.get('redirectURL'));
        callbackUrl.searchParams.set('token', 'puter-token');
        const callback = await call('GET', `${callbackUrl.pathname}${callbackUrl.search}`);
        expect(callback.status).toBe(302);
        const delivered = new URL(callback.headers.get('Location'));
        expect(`${delivered.origin}${delivered.pathname}`).toBe(redirectUri);
        expect(delivered.searchParams.get('state')).toBe('client-state');

        const tokenRes = await call('POST', '/token', {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: delivered.searchParams.get('code'),
                code_verifier: verifier,
            }),
        });
        expect((await tokenRes.json()).access_token).toBe('puter-token');
    });

    it('refuses a redirect_uri the client did not register', async () => {
        const { body: client } = await registerClient(['https://client.example/callback']);

        const res = await authorize({
            client_id: client.client_id,
            redirect_uri: 'https://evil.example/callback',
        });
        expect(res.status).toBe(400);
        expect(res.headers.get('Location')).toBeNull();
    });

    it('refuses a missing or unissued client_id', async () => {
        const redirectUri = 'https://client.example/callback';

        expect((await authorize({ redirect_uri: redirectUri })).status).toBe(400);
        const res = await authorize({
            client_id: 'puter-mcp-00000000-0000-0000-0000-000000000000',
            redirect_uri: redirectUri,
        });
        expect(res.status).toBe(400);
        expect(res.headers.get('Location')).toBeNull();
    });

    it('lets a loopback redirect change port but not path', async () => {
        const { body: client } = await registerClient(['http://127.0.0.1:33418/callback']);

        const otherPort = await authorize({
            client_id: client.client_id,
            redirect_uri: 'http://127.0.0.1:50123/callback',
        });
        expect(otherPort.status).toBe(302);
        const otherPath = await authorize({
            client_id: client.client_id,
            redirect_uri: 'http://127.0.0.1:50123/elsewhere',
        });
        expect(otherPath.status).toBe(400);
    });

    it('validates redirect_uris at registration', async () => {
        const accepted = await registerClient([
            'http://localhost:8123/callback',
            'cursor://anysphere.cursor-mcp/oauth/callback',
        ]);
        expect(accepted.status).toBe(201);

        for (const redirectUris of [
            undefined,
            [],
            ['http://client.example/callback'],
            ['https://client.example/callback#fragment'],
            ['not a url'],
        ]) {
            const { status, body } = await registerClient(redirectUris);
            expect(status).toBe(400);
            expect(body.error).toBe('invalid_redirect_uri');
        }
    });
});
