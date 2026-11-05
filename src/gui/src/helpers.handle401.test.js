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

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowLogin.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.puter = { _cache: { flushall: vi.fn() }, setAuthToken: vi.fn() };

const reload = vi.fn();
Object.defineProperty(window, 'location', { value: { reload, replace: vi.fn(), href: 'https://puter.test/' }, writable: true });

await import('./helpers.js');

const xhr401 = (body) => ({ status: 401, responseJSON: body });

describe('handle401', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        reload.mockClear();
        window.logout = vi.fn();
        window.handleReauthRequired = vi.fn();
        window.auth_token = 'tok';
        window.user = { uuid: 'u1' };
        localStorage.setItem(window.AUTH_TOKEN_KEY_V2, 'tok');
        localStorage.setItem('user', '{}');
        localStorage.setItem('puter.push.device:u1', '{"token":"t"}');
    });

    it('drops the token locally and reloads on a 401 that is not a reauth request', () => {
        window.handle401(xhr401({ code: 'token_auth_failed' }));

        expect(window.logout).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(window.AUTH_TOKEN_KEY_V2)).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();
        expect(window.auth_token).toBeNull();
        expect(window.user).toBeNull();
        // Other local state, like a push registration record, is kept.
        expect(localStorage.getItem('puter.push.device:u1')).toBe('{"token":"t"}');
    });

    it('routes a reauth request to the reauth flow without signing out', () => {
        window.handle401(xhr401({ code: 'reauth_required', reason: 'session_expired', auth_id: 'a1' }));

        expect(window.handleReauthRequired).toHaveBeenCalledWith({ reason: 'session_expired', auth_id: 'a1' });
        expect(window.logout).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(localStorage.getItem(window.AUTH_TOKEN_KEY_V2)).toBe('tok');
    });

    it('signs out for real when a 401 follows a local sign-out in the same tab', () => {
        window.handle401(xhr401({ code: 'token_auth_failed' }));
        expect(window.logout).not.toHaveBeenCalled();

        window.handle401(xhr401({ code: 'token_auth_failed' }));
        expect(window.logout).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('treats an old local sign-out as forgotten', () => {
        sessionStorage.setItem('puter.local_sign_out_at', String(Date.now() - 10 * 60 * 1000));

        window.handle401(xhr401({ code: 'token_auth_failed' }));

        expect(window.logout).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('mirrors a peer tab signing out without ending the session itself', () => {
        window.dispatchEvent(new StorageEvent('storage', { key: window.AUTH_TOKEN_KEY_V2, newValue: null }));

        expect(window.logout).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(window.AUTH_TOKEN_KEY_V2)).toBeNull();
    });
});
