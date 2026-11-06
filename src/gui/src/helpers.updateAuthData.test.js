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
    });

    // Sign-in awaits this while its card is still up, over every ordinary window.
    it('raises a failed session-cookie sync above the sign-in card', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error('offline');
        });
        await window.update_auth_data('token', { uuid: 'new', username: 'new' });
        expect(UIAlert).toHaveBeenCalledOnce();
        expect(UIAlert.mock.calls[0][0]).toMatchObject({ stay_on_top: true });
    });
});
