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
vi.mock('./appTabLaunch.js', () => ({ offerAppTabLaunch: vi.fn() }));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindow } = await import('../UI/UIWindow.js');
const { default: UIAlert } = await import('../UI/UIAlert.js');
const { offerAppTabLaunch } = await import('./appTabLaunch.js');
const { default: launch_app } = await import('./launchApp.js');

const app = {
    uid: 'app-123',
    name: 'notes',
    title: 'Notes',
    index_url: 'https://notes.example.com/start?mode=1',
};

let register;
let transactions;

beforeEach(() => {
    register = vi.fn();
    globalThis.i18n = key => key;
    globalThis.$ = { ajax: vi.fn() };
    transactions = [];
    window.Transaction = class {
        constructor (name, attributes) {
            this.name = name;
            this.attributes = { ...attributes };
            transactions.push(this);
        }
        start () {}
        annotate (attributes) {
            Object.assign(this.attributes, attributes);
        }
        end () {}
    };
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
    delete window.is_dashboard_mode;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('launch_app with a new tab', () => {
    it('sends the tab to index_url with the params an in-page iframe gets, minus the token', async () => {
        const tab = { location: { href: '' }, close: vi.fn() };
        const outcome = await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });

        const url = new URL(tab.location.href);
        expect(`${url.origin}${url.pathname}`).toBe('https://notes.example.com/start');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'mode': '1',
            'puter.app_instance_id': 'instance-1',
            'puter.app.id': 'app-123',
            'puter.app.name': 'notes',
            'puter.domain': 'puter.app',
            'puter.api_origin': 'https://api.puter.test',
            'puter.locale': 'en',
            'puter.args': '{}',
            'utm_source': 'puter.com',
        });
        expect(url.searchParams.has('puter.auth.token')).toBe(false);
        expect(offerAppTabLaunch).toHaveBeenCalledWith({
            appInstanceID: 'instance-1',
            tab,
            origin: 'https://notes.example.com',
            token: 'app-token',
            item: null,
        });
        expect(outcome.launchResult).toMatchObject({ launched: true, openedAppName: 'notes' });
        expect(UIWindow).not.toHaveBeenCalled();
        expect(register).not.toHaveBeenCalled();
        expect(window.app_instance_ids.size).toBe(0);
        expect(window.launch_apps.recent[0].name).toBe('notes');
        expect($.ajax).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.puter.test/rao' }));
    });

    it.each([
        [false, 'desktop'],
        [true, 'dashboard'],
    ])('tags the launch with the surface it came from (dashboard mode: %s)', async (dashboardMode, campaign) => {
        window.is_dashboard_mode = dashboardMode;
        const tab = { location: { href: '' }, close: vi.fn() };
        await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });

        const url = new URL(tab.location.href);
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'utm_source': 'puter.com',
            'utm_medium': 'referral',
            'utm_campaign': campaign,
        });
    });

    it('counts the launch as one with no interactive span to wait for', async () => {
        const tab = { location: { href: '' }, close: vi.fn() };
        await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });

        const ready = transactions.find(t => t.name === 'app-is-ready');
        expect(ready.attributes).toMatchObject({
            'launch.ipc_tracked': false,
            outcome: 'opened-in-new-tab',
        });
    });

    it('hands the opened file over with the token, keeping its signed URLs out of the tab URL', async () => {
        const tab = { location: { href: '' }, close: vi.fn() };
        window.privacy_aware_path = p => p;
        await launch_app({
            name: 'notes',
            app_obj: { ...app },
            newTab: tab,
            file_path: '~/notes.txt',
            token: 'file-token',
            file_signature: {
                uid: 'file-1',
                fsentry_name: 'notes.txt',
                read_url: 'https://api.puter.test/file?signature=r',
                write_url: 'https://api.puter.test/writeFile?signature=w',
                metadata_url: 'https://api.puter.test/itemMetadata?signature=r',
            },
        });

        const url = new URL(tab.location.href);
        expect([...url.searchParams.keys()].filter(k => k.startsWith('puter.item.'))).toEqual(['puter.item.uid']);
        expect(url.searchParams.get('puter.item.uid')).toBe('file-1');
        expect(offerAppTabLaunch).toHaveBeenCalledWith(expect.objectContaining({
            token: 'file-token',
            item: expect.objectContaining({
                'puter.item.uid': 'file-1',
                'puter.item.name': 'notes.txt',
                'puter.item.path': '~/notes.txt',
                'puter.item.read_url': 'https://api.puter.test/file?signature=r',
                'puter.item.write_url': 'https://api.puter.test/writeFile?signature=w',
            }),
        }));
    });

    it('closes the tab when the app token is unavailable', async () => {
        fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const tab = { location: { href: '' }, close: vi.fn() };
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const outcome = await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });
        log.mockRestore();

        expect(outcome.launchResult.launched).toBe(false);
        expect(tab.location.href).toBe('');
        expect(tab.close).toHaveBeenCalled();
        expect(offerAppTabLaunch).not.toHaveBeenCalled();
    });

    it('calls the launch off when the user closed the tab meanwhile', async () => {
        const tab = { location: { href: '' }, close: vi.fn(), closed: true };
        const outcome = await launch_app({ name: 'notes', app_obj: { ...app }, newTab: tab });

        expect(outcome.launchResult.launched).toBe(false);
        expect(tab.location.href).toBe('');
        expect(offerAppTabLaunch).not.toHaveBeenCalled();
        expect(window.launch_apps.recent).toEqual([]);
        expect($.ajax).not.toHaveBeenCalled();
        expect(UIAlert).not.toHaveBeenCalled();
    });

    it.each([
        ['the app token is unavailable', { ...app }, () => {
            fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        }],
        ['access to a private app is denied', {
            ...app,
            privateAccess: { hasAccess: false },
        }, () => {}],
    ])('closes the tab before alerting that %s', async (_label, app_obj, arrange) => {
        arrange();
        const tab = { location: { href: '' }, close: vi.fn() };
        let tabClosedAtAlert;
        UIAlert.mockImplementation(async () => {
            tabClosedAtAlert = tab.close.mock.calls.length > 0;
        });
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const outcome = await launch_app({ name: 'notes', app_obj, newTab: tab });
        log.mockRestore();

        expect(outcome.launchResult.launched).toBe(false);
        expect(UIAlert).toHaveBeenCalledOnce();
        expect(tabClosedAtAlert).toBe(true);
    });

    it('closes the tab and opens a built-in app in-page', async () => {
        const tab = { location: { href: '' }, close: vi.fn() };
        const builtin = { ...app, index_url: 'https://builtins.namespaces.puter.com/dev-center' };
        window.gui_origin = 'https://puter.test';
        // Everything after the window opens isn't what this test is about.
        UIWindow.mockImplementation(() => {
            throw new Error('in-page window');
        });
        await expect(launch_app({ name: 'notes', app_obj: builtin, newTab: tab }))
            .rejects.toThrow('in-page window');

        expect(tab.close).toHaveBeenCalled();
        expect(tab.location.href).toBe('');
        expect(UIWindow).toHaveBeenCalledWith(expect.objectContaining({
            iframe_url: expect.stringContaining('puter.auth.token=app-token'),
        }));
    });
});
