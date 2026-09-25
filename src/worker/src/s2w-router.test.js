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
