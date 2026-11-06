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

// Shared jsdom setup for the auth dialog tests: the globals the GUI
// installs at boot, reset between tests.

import { vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.def = globalThis.def ?? ((value) => value);
globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, args) => (Array.isArray(args) && args.length ? `${key}:${args.join(',')}` : key);
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A JSON fetch response. */
export const reply = (status, data) => new Response(JSON.stringify(data), { status });

/** Resets the boot globals the screens read. */
export const resetAuthGlobals = () => {
    document.body.innerHTML = '';
    window.gui_origin = 'https://puter.test';
    window.api_origin = 'https://api.puter.test';
    window.app_domain = 'puter.com';
    window.gui_params = {};
    window.icons = {};
    window.uuidv4 = () => `id-${Math.random().toString(36).slice(2)}`;
    window.is_email = (value) => String(value).includes('@');
    window.embedded_in_popup = false;
    window.gui_action = undefined;
    window.openerOrigin = undefined;
    window.referrerStr = undefined;
    window.signup_bonus_code = null;
    window.url_query_params = new URLSearchParams('');
    window.custom_headers = undefined;
    window.turnstile = undefined;
    window.logged_in_users = [];
    window.auth_token = undefined;
    window.update_auth_data = vi.fn(async () => {});
    globalThis.fetch = vi.fn(async () => reply(200, { providers: [] }));
};

/** The screen showing in the auth card. */
export const screen = () => $('.auth-dialog .auth-screen:not([hidden])');
