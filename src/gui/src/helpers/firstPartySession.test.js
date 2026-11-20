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

import { describe, expect, it, vi } from 'vitest';
import { isFirstPartySessionOrigin, signInTokenForOpener } from './firstPartySession.js';

const PAGE = 'https://desk.puter.test';
const listed = [`${PAGE}/`];

const answering = (status, body) => vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    json: async () => body,
}));

describe('isFirstPartySessionOrigin', () => {
    it('matches a listed origin exactly', () => {
        expect(isFirstPartySessionOrigin(PAGE, listed)).toBe(true);
        expect(isFirstPartySessionOrigin(`${PAGE}/some/path`, listed)).toBe(true);
    });

    it('matches nothing else', () => {
        expect(isFirstPartySessionOrigin('http://desk.puter.test', listed)).toBe(false);
        expect(isFirstPartySessionOrigin('https://desk.puter.test:8443', listed)).toBe(false);
        expect(isFirstPartySessionOrigin('https://x.desk.puter.test', listed)).toBe(false);
        expect(isFirstPartySessionOrigin('https://desk.puter.test.evil.example', listed)).toBe(false);
        expect(isFirstPartySessionOrigin('', listed)).toBe(false);
        expect(isFirstPartySessionOrigin(PAGE, null)).toBe(false);
        expect(isFirstPartySessionOrigin(PAGE, [])).toBe(false);
    });
});

describe('signInTokenForOpener', () => {
    const deps = (fetchImpl) => ({
        listed,
        fetchImpl,
        apiOrigin: 'https://api.puter.test',
        authToken: 'gui-token',
    });

    it('hands any other page its app token without asking the server', async () => {
        const fetchImpl = answering(200, { token: 'session-token' });
        const token = await signInTokenForOpener('https://notes.example.com', 'app-token', deps(fetchImpl));
        expect(token).toBe('app-token');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('hands a first-party page the session the server mints for its origin', async () => {
        const fetchImpl = answering(200, { token: 'session-token' });
        const token = await signInTokenForOpener(PAGE, 'app-token', deps(fetchImpl));
        expect(token).toBe('session-token');
        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.puter.test/auth/first-party-session');
        expect(init.headers.Authorization).toBe('Bearer gui-token');
        expect(JSON.parse(init.body)).toEqual({ origin: PAGE });
    });

    it('fails rather than fall back to the app token', async () => {
        await expect(signInTokenForOpener(PAGE, 'app-token', deps(answering(403, { code: 'forbidden' }))))
            .rejects.toThrow();
        await expect(signInTokenForOpener(PAGE, 'app-token', deps(answering(200, {}))))
            .rejects.toThrow();
    });
});
