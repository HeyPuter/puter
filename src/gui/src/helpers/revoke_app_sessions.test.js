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

import { describe, it, expect } from 'vitest';
import { appSessionUuids, revokeAppSessions } from './revoke_app_sessions.js';

const APP = 'app-1111';

// A list-sessions payload covering every row kind that carries an app_uid.
const sessions = [
    { uuid: 'web-1', kind: 'web', app_uid: null },
    { uuid: 'app-a', kind: 'app', app_uid: APP },
    { uuid: 'app-b', kind: 'app', app_uid: APP },
    { uuid: 'other', kind: 'app', app_uid: 'app-2222' },
    { uuid: 'wrk-1', kind: 'worker', app_uid: APP },
    { uuid: 'tok-1', kind: 'access_token', app_uid: APP },
];

describe('appSessionUuids', () => {
    it("picks only the app's own app-kind rows", () => {
        expect(appSessionUuids(sessions, APP)).toEqual(['app-a', 'app-b']);
    });

    it('leaves worker rows alone — they are deployment credentials', () => {
        expect(appSessionUuids(sessions, APP)).not.toContain('wrk-1');
    });

    it('returns empty for a missing uid or a non-array payload', () => {
        expect(appSessionUuids(sessions, '')).toEqual([]);
        expect(appSessionUuids(null, APP)).toEqual([]);
        expect(appSessionUuids({ error: 'nope' }, APP)).toEqual([]);
    });
});

// Minimal fetch double: records calls and answers by URL.
const makeFetch = ({ list = sessions, listOk = true, revokeStatus = 200 } = {}) => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
        if ( url.endsWith('/auth/list-sessions') ) {
            return { ok: listOk, status: listOk ? 200 : 500, json: async () => list };
        }
        const status = typeof revokeStatus === 'function' ? revokeStatus(calls.length) : revokeStatus;
        return { ok: status >= 200 && status < 300, status };
    };
    return { fetchImpl, calls };
};

const deps = (over = {}) => ({
    antiCsrfToken: async () => 'csrf-token',
    apiOrigin: 'https://api.test',
    authToken: 'auth-token',
    ...over,
});

describe('revokeAppSessions', () => {
    it("revokes each of the app's sessions and reports the count", async () => {
        const { fetchImpl, calls } = makeFetch();
        const revoked = await revokeAppSessions(APP, deps({ fetchImpl }));

        expect(revoked).toBe(2);
        const revokes = calls.filter(c => c.url.endsWith('/auth/revoke-session'));
        expect(revokes.map(c => c.body.uuid)).toEqual(['app-a', 'app-b']);
    });

    it('sends an anti-csrf token with every revoke — they are single-use', async () => {
        const { fetchImpl, calls } = makeFetch();
        let issued = 0;
        await revokeAppSessions(APP, deps({
            fetchImpl,
            antiCsrfToken: async () => `csrf-${++issued}`,
        }));

        const tokens = calls
            .filter(c => c.url.endsWith('/auth/revoke-session'))
            .map(c => c.body.anti_csrf);
        expect(tokens).toEqual(['csrf-1', 'csrf-2']);
    });

    it('makes no revoke call when the app has no sessions', async () => {
        const { fetchImpl, calls } = makeFetch({ list: [{ uuid: 'web-1', kind: 'web' }] });
        expect(await revokeAppSessions(APP, deps({ fetchImpl }))).toBe(0);
        expect(calls.some(c => c.url.endsWith('/auth/revoke-session'))).toBe(false);
    });

    it('counts a 404 as done — the row already went away', async () => {
        const { fetchImpl } = makeFetch({ revokeStatus: 404 });
        expect(await revokeAppSessions(APP, deps({ fetchImpl }))).toBe(2);
    });

    it('keeps going after one row fails, and reports the shortfall', async () => {
        // First revoke 500s, second succeeds.
        let n = 0;
        const { fetchImpl, calls } = makeFetch({ revokeStatus: () => (++n === 1 ? 500 : 200) });
        const revoked = await revokeAppSessions(APP, deps({ fetchImpl }));

        expect(revoked).toBe(1);
        expect(calls.filter(c => c.url.endsWith('/auth/revoke-session'))).toHaveLength(2);
    });

    it('throws when the session list cannot be read', async () => {
        const { fetchImpl } = makeFetch({ listOk: false });
        await expect(revokeAppSessions(APP, deps({ fetchImpl }))).rejects.toThrow(
            /Failed to list sessions/,
        );
    });

    it('does nothing without an app uid', async () => {
        const { fetchImpl, calls } = makeFetch();
        expect(await revokeAppSessions('', deps({ fetchImpl }))).toBe(0);
        expect(calls).toHaveLength(0);
    });
});
