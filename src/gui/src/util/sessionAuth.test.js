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
import { fetchWithSessionCookieRetry, isSessionAuthError, syncSessionCookie } from './sessionAuth.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

describe('isSessionAuthError', () => {
    it('matches every 401 shape a missing/bad session cookie produces', () => {
        for ( const code of ['token_missing', 'token_auth_failed', 'reauth_required', 'session_required'] ) {
            expect(isSessionAuthError({ status: 401 }, { code })).toBe(true);
        }
    });

    it('rejects other statuses, other codes, and missing data', () => {
        expect(isSessionAuthError({ status: 403 }, { code: 'session_required' })).toBe(false);
        expect(isSessionAuthError({ status: 401 }, { code: 'password_required' })).toBe(false);
        expect(isSessionAuthError({ status: 401 }, null)).toBe(false);
        expect(isSessionAuthError(null, { code: 'session_required' })).toBe(false);
    });
});

describe('syncSessionCookie', () => {
    it('returns false without a bearer token and does not call fetch', async () => {
        let called = false;
        const ok = await syncSessionCookie({
            origin: 'https://puter.test',
            authToken: null,
            fetchFn: () => { called = true; },
        });
        expect(ok).toBe(false);
        expect(called).toBe(false);
    });

    it('calls /session/sync-cookie with the bearer token and cookies', async () => {
        let seen = null;
        const ok = await syncSessionCookie({
            origin: 'https://puter.test',
            authToken: 'tok-123',
            fetchFn: (url, opts) => {
                seen = { url, opts };
                return Promise.resolve({ ok: true });
            },
        });
        expect(ok).toBe(true);
        expect(seen.url).toBe('https://puter.test/session/sync-cookie');
        expect(seen.opts.credentials).toBe('include');
        expect(seen.opts.headers.Authorization).toBe('Bearer tok-123');
    });

    it('returns false on a non-ok response or a network error', async () => {
        expect(await syncSessionCookie({
            origin: 'https://puter.test',
            authToken: 'tok',
            fetchFn: () => Promise.resolve({ ok: false }),
        })).toBe(false);
        expect(await syncSessionCookie({
            origin: 'https://puter.test',
            authToken: 'tok',
            fetchFn: () => Promise.reject(new Error('offline')),
        })).toBe(false);
    });
});

describe('fetchWithSessionCookieRetry', () => {
    it('returns a successful response without syncing', async () => {
        let syncCalled = false;
        const res = await fetchWithSessionCookieRetry(
            () => Promise.resolve(jsonResponse(200, { success: true })),
            { origin: 'https://puter.test', authToken: 'tok', fetchFn: () => { syncCalled = true; } },
        );
        expect(res.ok).toBe(true);
        expect(syncCalled).toBe(false);
    });

    it('retries once after minting the cookie on a session-auth 401', async () => {
        // token_missing is the shape the GUI actually sees when the cookie
        // is absent (the request carries no other credential).
        for ( const code of ['token_missing', 'token_auth_failed', 'session_required'] ) {
            let sends = 0;
            let synced = false;
            const res = await fetchWithSessionCookieRetry(
                () => Promise.resolve(++sends === 1
                    ? jsonResponse(401, { code })
                    : jsonResponse(200, { success: true })),
                {
                    origin: 'https://puter.test',
                    authToken: 'tok',
                    fetchFn: () => {
                        synced = true;
                        return Promise.resolve({ ok: true });
                    },
                },
            );
            expect(synced).toBe(true);
            expect(sends).toBe(2);
            expect(res.ok).toBe(true);
        }
    });

    it('returns the original 401 when the cookie cannot be minted', async () => {
        let sends = 0;
        const res = await fetchWithSessionCookieRetry(
            () => Promise.resolve((sends++, jsonResponse(401, { code: 'session_required' }))),
            { origin: 'https://puter.test', authToken: null },
        );
        expect(sends).toBe(1);
        expect(res.status).toBe(401);
        // Body must still be readable by the caller after the internal peek.
        expect((await res.json()).code).toBe('session_required');
    });

    it('does not retry non-session 401 shapes', async () => {
        let sends = 0;
        let syncCalled = false;
        const res = await fetchWithSessionCookieRetry(
            () => Promise.resolve((sends++, jsonResponse(401, { code: 'unauthorized' }))),
            { origin: 'https://puter.test', authToken: 'tok', fetchFn: () => { syncCalled = true; } },
        );
        expect(sends).toBe(1);
        expect(syncCalled).toBe(false);
        expect(res.status).toBe(401);
    });
});
