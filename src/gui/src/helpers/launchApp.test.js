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

vi.mock('../UI/UIWindow.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./pushSync.js', () => ({ syncBrowserPush: vi.fn() }));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindow } = await import('../UI/UIWindow.js');
const { default: launch_app } = await import('./launchApp.js');

const app = {
    uid: 'app-123',
    name: 'notes',
    title: 'Notes',
    index_url: 'https://notes.example.com/start?mode=1',
};

let register;

beforeEach(() => {
    register = vi.fn();
    globalThis.i18n = key => key;
    globalThis.$ = { ajax: vi.fn() };
    window.Transaction = class { start () {} annotate () {} end () {} };
    window.uuidv4 = () => 'instance-1';
    window.icons = {};
    window.app_domain = 'puter.app';
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'session';
    window.locale = 'en';
    window.launch_apps = { recent: [] };
    window.launch_recent_apps_count = 5;
    window.app_instance_ids = new Set();
    globalThis.services = { get: () => ({ register }) };
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: 'app-token' }),
    })));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('launch_app with a new tab', () => {
    it('sends the tab to index_url with the params an in-page iframe gets', async () => {
        const tab = { location: { href: '' }, close: vi.fn() };
        const outcome = await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });

        const url = new URL(tab.location.href);
        expect(`${url.origin}${url.pathname}`).toBe('https://notes.example.com/start');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'mode': '1',
            'puter.app_instance_id': 'instance-1',
            'puter.app.id': 'app-123',
            'puter.app.name': 'notes',
            'puter.auth.token': 'app-token',
            'puter.domain': 'puter.app',
            'puter.api_origin': 'https://api.puter.test',
            'puter.locale': 'en',
            'puter.args': '{}',
            'utm_source': 'puter.com',
        });
        expect(outcome.launchResult).toMatchObject({ launched: true, openedAppName: 'notes' });
        expect(UIWindow).not.toHaveBeenCalled();
        expect(register).not.toHaveBeenCalled();
        expect(window.app_instance_ids.size).toBe(0);
        expect(window.launch_apps.recent[0].name).toBe('notes');
        expect($.ajax).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.puter.test/rao' }));
    });

    it('leaves the tab alone when the app token is unavailable', async () => {
        fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const tab = { location: { href: '' }, close: vi.fn() };
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const outcome = await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });
        log.mockRestore();

        expect(outcome.launchResult.launched).toBe(false);
        expect(tab.location.href).toBe('');
    });
});
