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

import { describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../UIWindowSaveAccount.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = key => key;
window.icons = {};
window.launch_apps = { recent: [] };

const { default: TabHome } = await import('./TabHome.js');

describe('TabHome recently used', () => {
    const mount = () => {
        document.body.innerHTML = '<div class="window"><div class="bento-recent-apps-container"></div></div>';
        return $('.window');
    };

    it("doesn't call the list empty before it has loaded, and says when it couldn't", async () => {
        const $el_window = mount();
        $el_window.find('.bento-recent-apps-container').html(TabHome.html());
        expect($el_window.text()).not.toContain('no_recent_apps');

        $.ajax = vi.fn(() => Promise.reject(new Error('offline')));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await TabHome.loadRecentApps($el_window);
        expect($el_window.text()).toContain('apps_load_failed');

        $.ajax = vi.fn(async () => ({ recent: [] }));
        await TabHome.loadRecentApps($el_window);
        expect($el_window.text()).toContain('no_recent_apps');
    });
});

describe('TabHome launch apps request', () => {
    it('shares the in-flight request until it settles', async () => {
        document.body.innerHTML =
            '<div class="window"><div class="bento-recent-apps-container"></div></div>';
        let answer;
        const request = new Promise((resolve) => {
            answer = resolve;
        });
        $.ajax = vi.fn(() => request);

        const loading = TabHome.loadRecentApps($('.window'));
        expect(window.launch_apps_request).toBe(request);
        answer({ recommended: [], recent: [] });
        await loading;
        expect(window.launch_apps_request).toBeNull();
    });
});
