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

import { describe, it, expect, vi } from 'vitest';
import { mintGodmodeToken, sameTokenRow, shouldRenew } from './godmodeTokens.js';

const HOUR_MS = 60 * 60 * 1000;

const reply = (status, body) =>
    vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }));

const deps = (fetchImpl) => ({
    fetchImpl,
    apiOrigin: 'https://api.test',
    authToken: 'session',
});

describe('shouldRenew', () => {
    it('renews once less than six hours are left', () => {
        const now = Date.now();
        const expiresIn = (ms) => Math.floor((now + ms) / 1000);
        expect(shouldRenew(expiresIn(11 * HOUR_MS), now)).toBe(false);
        expect(shouldRenew(expiresIn(5 * HOUR_MS), now)).toBe(true);
        expect(shouldRenew(expiresIn(-HOUR_MS), now)).toBe(true);
    });

    it('renews a token with no known expiry', () => {
        expect(shouldRenew(NaN, Date.now())).toBe(true);
    });
});

describe('mintGodmodeToken', () => {
    it('returns the app token the server issued', async () => {
        const fetchImpl = reply(200, {
            token: 'jwt',
            app_uid: 'app-1',
            godmode: true,
            expires_at: 123,
        });
        expect(await mintGodmodeToken('app-1', deps(fetchImpl))).toEqual({
            ok: true,
            token: 'jwt',
            expiresAt: 123,
        });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.test/auth/get-user-app-token');
        expect(init.headers.Authorization).toBe('Bearer session');
        expect(JSON.parse(init.body)).toEqual({ app_uid: 'app-1' });
    });

    it('never adopts an ordinary app token for a godmode app', async () => {
        // A server that doesn't treat the app as godmode.
        const fetchImpl = reply(200, { token: 'app-under-user', app_uid: 'app-1' });
        expect(await mintGodmodeToken('app-1', deps(fetchImpl))).toEqual({
            ok: false,
            status: 200,
        });
    });

    it('reports a refusal and a network failure', async () => {
        expect(await mintGodmodeToken('app-1', deps(reply(403, {})))).toEqual({
            ok: false,
            status: 403,
        });
        const failing = vi.fn(async () => {
            throw new Error('offline');
        });
        const result = await mintGodmodeToken('app-1', deps(failing));
        expect(result.ok).toBe(false);
    });
});

describe('sameTokenRow', () => {
    const jwt = (payload) =>
        `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

    it('matches two signings of one token row', () => {
        expect(sameTokenRow(jwt({ token_uid: 't1', iat: 1 }), jwt({ token_uid: 't1', iat: 2 }))).toBe(true);
    });

    it('tells a replacement row apart, and never matches what it cannot read', () => {
        expect(sameTokenRow(jwt({ token_uid: 't1' }), jwt({ token_uid: 't2' }))).toBe(false);
        expect(sameTokenRow(jwt({}), jwt({}))).toBe(false);
        expect(sameTokenRow('garbage', 'garbage')).toBe(false);
    });
});
