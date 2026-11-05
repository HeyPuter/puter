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
 * The router runtime's client bootstrap. A caller's client is built fresh on
 * every authed request and only ever makes API calls on their behalf, so the
 * socket `init_puter_portable` opens by default is one connection per request
 * and no use to anyone.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import initS2w from './s2w-router.js';

const GLOBALS = [
    'me',
    'my',
    'myself',
    'router',
    'self',
    'init_puter_portable',
    'puter_auth',
    'puter_endpoint',
];

/** Every `init_puter_portable` call the runtime made, in order. */
let builds;

/** Bring the runtime up with the globals the preamble would have defined. */
const loadRouter = () => {
    builds = [];
    globalThis.init_puter_portable = (auth, apiOrigin, type, options) => {
        builds.push({ auth, apiOrigin, type, options });
        return { authToken: auth, build: builds.length };
    };
    globalThis.puter_auth = 'worker-token';
    globalThis.puter_endpoint = 'https://api.example';
    globalThis.self = { addEventListener: () => {} };
    initS2w();

    const seen = [];
    globalThis.router.get('/ping', (event) => {
        seen.push(event);
        return 'pong';
    });
    return { seen };
};

/** Drive one authed request through the router, as the fetch listener does. */
const request = (token) =>
    globalThis.router.route({
        request: new Request('https://worker.example/ping', {
            headers: token ? { 'puter-auth': token } : {},
        }),
    });

beforeEach(() => {
    for (const name of GLOBALS) delete globalThis[name];
});

afterEach(() => {
    for (const name of GLOBALS) delete globalThis[name];
});

describe('the router runtime, per authed request', () => {
    it('opens no socket for a caller', async () => {
        const { seen } = loadRouter();

        await request('caller-a');

        expect(builds[1].auth).toBe('caller-a');
        expect(builds[1].options).toEqual({ socket: false });
        expect(builds[1].apiOrigin).toBe('https://api.example');
        expect(builds[1].type).toBe('userPuter');
        expect(seen[0].user).toBe(seen[0].requestor);
        expect(seen[0].requestor.puter.authToken).toBe('caller-a');
    });

    it('builds the caller a client of their own, separate from me', async () => {
        loadRouter();

        await request('caller-a');
        await request('caller-b');

        expect(builds.map((build) => build.auth)).toEqual([
            'worker-token',
            'caller-a',
            'caller-b',
        ]);
        expect(builds[0].options).toBeUndefined();
    });

    it('builds nothing for the caller when no token was sent', async () => {
        const { seen } = loadRouter();

        await request(null);
        await request(null);

        expect(builds.map((build) => build.auth)).toEqual(['worker-token']);
        expect(seen[0].requestor).toBeUndefined();
    });
});

describe('the router runtime, CORS on every response', () => {
    const call = (path, method = 'GET') =>
        globalThis.router.route({
            request: new Request(`https://worker.example${path}`, { method }),
        });

    it('marks a 404 for a path no route matches', async () => {
        loadRouter();

        const response = await call('/missing');

        expect(response.status).toBe(404);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('marks a 404 for a method with no routes', async () => {
        loadRouter();

        const response = await call('/ping', 'PUT');

        expect(response.status).toBe(404);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('marks a response whose headers cannot be changed', async () => {
        loadRouter();
        globalThis.router.get('/moved', () =>
            Response.redirect('https://elsewhere.example/', 302),
        );

        const response = await call('/moved');

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://elsewhere.example/');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('sends a rejected puter.js call as JSON, not [object Object]', async () => {
        loadRouter();
        globalThis.router.get('/fails', () => {
            throw { message: 'Not allowed', code: 'forbidden' };
        });

        const response = await call('/fails');

        expect(response.status).toBe(500);
        expect(JSON.parse(await response.text())).toEqual({
            message: 'Not allowed',
            code: 'forbidden',
        });
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('leaves responses alone when CORS handling is off', async () => {
        loadRouter();
        globalThis.router.handleCors = false;

        const response = await call('/missing');

        expect(response.headers.has('access-control-allow-origin')).toBe(false);
    });
});
