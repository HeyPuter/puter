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

window.api_origin = 'https://api.puter.test';
window.auth_token = 'tok-1';
window.gui_params = { pushEnabled: true };

const fakeClient = (status) => ({
    enable: vi.fn(async () => ({ deviceUid: 'dev-new' })),
    disable: vi.fn(async () => {}),
    status: vi.fn(async () => status),
});

const granted = { permission: 'granted' };
const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });

/** Answers each `METHOD path` from `routes`; anything else is a 404. */
const serve = (routes) => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
        const handler = routes[`${init.method ?? 'GET'} ${new URL(url).pathname}`];
        if ( ! handler ) return reply(404, { code: 'not_found' });
        return typeof handler === 'function' ? handler(init) : reply(200, handler);
    });
};

let syncBrowserPush;
let registerPushClient;

beforeEach(async () => {
    vi.resetModules();
    ({ syncBrowserPush } = await import('./pushSync.js'));
    ({ registerPushClient } = await import('./pushClient.js'));
    localStorage.clear();
    serve({});
});

const off = () => {
    const client = fakeClient({ permission: 'granted', registered: false });
    registerPushClient(client);
    return client;
};

describe('syncBrowserPush', () => {
    it('registers this browser again when an app may send pushes', async () => {
        const client = off();
        const holdsPush = vi.fn(async () => true);
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush })).resolves.toBe('on');
        expect(client.enable).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no app may send pushes', async () => {
        const client = off();
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => false })).resolves.toBe('no_app');
        expect(client.enable).not.toHaveBeenCalled();
    });

    it.each([
        ['the browser has not granted notifications', { NotificationApi: { permission: 'default' }, userUid: 'u-1' }],
        ['nobody is signed in', { NotificationApi: granted, userUid: undefined }],
    ])('does nothing when %s', async (_label, deps) => {
        const client = off();
        await expect(syncBrowserPush({}, { ...deps, holdsPush: async () => true })).resolves.toBe('skipped');
        expect(client.status).not.toHaveBeenCalled();
        expect(client.enable).not.toHaveBeenCalled();
    });

    it('leaves a browser the user turned off alone', async () => {
        const client = off();
        localStorage.setItem('puter.push.browser-off:u-1', '1');
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => true })).resolves.toBe('opted_out');
        expect(client.status).not.toHaveBeenCalled();
        expect(client.enable).not.toHaveBeenCalled();
    });

    it('keeps another user\'s opt-out to that user', async () => {
        const client = off();
        localStorage.setItem('puter.push.browser-off:u-2', '1');
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => true })).resolves.toBe('on');
        expect(client.enable).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['on', { permission: 'granted', registered: true, deviceUid: 'dev-1' }],
        ['blocked', { permission: 'denied', registered: false }],
    ])('reports %s and does not register again', async (state, status) => {
        const client = fakeClient(status);
        registerPushClient(client);
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => true })).resolves.toBe(state);
        expect(client.enable).not.toHaveBeenCalled();
    });

    it('reports unavailable without a client', async () => {
        window.gui_params = { pushEnabled: false };
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => true })).resolves.toBe('unavailable');
        window.gui_params = { pushEnabled: true };
    });

    it('reports failed when registering fails or the app check fails', async () => {
        const client = off();
        client.enable.mockRejectedValue(new Error('no_worker'));
        const quiet = [vi.spyOn(console, 'debug'), vi.spyOn(console, 'warn')].map(spy => spy.mockImplementation(() => {}));
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => true })).resolves.toBe('failed');
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1', holdsPush: async () => {
            throw new Error('down');
        } })).resolves.toBe('failed');
        for ( const spy of quiet ) spy.mockRestore();
    });

    it('asks the server about the launched app', async () => {
        const client = off();
        const check = vi.fn((init) => reply(200, { permissions: Object.fromEntries(JSON.parse(init.body).permissions.map(p => [p, true])) }));
        serve({ 'POST /auth/check-permissions': check });

        await expect(syncBrowserPush({ appUid: 'app-1' }, { NotificationApi: granted, userUid: 'u-1' })).resolves.toBe('on');
        expect(JSON.parse(check.mock.calls[0][0].body)).toEqual({ permissions: ['notifications:push'], app_uid: 'app-1' });
        expect(client.enable).toHaveBeenCalledTimes(1);
    });

    it('asks the server for the apps that may send pushes when no app is named', async () => {
        const client = off();
        serve({ 'GET /push/apps': { apps: [{ uid: 'app-1', name: 'chat' }] } });
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1' })).resolves.toBe('on');
        expect(client.enable).toHaveBeenCalledTimes(1);

        serve({ 'GET /push/apps': { apps: [] } });
        await expect(syncBrowserPush({}, { NotificationApi: granted, userUid: 'u-1' })).resolves.toBe('no_app');
    });
});
