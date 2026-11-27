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
import { adoptBorrowedSession, frameSessionIsBorrowed, savedAccountSession, storeBorrowedAccount } from './borrowedFrameSession.js';

const API = 'https://api.puter.test';
const PAGE = 'https://docs.puter.test';
const ALICE = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';
const BOB = '7d3e2f10-8a4b-4c6d-9e1f-0a2b3c4d5e6f';

const savedUsers = [
    { uuid: BOB, username: 'bob', auth_token: 'bob-token' },
    { uuid: ALICE.toUpperCase(), username: 'alice', auth_token: 'alice-token' },
];

/** An API that knows each token's user and which of them signed in to PAGE. */
const fakeApi = ({ users = { 'alice-token': ALICE, 'bob-token': BOB }, signedInToPage = [ALICE], down = false, whoami = {} } = {}) =>
    vi.fn(async (url, init = {}) => {
        if ( down ) throw new TypeError('Failed to fetch');
        const token = init.headers?.Authorization?.replace(/^Bearer /, '');
        const uuid = users[token];
        if ( ! uuid ) return { ok: false, status: 401, json: async () => ({}) };
        const { pathname } = new URL(url);
        if ( pathname === '/whoami' ) {
            return { ok: true, status: 200, json: async () => ({ uuid, username: uuid === ALICE ? 'alice' : 'bob', ...whoami }) };
        }
        if ( pathname === '/auth/check-app' ) {
            const { origin } = JSON.parse(init.body);
            return { ok: true, status: 200, json: async () => ({ authenticated: origin === PAGE && signedInToPage.includes(uuid) }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    });

const lookUp = (fetchImpl, overrides = {}) => savedAccountSession({
    hostUser: ALICE,
    savedUsers,
    hostOrigin: PAGE,
    apiOrigin: API,
    fetchImpl,
    ...overrides,
});

describe('savedAccountSession', () => {
    it('returns the saved token and user of the account the page is signed in as', async () => {
        const fetchImpl = fakeApi();
        const session = await lookUp(fetchImpl);
        expect(session).toEqual({ token: 'alice-token', user: { uuid: ALICE, username: 'alice' } });
        const [, checkApp] = fetchImpl.mock.calls[1];
        expect(checkApp.headers.Authorization).toBe('Bearer alice-token');
        expect(JSON.parse(checkApp.body)).toEqual({ origin: PAGE });
    });

    it('sends both checks at once', async () => {
        const answer = fakeApi();
        const pending = [];
        const fetchImpl = vi.fn((...args) => new Promise(resolve => pending.push(() => resolve(answer(...args)))));
        const session = lookUp(fetchImpl);
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
        pending.forEach(release => release());
        expect(await session).toMatchObject({ token: 'alice-token' });
    });

    it('returns null for an account that is not saved in this browser', async () => {
        const fetchImpl = fakeApi();
        expect(await lookUp(fetchImpl, { savedUsers: [savedUsers[0]] })).toBeNull();
        expect(await lookUp(fetchImpl, { savedUsers: null })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns null when the saved token no longer signs in', async () => {
        expect(await lookUp(fakeApi({ users: { 'bob-token': BOB } }))).toBeNull();
    });

    it('returns null when the saved token belongs to someone else', async () => {
        expect(await lookUp(fakeApi({ users: { 'alice-token': BOB } }))).toBeNull();
    });

    it('returns null for an account that never signed in to the page', async () => {
        expect(await lookUp(fakeApi({ signedInToPage: [] }))).toBeNull();
        expect(await lookUp(fakeApi(), { hostOrigin: 'https://sheets.puter.test' })).toBeNull();
    });

    // The password change authenticates with the session cookie, which is the active account's.
    it('returns null for an account that has to change its password', async () => {
        expect(await lookUp(fakeApi({ whoami: { requires_password_change: true } }))).toBeNull();
    });

    it('returns null without a host user or origin', async () => {
        const fetchImpl = fakeApi();
        expect(await lookUp(fetchImpl, { hostUser: null })).toBeNull();
        expect(await lookUp(fetchImpl, { hostOrigin: undefined })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns null rather than rejecting when the API is unreachable', async () => {
        expect(await lookUp(fakeApi({ down: true }))).toBeNull();
    });
});

describe('storeBorrowedAccount', () => {
    const storage = (value) => {
        const items = new Map([['logged_in_users', value]]);
        return { getItem: key => items.get(key) ?? null, setItem: vi.fn((key, v) => items.set(key, v)) };
    };

    it('replaces only its own entry', () => {
        const store = storage(JSON.stringify(savedUsers));
        storeBorrowedAccount({ uuid: BOB, username: 'bob', auth_token: 'bob-token-2' }, store);
        expect(JSON.parse(store.getItem('logged_in_users'))).toEqual([
            { uuid: BOB, username: 'bob', auth_token: 'bob-token-2' },
            savedUsers[1],
        ]);
    });

    it('writes nothing when the list is missing, unreadable or lacks the account', () => {
        for ( const value of [null, '{not json', JSON.stringify({}), JSON.stringify([savedUsers[1]])] ) {
            const store = storage(value);
            storeBorrowedAccount({ uuid: BOB, auth_token: 'bob-token' }, store);
            expect(store.setItem).not.toHaveBeenCalled();
        }
    });
});

describe('adoptBorrowedSession', () => {
    // The boot's account checks read window.user before update_auth_data runs.
    it('sends the saved token as the saved user and marks the session as borrowed', () => {
        const setAuthToken = vi.fn();
        const win = { auth_token: 'bob-token', user: { uuid: BOB, email: 'bob@puter.test' }, api_origin: API, puter: { setAuthToken } };
        expect(frameSessionIsBorrowed()).toBe(false);
        adoptBorrowedSession({ token: 'alice-token', user: { uuid: ALICE, email: 'alice@puter.test' } }, win);
        expect(frameSessionIsBorrowed()).toBe(true);
        expect(win.auth_token).toBe('alice-token');
        expect(win.user).toEqual({ uuid: ALICE, email: 'alice@puter.test' });
        expect(setAuthToken).toHaveBeenCalledWith('alice-token', API);
    });
});
