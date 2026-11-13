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

const UIAlert = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./UI/UIAlert.js', () => ({ default: UIAlert }));
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

describe('update_auth_data', () => {
    beforeEach(() => {
        UIAlert.mockClear();
        localStorage.clear();
        window.user = { uuid: 'old', username: 'old' };
        window.logged_in_users = [];
        window.gui_origin = 'https://puter.test';
        window.available_templates = vi.fn();
        window.icons = { 'profile.svg': '/profile.svg' };
        globalThis.fetch = vi.fn(async () => ({ ok: true }));
        puter.setAuthToken.mockClear();
        puter.auth.getProfile.mockReset();
        puter.auth.getProfile.mockResolvedValue({});
    });

    const storedUsers = () => JSON.parse(localStorage.getItem('logged_in_users'));
    const settle = () => new Promise(resolve => setTimeout(resolve));

    // Sign-in awaits this while its card is still up, over every ordinary window.
    it('raises a failed session-cookie sync above the sign-in card', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error('offline');
        });
        await window.update_auth_data('token', { uuid: 'new', username: 'new' });
        expect(UIAlert).toHaveBeenCalledOnce();
        expect(UIAlert.mock.calls[0][0]).toMatchObject({ stay_on_top: true });
    });

    // The account picker shows pictures from the stored list, not from memory.
    it('stores the loaded profile picture with the signed-in account', async () => {
        puter.auth.getProfile.mockResolvedValue({ picture: 'data:image/png;base64,AAAA' });
        await window.update_auth_data('token-a', { uuid: 'a', username: 'a' });
        await settle();
        expect(storedUsers()).toEqual([
            expect.objectContaining({ uuid: 'a', profile: expect.objectContaining({ picture: 'data:image/png;base64,AAAA' }) }),
        ]);
    });

    it('keeps the stored picture while a refreshed profile is loading', async () => {
        window.logged_in_users = [{ uuid: 'a', username: 'a', profile: { picture: 'data:image/png;base64,AAAA' } }];
        puter.auth.getProfile.mockReturnValue(new Promise(() => {}));
        // a whoami refresh carries no profile
        await window.update_auth_data('token-a', { uuid: 'a', username: 'a' });
        expect(storedUsers()[0].profile.picture).toBe('data:image/png;base64,AAAA');
    });

    it('drops a stored picture the account no longer has', async () => {
        window.logged_in_users = [{ uuid: 'a', username: 'a', profile: { picture: 'data:image/png;base64,AAAA' } }];
        puter.auth.getProfile.mockResolvedValue({ picture: null });
        await window.update_auth_data('token-a', { uuid: 'a', username: 'a' });
        await settle();
        expect(storedUsers()[0].profile.picture).toBeNull();
    });

    it('loads the profile with the new account\'s token', async () => {
        await window.update_auth_data('token-b', { uuid: 'b', username: 'b' });
        expect(puter.setAuthToken.mock.invocationCallOrder[0])
            .toBeLessThan(puter.auth.getProfile.mock.invocationCallOrder[0]);
    });

    it('ignores a profile that arrives after another account signed in', async () => {
        let resolveA;
        puter.auth.getProfile.mockReturnValueOnce(new Promise(resolve => {
            resolveA = resolve;
        }));
        await window.update_auth_data('token-a', { uuid: 'a', username: 'a' });
        await window.update_auth_data('token-b', { uuid: 'b', username: 'b' });
        resolveA({ picture: 'data:image/png;base64,AAAA' });
        await settle();
        expect(storedUsers().find(stored => stored.uuid === 'b').profile.picture).toBeNull();
        expect(window.user.profile.picture).toBeNull();
    });
});
