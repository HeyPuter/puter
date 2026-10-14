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
vi.mock('./UIContextMenu.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = (key) => (key === 'start' ? 'Start' : key);
globalThis.html_encode = (value) => String(value ?? '');
globalThis.isMobile = { phone: false, tablet: false };
await import('../lib/jquery-ui-1.13.2/jquery-ui.js');
const { default: UITaskbar } = await import('./UITaskbar.js');

const app = { name: 'test-app', uuid: 'test-uid', title: 'Test app' };
let launchApps;
let start;
let requests;
let exerciseXhr;

afterEach(() => {
    $('.popover-launcher, .taskbar').remove();
    $(document).off();
    $(window).off();
    document.body.innerHTML = '';
    delete window.launch_apps;
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
        user: {},
        launch_recent_apps_count: 10,
    });
    vi.stubGlobal('puter', {
        kv: { get: async () => 'bottom' },
        fs: { stat: async () => ({ is_empty: true }) },
    });
    launchApps = { recent: [app], recommended: [] };
    requests = [];
    exerciseXhr = false;
    $.ajaxTransport('+*', (options) => {
        let complete;
        const request = {
            send(headers, done) {
                complete = done;
                if (exerciseXhr) options.xhr();
            },
            abort: vi.fn(),
            resolve(data) {
                complete(
                    200,
                    'OK',
                    { text: JSON.stringify(data) },
                    'Content-Type: application/json',
                );
            },
        };
        requests.push(request);
        return request;
    });
    await UITaskbar();
    requests[0].resolve(launchApps);
    start = $('.taskbar-item[data-name="Start"]');
});

it.each([true, false])(
    'keeps cached search usable after a timeout, cached=%s',
    async (cached) => {
        if (!cached) window.launch_apps = [];
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers();
        start.trigger('click');
        await vi.advanceTimersByTimeAsync(30000);
        expect(requests.at(-1).abort).toHaveBeenCalledOnce();
        expect($('.launch-search')).toHaveLength(1);
        expect($('.start-app')).toHaveLength(cached ? 1 : 0);
    },
);

function deferRefresh() {
    return (data) => requests.at(-1).resolve(data);
}

it('refreshes reopened Start without losing cached tiles or search input', async () => {
    const survivor = {
        name: 'survivor',
        uuid: 'survivor-uid',
        title: 'Survivor',
    };
    launchApps.recent.push(survivor);
    start.trigger('click');
    requests.at(-1).resolve(launchApps);
    start.trigger('click');
    const resolve = deferRefresh();
    start.trigger('click');
    const input = $('.launch-search').get(0);
    expect(input).toBeDefined();
    expect($('.start-app[data-app-name="test-app"]')).toHaveLength(1);
    input.value = 'notes';
    const onChange = vi.fn();
    $(input).on('change', onChange);
    resolve({
        recent: [survivor],
        recommended: [{ name: 'notes', uuid: 'notes-uid', title: 'Notes' }],
    });
    await vi.waitFor(() =>
        expect($('.start-app[data-app-name="notes"]')).toHaveLength(1),
    );
    expect($('.launch-search').get(0)).toBe(input);
    expect(input.value).toBe('notes');
    expect(document.activeElement).toBe(input);
    expect(onChange).toHaveBeenCalledOnce();
    expect($('.start-app[data-app-name="survivor"]')).toHaveLength(1);
    expect($('.start-app[data-app-name="test-app"]')).toHaveLength(0);
});

it('cancels closed menus and ignores their late responses', () => {
    start.trigger('click');
    const old = requests.at(-1);
    start.trigger('click');
    expect(old.abort).toHaveBeenCalledOnce();
    start.trigger('click');
    requests.at(-1).resolve({ recent: [], recommended: [] });
    old.resolve({ recent: [app], recommended: [] });
    expect(window.launch_apps.recent).toHaveLength(0);
    expect($('.start-app')).toHaveLength(0);
});

it('cancels the startup request when Start opens', async () => {
    requests = [];
    document.body.innerHTML = '<div class="desktop"></div>';
    await UITaskbar();
    const startup = requests[0];
    $('.taskbar-item[data-name="Start"]').trigger('click');
    expect(startup.abort).toHaveBeenCalledOnce();
});

it('aborts an oversized download without replacing cached apps', () => {
    let onProgress;
    const xhr = {
        addEventListener: (event, listener) => {
            onProgress = listener;
        },
        abort: vi.fn(),
    };
    vi.spyOn($.ajaxSettings, 'xhr').mockReturnValue(xhr);
    exerciseXhr = true;
    start.trigger('click');
    onProgress({ loaded: 1048576 });
    expect(xhr.abort).not.toHaveBeenCalled();
    onProgress({ loaded: 1048577 });
    expect(xhr.abort).toHaveBeenCalledOnce();
    expect($('.start-app[data-app-name="test-app"]')).toHaveLength(1);
    expect(window.launch_apps.recent).toEqual([app]);
});
