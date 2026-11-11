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
import { cachedPushApps, forgetPushApps, PUSH_APPS_TTL_MS, revokePushApp, webPushEndpointState } from './notificationApi.js';
import { appHoldsForPuter, pushGrantOf } from './pushApps.js';

const PUSH = 'notifications:push';
const listed = (...apps) => async () => apps;

describe('appHoldsForPuter', () => {
    it('counts push only for an app allowed for Puter`s devices', async () => {
        const holds = async () => true;
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds, listApps: listed({ uid: 'app-1', puterDevices: false }) })).resolves.toBe(false);
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds, listApps: listed({ uid: 'app-1', puterDevices: true }) })).resolves.toBe(true);
        // An older server lists no `puterDevices`, and a long list may leave the app out.
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds, listApps: listed({ uid: 'app-1' }) })).resolves.toBe(true);
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds, listApps: listed() })).resolves.toBe(true);
    });

    it('lists nothing when the grant is missing or push isn`t asked about', async () => {
        const listApps = vi.fn(listed());
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds: async () => false, listApps })).resolves.toBe(false);
        await expect(appHoldsForPuter(['events:background'], 'app-1', { holds: async () => true, listApps })).resolves.toBe(true);
        expect(listApps).not.toHaveBeenCalled();
    });

    it.each([
        ['the server has no push routes', Object.assign(new Error('nope'), { code: 'push_unavailable' })],
        ['the list answers 429', Object.assign(new Error('slow down'), { status: 429, code: 'too_many_requests' })],
        ['the list answers 500', Object.assign(new Error('down'), { status: 500, code: 'internal_error' })],
        ['the request never arrives', new TypeError('Failed to fetch')],
    ])('takes the grant alone when %s', async (_label, error) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const listApps = async () => {
            throw error;
        };
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds: async () => true, listApps })).resolves.toBe(true);
        await expect(appHoldsForPuter([PUSH], 'app-1', { holds: async () => false, listApps })).resolves.toBe(false);
        warn.mockRestore();
    });
});

describe('pushGrantOf', () => {
    it('tells no grant, Puter`s own, and a website`s Web Push grant apart', async () => {
        await expect(pushGrantOf('app-1', { holds: async () => false, listApps: listed() })).resolves.toBe('none');
        await expect(pushGrantOf('app-1', { holds: async () => true, listApps: listed({ uid: 'app-1', puterDevices: true }) })).resolves.toBe('puter');
        await expect(pushGrantOf('app-1', { holds: async () => true, listApps: listed({ uid: 'app-1', puterDevices: false }) })).resolves.toBe('website');
    });

    it('reads a website`s grant as Puter`s own while the app list can`t be read', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const down = async () => {
            throw Object.assign(new Error('down'), { status: 500 });
        };
        await expect(pushGrantOf('app-1', { holds: async () => true, listApps: down })).resolves.toBe('puter');
        warn.mockRestore();
    });
});

describe('cachedPushApps', () => {
    const answer = (apps) => new Response(JSON.stringify({ apps }), { status: 200 });

    beforeEach(() => {
        globalThis.window = globalThis.window ?? globalThis;
        window.api_origin = 'https://api.puter.test';
        globalThis.user = { uuid: 'u-1' };
        forgetPushApps();
        globalThis.fetch = vi.fn(async () => answer([{ uid: 'app-1' }]));
    });

    it('reuses one answer for the same user within the time limit', async () => {
        await cachedPushApps(1000);
        await expect(cachedPushApps(1000 + PUSH_APPS_TTL_MS - 1)).resolves.toEqual([{ uid: 'app-1' }]);
        expect(fetch).toHaveBeenCalledTimes(1);
        await cachedPushApps(1000 + PUSH_APPS_TTL_MS);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('asks again for another user, after a grant changed, and after a failure', async () => {
        await cachedPushApps(1000);
        globalThis.user = { uuid: 'u-2' };
        await cachedPushApps(1000);
        expect(fetch).toHaveBeenCalledTimes(2);
        await revokePushApp('app-1');
        await cachedPushApps(1000);
        expect(fetch.mock.calls.filter(([url]) => url.endsWith('/push/apps'))).toHaveLength(3);

        forgetPushApps();
        fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));
        await expect(cachedPushApps(1000)).rejects.toThrow();
        await expect(cachedPushApps(1000)).resolves.toEqual([{ uid: 'app-1' }]);
    });
});

describe('webPushEndpointState', () => {
    it('tells a 429 apart from a server that can`t answer', async () => {
        globalThis.window = globalThis.window ?? globalThis;
        window.api_origin = 'https://api.puter.test';
        const reply = (status, body) => new Response(JSON.stringify(body), { status });
        globalThis.fetch = vi.fn(async () => reply(200, { state: 'removed' }));
        await expect(webPushEndpointState('https://push.test/1')).resolves.toBe('removed');
        fetch.mockResolvedValueOnce(reply(429, { code: 'too_many_requests' }));
        await expect(webPushEndpointState('https://push.test/1')).resolves.toBe('busy');
        fetch.mockResolvedValueOnce(reply(404, { code: 'not_found' }));
        await expect(webPushEndpointState('https://push.test/1')).resolves.toBeNull();
    });
});

