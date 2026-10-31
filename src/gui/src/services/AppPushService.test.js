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

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `definitions.js` reads the class registry the bundle installs at boot.
globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));

let AppPushService;
let registerPushClient;
/** What this browser's push client reports. */
let browser;
/** What `/auth/check-permissions` answers for `notifications:push`. */
let held;

beforeAll(async () => {
    globalThis.window = globalThis.window ?? globalThis;
    ({ registerPushClient } = await import('../helpers/pushClient.js'));
    ({ AppPushService } = await import('./AppPushService.js'));
});

const makeService = async () => {
    const svc = new AppPushService();
    const handlers = {};
    const ipc = { register_ipc_handler: (name, spec) => { handlers[name] = spec.handler; } };
    await svc.init({ services: { get: (name) => (name === 'ipc' ? ipc : {}) } });
    return handlers;
};

/** The IPC context of a call from the app whose window says `app_uid`. */
const from = (app_uid) => ({
    ipc_context: { caller: { app: { window: { attr: (name) => (name === 'data-app_uuid' ? app_uid : undefined) } } } },
});

beforeEach(() => {
    browser = { permission: 'granted', registered: true };
    held = true;
    window.gui_params = { pushEnabled: true };
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'tok-1';
    registerPushClient({
        enable: async () => ({ deviceUid: 'd-1' }),
        disable: async () => {},
        status: async () => {
            if ( browser.broken ) throw new Error('no push service');
            return { ...browser };
        },
    });
    globalThis.fetch = vi.fn(async (url, init) => {
        if ( url.endsWith('/auth/check-permissions') ) {
            return { ok: true, json: async () => ({ permissions: { 'notifications:push': held } }) };
        }
        return { ok: true, json: async () => ({}) };
    });
});

const routes = () => fetch.mock.calls.map(([url]) => new URL(url).pathname);

describe('the pushStatus IPC handler', () => {
    it('is on while push is on here and the calling app may send pushes', async () => {
        const { pushStatus } = await makeService();
        await expect(pushStatus({}, from('app-1'))).resolves.toEqual({ state: 'on' });
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
            permissions: ['notifications:push'],
            app_uid: 'app-1',
        });
    });

    it('is off for an app without the permission', async () => {
        held = false;
        const { pushStatus } = await makeService();
        await expect(pushStatus({}, from('app-1'))).resolves.toEqual({ state: 'off' });
    });

    it.each([
        ['off', () => {
            browser.registered = false;
        }],
        ['blocked', () => {
            browser.permission = 'denied';
        }],
        ['unavailable', () => {
            browser.broken = true;
        }],
    ])('is %s from the browser alone, without asking the server', async (state, setUp) => {
        setUp();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { pushStatus } = await makeService();
        await expect(pushStatus({}, from('app-1'))).resolves.toEqual({ state });
        expect(routes()).toEqual([]);
        warn.mockRestore();
    });
});

describe('the disablePush IPC handler', () => {
    const revokes = () => fetch.mock.calls.filter(([url]) => url.endsWith('/auth/revoke-user-app'));

    it('revokes the calling app`s push permission, as Settings does', async () => {
        const { disablePush } = await makeService();
        await expect(disablePush({}, from('app-1'))).resolves.toEqual({ removed: true });
        expect(revokes()).toHaveLength(1);
        const [, init] = revokes()[0];
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ app_uid: 'app-1', permission: 'notifications:push' });
    });

    it('revokes nothing for an app without the permission', async () => {
        held = false;
        const { disablePush } = await makeService();
        await expect(disablePush({}, from('app-1'))).resolves.toEqual({ removed: false });
        expect(revokes()).toHaveLength(0);
    });

    it('rejects when the server refuses the revoke', async () => {
        const { disablePush } = await makeService();
        const check = fetch.getMockImplementation();
        fetch.mockImplementation(async (url, init) => (url.endsWith('/auth/revoke-user-app')
            ? { ok: false, status: 500, json: async () => ({ message: 'down', code: 'internal_error' }) }
            : check(url, init)));
        await expect(disablePush({}, from('app-1'))).rejects.toMatchObject({ code: 'internal_error' });
    });
});
