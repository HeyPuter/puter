// @vitest-environment jsdom
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { adoptBorrowedSession } from './helpers/borrowedFrameSession.js';

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('./UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./UI/Auth/UIAuthLogin.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));
vi.mock('./helpers/updateUsernameInGui.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.puter = {
    _cache: { flushall: vi.fn() },
    setAuthToken: vi.fn(),
    auth: { getProfile: vi.fn(async () => ({})) },
};

await import('./helpers.js');

const BOB = { uuid: 'bob', username: 'bob' };
const ALICE = { uuid: 'alice', username: 'alice' };

// A frame running as Alice, a saved account, while Bob is the active one.
describe('a frame running as a saved account', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('auth_token_v2', 'bob-token');
        localStorage.setItem('user', JSON.stringify(BOB));
        window.user = { ...BOB };
        window.logged_in_users = [{ ...BOB, auth_token: 'bob-token' }, { ...ALICE, auth_token: 'alice-token' }];
        window.gui_origin = 'https://puter.test';
        window.icons = { 'profile.svg': '/profile.svg' };
        globalThis.fetch = vi.fn(async () => ({ ok: true }));
        window.close = vi.fn();
        adoptBorrowedSession({ token: 'alice-token' });
    });

    it("leaves the active account's stored session and cookie alone", async () => {
        await window.update_auth_data('alice-token', { ...ALICE, subscribed: true });
        expect(localStorage.getItem('auth_token_v2')).toBe('bob-token');
        expect(JSON.parse(localStorage.getItem('user'))).toEqual(BOB);
        expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/session/sync-cookie'), expect.anything());
        expect(window.user).toMatchObject({ uuid: 'alice', subscribed: true });
    });

    it('updates its own saved copy', async () => {
        await window.update_auth_data('alice-token', { ...ALICE, subscribed: true });
        const saved = JSON.parse(localStorage.getItem('logged_in_users'));
        expect(saved.find(user => user.uuid === 'alice')).toMatchObject({ subscribed: true, auth_token: 'alice-token' });
        expect(saved.find(user => user.uuid === 'bob')).toMatchObject({ auth_token: 'bob-token' });
    });

    it("ignores the active account's session changing in another tab", () => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token_v2', newValue: null }));
        expect(window.auth_token).toBe('alice-token');
        expect(window.close).not.toHaveBeenCalled();
    });

    it("closes instead of signing out the active account", () => {
        window.sign_out_locally();
        window.logout();
        expect(window.close).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('auth_token_v2')).toBe('bob-token');
        expect(localStorage.getItem('user')).not.toBeNull();
    });
});
