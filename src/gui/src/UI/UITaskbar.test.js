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

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../helpers/launchApp.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '');
globalThis.isMobile = { phone: false, tablet: false };
await import('../lib/jquery-ui-1.13.2/jquery-ui.js');
const { default: UITaskbar } = await import('./UITaskbar.js');

let requests;

afterEach(() => {
    $('.taskbar').remove();
    $(document).off();
    $(window).off();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(async () => {
    document.body.innerHTML = '<div class="desktop"></div>';
    Object.assign(window, {
        global_element_id: 0,
        taskbar_height: 50,
        toolbar_height: 0,
        api_origin: 'http://api.test',
        auth_token: 'test-token',
        icons: {},
        user: { taskbar_items: [{ name: 'notes', title: 'Notes' }] },
        trash_path: '/test/Trash',
    });
    vi.stubGlobal('puter', {
        kv: { get: async () => 'bottom' },
        fs: { stat: async () => ({ is_empty: true }) },
    });
    requests = [];
    $.ajaxTransport('+*', (options) => {
        requests.push(options.url);
        return { send () {}, abort () {} };
    });
    await UITaskbar();
});

it('starts the taskbar at Explorer, followed by pinned apps and Trash', () => {
    const apps = $('.taskbar .taskbar-item').map((_, el) => el.dataset.app).get();
    expect(apps).toEqual(['explorer', 'separator', 'notes', 'separator', 'trash']);
});

it('does not fetch launch apps when the taskbar loads', () => {
    expect(requests.filter(url => url.includes('/get-launch-apps'))).toEqual([]);
});
