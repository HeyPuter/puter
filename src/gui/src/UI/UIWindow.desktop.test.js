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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../helpers/launchApp.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '');
globalThis.isMobile = { phone: false, tablet: false };
globalThis.def = globalThis.def ?? ((value) => value);
await import('../lib/jquery-ui-1.13.2/jquery-ui.js');
// The page loads this plugin from a vendored script; nothing here drops files.
$.fn.dragster = function () {
    return this;
};
const { default: UIWindow } = await import('./UIWindow.js');

const openWindow = (options = {}) => UIWindow({
    title: 'Notes',
    app: 'notes',
    body_content: '<p>hello</p>',
    width: 400,
    height: 300,
    ...options,
});

/** Opens the window head's context menu and returns its item labels. */
const headMenuLabels = (el_window) => {
    $(el_window).find('.window-head').trigger('contextmenu');
    return $('.context-menu .contextmenu-label').map((_, el) => $(el).text().toLowerCase()).get();
};

beforeEach(() => {
    document.body.innerHTML = '<div class="desktop"></div>';
    Object.assign(window, {
        global_element_id: 0,
        window_counter: 0,
        last_window_zindex: 1,
        window_stack: [],
        icons: {},
        uuidv4: () => crypto.randomUUID(),
        is_dashboard_mode: false,
        is_fullpage_mode: false,
        is_embedded: false,
    });
});

afterEach(() => {
    $(document).off();
    document.body.innerHTML = '';
});

describe('minimize', () => {
    it('is not offered on the desktop, where nothing could restore the window', async () => {
        const el_window = await openWindow();

        expect($(el_window).find('.window-minimize-btn').length).toBe(0);

        const labels = headMenuLabels(el_window);
        expect(labels.some((label) => label === 'maximize')).toBe(true);
        expect(labels.some((label) => label === 'minimize')).toBe(false);
    });

    it('is offered on the dashboard, which restores the window from its tile', async () => {
        window.is_dashboard_mode = true;
        const el_window = await openWindow();

        expect($(el_window).find('.window-minimize-btn').length).toBe(1);
        expect(headMenuLabels(el_window).some((label) => label === 'minimize')).toBe(true);
    });

    it('hides the window in place and brings it back', async () => {
        window.is_dashboard_mode = true;
        const el_window = await openWindow();
        const before = { top: el_window.style.top, left: el_window.style.left };

        await $(el_window).hideWindow();
        expect($(el_window).attr('data-is_minimized')).toBe('true');
        expect($(el_window).attr('data-minimized_in_place')).toBe('1');

        await $(el_window).showWindow({ no_history: true });
        expect($(el_window).attr('data-is_minimized')).toBe('false');
        expect({ top: el_window.style.top, left: el_window.style.left }).toEqual(before);
    });
});

describe('backdrop', () => {
    const backdropZ = (el_window) => Number($(el_window).closest('.window-backdrop').css('z-index'));

    it('stays above ordinary windows on the desktop', async () => {
        const el_window = await openWindow({ backdrop: true });

        expect(backdropZ(el_window)).toBeGreaterThan(window.last_window_zindex + 1000);
    });

    it('stacks at the window counter on the dashboard', async () => {
        window.is_dashboard_mode = true;
        const el_window = await openWindow({ backdrop: true });

        expect(backdropZ(el_window)).toBeLessThanOrEqual(window.last_window_zindex);
    });
});
