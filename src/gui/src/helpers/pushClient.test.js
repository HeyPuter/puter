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

const client = () => ({ enable: vi.fn(), disable: vi.fn(), status: vi.fn() });

let mod;
const registry = new Map();

beforeEach(async () => {
    registry.clear();
    globalThis.def = (value, id) => registry.set(id, value);
    vi.resetModules();
    mod = await import('./pushClient.js');
});

afterEach(() => {
    delete globalThis.def;
});

describe('push client registry', () => {
    it('has no client until one registers', () => {
        expect(mod.getPushClient()).toBeNull();
    });

    it('keeps the registered client and announces it', () => {
        const announced = vi.fn();
        window.addEventListener(mod.PUSH_CLIENT_REGISTERED_EVENT, announced);
        const first = client();
        const second = client();

        expect(mod.registerPushClient(first)).toBe(true);
        expect(mod.registerPushClient(second)).toBe(true);

        expect(mod.getPushClient()).toBe(second);
        expect(announced).toHaveBeenCalledTimes(2);
        window.removeEventListener(mod.PUSH_CLIENT_REGISTERED_EVENT, announced);
    });

    it('refuses a client missing a method', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(mod.registerPushClient({ enable () {}, status () {} })).toBe(false);
        expect(mod.registerPushClient(null)).toBe(false);
        expect(mod.getPushClient()).toBeNull();
        warn.mockRestore();
    });

    it('is reachable from service scripts as push.registerPushClient', () => {
        const registered = client();
        registry.get('push.registerPushClient')(registered);
        expect(mod.getPushClient()).toBe(registered);
    });
});

describe('pushClientWithin', () => {
    it('answers the registered client at once', async () => {
        const registered = client();
        mod.registerPushClient(registered);
        await expect(mod.pushClientWithin(1000, { pushEnabled: true })).resolves.toBe(registered);
    });

    it('answers null at once when the server has push off', async () => {
        const started = Date.now();
        await expect(mod.pushClientWithin(1000, { pushEnabled: false })).resolves.toBeNull();
        await expect(mod.pushClientWithin(1000, undefined)).resolves.toBeNull();
        expect(Date.now() - started).toBeLessThan(500);
    });

    it('waits for a client that registers later', async () => {
        const waiting = mod.pushClientWithin(1000, { pushEnabled: true });
        const registered = client();
        setTimeout(() => mod.registerPushClient(registered), 10);
        await expect(waiting).resolves.toBe(registered);
    });

    it('gives up after the wait', async () => {
        await expect(mod.pushClientWithin(20, { pushEnabled: true })).resolves.toBeNull();
    });
});

describe('browserPushState', () => {
    it('maps the client status to a card state', async () => {
        const status = (value) => ({ ...client(), status: vi.fn(async () => value) });
        await expect(mod.browserPushState(null)).resolves.toBe('unavailable');
        await expect(mod.browserPushState(status({ permission: 'denied', registered: false }))).resolves.toBe('blocked');
        await expect(mod.browserPushState(status({ permission: 'granted', registered: true }))).resolves.toBe('on');
        await expect(mod.browserPushState(status({ permission: 'default', registered: false }))).resolves.toBe('off');
        await expect(mod.browserPushState(status({ permission: 'granted', registered: false }))).resolves.toBe('off');
    });

    it('is unavailable when the status read fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failing = { ...client(), status: vi.fn(async () => {
            throw new Error('down');
        }) };
        await expect(mod.browserPushState(failing)).resolves.toBe('unavailable');
        warn.mockRestore();
    });
});

describe('the opt-out record', () => {
    beforeEach(() => localStorage.clear());

    it('is kept per user', () => {
        mod.setBrowserPushOptOut('u-1', true);
        expect(mod.browserPushOptedOut('u-1')).toBe(true);
        expect(mod.browserPushOptedOut('u-2')).toBe(false);
        mod.setBrowserPushOptOut('u-1', false);
        expect(mod.browserPushOptedOut('u-1')).toBe(false);
        expect(localStorage.length).toBe(0);
    });

    it('is nothing without a user', () => {
        mod.setBrowserPushOptOut(undefined, true);
        expect(localStorage.length).toBe(0);
        expect(mod.browserPushOptedOut(undefined)).toBe(false);
    });

    it('survives a storage that throws', () => {
        const broken = {
            getItem () {
                throw new Error('blocked');
            },
            setItem () {
                throw new Error('blocked');
            },
            removeItem () {
                throw new Error('blocked');
            },
        };
        expect(() => mod.setBrowserPushOptOut('u-1', true, broken)).not.toThrow();
        expect(mod.browserPushOptedOut('u-1', broken)).toBe(false);
    });
});

describe('withEnableDeadline', () => {
    const never = new Promise(() => {});
    const granted = { permission: 'granted' };

    it('answers the promise when it settles in time', async () => {
        await expect(mod.withEnableDeadline(Promise.resolve(true), { ms: 50, NotificationApi: granted })).resolves.toBe(true);
    });

    it('gives the fallback once the time is up with the prompt closed', async () => {
        await expect(mod.withEnableDeadline(never, { ms: 20, fallback: null, NotificationApi: granted })).resolves.toBeNull();
        await expect(mod.withEnableDeadline(never, { ms: 20, NotificationApi: undefined })).resolves.toBe(false);
    });

    it('counts no time while the browser prompt is open', async () => {
        const NotificationApi = { permission: 'default' };
        let done = false;
        const waited = mod.withEnableDeadline(never, { ms: 20, poll: 5, NotificationApi }).then(() => {
            done = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(done).toBe(false);
        NotificationApi.permission = 'denied';
        await waited;
        expect(done).toBe(true);
    });
});

describe('enableBrowserPush', () => {
    beforeEach(() => localStorage.clear());

    it('calls enable() before anything is awaited and clears the opt-out on success', async () => {
        mod.setBrowserPushOptOut('u-1', true);
        const registered = { ...client(), enable: vi.fn(async () => ({ deviceUid: 'dev-1' })) };
        const enabling = mod.enableBrowserPush(registered, 'u-1');
        expect(registered.enable).toHaveBeenCalledTimes(1);
        await expect(enabling).resolves.toBe(true);
        expect(mod.browserPushOptedOut('u-1')).toBe(false);
    });

    it('resolves false and keeps the opt-out when enable() rejects or throws', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        mod.setBrowserPushOptOut('u-1', true);
        const rejecting = { ...client(), enable: vi.fn(async () => {
            throw new Error('permission_denied');
        }) };
        await expect(mod.enableBrowserPush(rejecting, 'u-1')).resolves.toBe(false);
        await expect(mod.enableBrowserPush(null, 'u-1')).resolves.toBe(false);
        expect(mod.browserPushOptedOut('u-1')).toBe(true);
        expect(debug).toHaveBeenCalledTimes(2);
        debug.mockRestore();
    });
});
