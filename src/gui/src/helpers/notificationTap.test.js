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

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    elementsWithData,
    handleNotificationTap,
    normalizePushTap,
    openAppForTap,
    pushTapFromParams,
    storedTapHandler,
    storedTapItem,
    tapRoute,
    withoutNotificationClick,
} from './notificationTap.js';

const UID = '0b6a2c1e-6f1d-4a57-9c1e-3d2f8a9b7c10';
const OTHER_UID = '7d3e9f10-2b4c-4d5e-8f6a-1b2c3d4e5f60';
const THIRD_UID = 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const appMessage = (over = {}) => ({
    type: 'app.message',
    title: 'New reply',
    target: '/rooms/7',
    data: { room: 7 },
    app: { uid: 'app-1', name: 'Chat' },
    ...over,
});

afterEach(() => {
    vi.resetModules();
});

describe('tapRoute', () => {
    it('opens the app an app message came from, with uid, target and data', () => {
        expect(tapRoute({ uid: 'n1', notification: appMessage() })).toEqual({
            kind: 'app',
            appUid: 'app-1',
            click: { uid: 'n1', target: '/rooms/7', data: { room: 7 } },
        });
    });

    it("opens the row's app when the row and the value name different apps", () => {
        expect(tapRoute({ uid: 'n1', notification: appMessage(), appUid: 'app-row' }).appUid).toBe('app-row');
    });

    it("uses the value's app only when the row names none", () => {
        expect(tapRoute({ uid: 'n1', notification: appMessage(), appUid: '' }).appUid).toBe('app-1');
        expect(tapRoute({ uid: 'n1', notification: appMessage({ app: { uid: '' } }) })).toEqual({ kind: 'panel' });
        expect(tapRoute({ uid: 'n1', notification: appMessage({ app: undefined }) })).toEqual({ kind: 'panel' });
    });

    it('passes the target to the app only when it is a string', () => {
        const route = tapRoute({ uid: 'n1', notification: appMessage({ target: { path: '/x' } }) });
        expect(route.click.target).toBeUndefined();
    });

    it('sends shares to the share handling and anything else to the list', () => {
        const share = { type: 'share.received', fields: { target: { path: '/a/b.txt' } } };
        expect(tapRoute({ uid: 'n1', notification: share })).toEqual({ kind: 'share', notification: share });
        expect(tapRoute({ uid: 'n1', notification: { type: 'app.events.suspended', title: 'x' } }))
            .toEqual({ kind: 'panel' });
    });

    it('is the list without a notification, whatever else the tap carries', () => {
        expect(tapRoute({ uid: 'n1', push: { uid: 'n1', target: { app: 'app-1', path: '/rooms/7' }, data: 5 } }))
            .toEqual({ kind: 'panel' });
        expect(tapRoute({ uid: 'n1', target: { app: 'app-1' }, notification: null })).toEqual({ kind: 'panel' });
        expect(tapRoute({ uid: 'n1' })).toEqual({ kind: 'panel' });
    });
});

describe('normalizePushTap', () => {
    it('keeps the notification uid and nothing else', () => {
        expect(normalizePushTap({ uid: UID, target: { app: 'a', path: '/x' }, data: null, extra: 1 }))
            .toEqual({ uid: UID });
        expect(normalizePushTap({ uid: '' })).toBeNull();
        expect(normalizePushTap({ uid: 'n1' })).toBeNull();
        expect(normalizePushTap({ uid: `${UID}${'0'.repeat(40)}` })).toBeNull();
        expect(normalizePushTap(UID)).toBeNull();
    });
});

describe('pushTapFromParams', () => {
    const params = (value) => new URLSearchParams({ 'puter.notification': value });

    it('reads a notification uid, and nothing else, from the URL', () => {
        expect(pushTapFromParams(params(UID))).toEqual({ uid: UID });
    });

    it('takes nothing that is not a notification uid', () => {
        expect(pushTapFromParams(params(JSON.stringify({ uid: UID, target: { app: 'a' } })))).toBeNull();
        expect(pushTapFromParams(params('n1'))).toBeNull();
        expect(pushTapFromParams(params(`${UID}${'0'.repeat(40)}`))).toBeNull();
        expect(pushTapFromParams(new URLSearchParams())).toBeNull();
        expect(pushTapFromParams(undefined)).toBeNull();
    });
});

describe('storedTapItem', () => {
    it("acts on the user's own row: its value, and the app the row names", async () => {
        const row = { uid: UID, value: appMessage(), app_uid: 'app-row' };
        expect(await storedTapItem(UID, async () => row))
            .toEqual({ uid: UID, notification: appMessage(), appUid: 'app-row' });
    });

    it('is nothing when the row is not found or names another uid', async () => {
        expect(await storedTapItem(UID, async () => null)).toBeNull();
        expect(await storedTapItem(UID, async () => ({ uid: 'other', value: {} }))).toBeNull();
    });
});

describe('elementsWithData', () => {
    const el = (uid) => ({ dataset: { uid } });

    it('matches values a selector could not hold, without throwing', () => {
        const odd = 'a"b\\c\nd]';
        const elements = [el('plain'), el(odd), {}];
        expect(elementsWithData(elements, 'uid', odd)).toEqual([elements[1]]);
        expect(elementsWithData(elements, 'uid', 'plain')).toEqual([elements[0]]);
    });

    it('matches nothing for a missing value', () => {
        expect(elementsWithData([{ dataset: {} }], 'uid', undefined)).toEqual([]);
    });
});

describe('openAppForTap', () => {
    const click = { uid: 'n1', target: '/rooms/7', data: { room: 7 } };

    it('brings a running instance forward and broadcasts notificationClick to it', async () => {
        const instance = { reveal: vi.fn(), el_window: { id: 'win' } };
        const launch = vi.fn();
        const send = vi.fn();
        const outcome = await openAppForTap({ appUid: 'app-1', click }, {
            running: () => instance,
            getApp: vi.fn(),
            launch,
            send,
        });
        expect(outcome).toBe('broadcast');
        expect(instance.reveal).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(instance.el_window, 'notificationClick', click);
        expect(launch).not.toHaveBeenCalled();
    });

    it('launches without args and broadcasts the tap once the app is ready', async () => {
        const app = { uid: 'app-1', name: 'chat' };
        const getApp = vi.fn(async () => app);
        const send = vi.fn();
        let options;
        const launch = vi.fn(async (opts) => {
            options = opts;
        });
        const outcome = await openAppForTap({ appUid: 'app-1', click }, { running: () => null, getApp, launch, send });
        expect(outcome).toBe('launched');
        expect(getApp).toHaveBeenCalledWith('app-1', { icon_size: 64 });
        expect(options).toMatchObject({ name: 'chat', app_obj: app });
        expect(options).not.toHaveProperty('args');
        expect(send).not.toHaveBeenCalled();

        const el_win = { dataset: { app_uuid: 'app-1' } };
        options.on_ready({ references: { el_win } });
        options.on_ready({ references: { el_win } });
        expect(send.mock.calls).toEqual([[el_win, 'notificationClick', click]]);
    });

    it('sends nothing to a different app that became ready in its place', async () => {
        const send = vi.fn();
        let options;
        await openAppForTap({ appUid: 'app-1', click }, {
            running: () => null,
            getApp: async () => ({ uid: 'app-1', name: 'chat' }),
            launch: async (opts) => {
                options = opts;
            },
            send,
        });
        options.on_ready({ references: { el_win: { dataset: { app_uuid: 'fallback-app' } } } });
        options.on_ready({ references: {} });
        expect(send).not.toHaveBeenCalled();
    });

    it('does nothing for an app that no longer exists', async () => {
        const launch = vi.fn();
        const outcome = await openAppForTap({ appUid: 'gone', click }, {
            running: () => null,
            getApp: async () => null,
            launch,
            send: vi.fn(),
        });
        expect(outcome).toBe('missing');
        expect(launch).not.toHaveBeenCalled();
    });
});

describe('withoutNotificationClick', () => {
    it('drops a notificationClick key from launch args and keeps the rest', () => {
        expect(withoutNotificationClick({ notificationClick: { uid: 'n1' }, path: '/a' })).toEqual({ path: '/a' });
    });

    it('returns args without the key, and empty args, unchanged', () => {
        const args = { path: '/a' };
        expect(withoutNotificationClick(args)).toBe(args);
        expect(withoutNotificationClick(undefined)).toBeUndefined();
        expect(withoutNotificationClick(null)).toBeNull();
    });
});

describe('handleNotificationTap', () => {
    const surface = () => ({ share: vi.fn(), panel: vi.fn(), openApp: vi.fn() });

    it('routes an app message to the app', async () => {
        const s = surface();
        await handleNotificationTap({ uid: 'n1', notification: appMessage() }, s);
        expect(s.openApp).toHaveBeenCalledWith({
            kind: 'app',
            appUid: 'app-1',
            click: { uid: 'n1', target: '/rooms/7', data: { room: 7 } },
        });
        expect(s.share).not.toHaveBeenCalled();
    });

    it('routes a share to the existing share handling', async () => {
        const s = surface();
        const share = { type: 'share.received', fields: { target: { path: '/a/b.txt' } } };
        await handleNotificationTap({ uid: 'n1', notification: share }, s);
        expect(s.share).toHaveBeenCalledWith(share);
        expect(s.openApp).not.toHaveBeenCalled();
    });

    it('opens the list for anything else', async () => {
        const s = surface();
        await handleNotificationTap({ uid: 'n1', notification: { type: 'app.events.ended' } }, s);
        expect(s.panel).toHaveBeenCalledOnce();
    });
});

describe('storedTapHandler', () => {
    const surface = () => ({ share: vi.fn(), panel: vi.fn(), openApp: vi.fn() });
    const row = { uid: UID, value: appMessage({ target: '/rooms/9', data: { room: 9 } }), app_uid: 'app-row' };
    const rows = async (uid) => (uid === UID ? row : null);

    it('routes from the row the tap names, after `found`', async () => {
        const deps = { fetchRow: vi.fn(rows), surface: surface(), found: vi.fn(), missing: vi.fn() };
        await storedTapHandler(deps)({ uid: UID });
        expect(deps.fetchRow).toHaveBeenCalledWith(UID);
        expect(deps.found).toHaveBeenCalledWith(UID);
        expect(deps.surface.openApp).toHaveBeenCalledWith({
            kind: 'app',
            appUid: 'app-row',
            click: { uid: UID, target: '/rooms/9', data: { room: 9 } },
        });
        expect(deps.missing).not.toHaveBeenCalled();
    });

    it('opens nothing for a row the user cannot read, running `missing` instead', async () => {
        const deps = { fetchRow: vi.fn(rows), surface: surface(), found: vi.fn(), missing: vi.fn() };
        await storedTapHandler(deps)({ uid: OTHER_UID });
        expect(deps.missing).toHaveBeenCalledOnce();
        expect(deps.found).not.toHaveBeenCalled();
        expect(deps.surface.openApp).not.toHaveBeenCalled();
        expect(deps.surface.panel).not.toHaveBeenCalled();
        expect(deps.surface.share).not.toHaveBeenCalled();
    });
});

describe('push tap dispatch', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('holds taps until a handler is set, then hands them over in order', async () => {
        const { dispatchPushTap, setPushTapHandler } = await import('./notificationTap.js');
        dispatchPushTap({ uid: UID });
        dispatchPushTap({ uid: '' });
        dispatchPushTap({ uid: 'n2' });
        dispatchPushTap({ uid: OTHER_UID, stored: true });
        const handler = vi.fn();
        setPushTapHandler(handler);
        expect(handler.mock.calls).toEqual([[{ uid: UID }], [{ uid: OTHER_UID }]]);
        dispatchPushTap({ uid: THIRD_UID });
        expect(handler).toHaveBeenLastCalledWith({ uid: THIRD_UID });
    });

    it('hands a worker tap over as the notification it names, nothing more', async () => {
        const { dispatchPushTap, setPushTapHandler, storedTapHandler: make } = await import('./notificationTap.js');
        const openApp = vi.fn();
        const fetchRow = vi.fn(async () => null);
        setPushTapHandler(make({ fetchRow, surface: { share: vi.fn(), openApp } }));
        dispatchPushTap({ uid: OTHER_UID, target: { app: 'app-1', path: '/rooms/7' }, data: { room: 7 } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fetchRow).toHaveBeenCalledWith(OTHER_UID);
        expect(openApp).not.toHaveBeenCalled();
    });

    it('hands the same notification over once within ten seconds', async () => {
        vi.useFakeTimers();
        const { dispatchPushTap, setPushTapHandler } = await import('./notificationTap.js');
        const handler = vi.fn();
        setPushTapHandler(handler);
        dispatchPushTap({ uid: UID });
        dispatchPushTap({ uid: UID });
        dispatchPushTap({ uid: OTHER_UID });
        expect(handler.mock.calls).toEqual([[{ uid: UID }], [{ uid: OTHER_UID }]]);
        vi.advanceTimersByTime(9_999);
        dispatchPushTap({ uid: UID });
        expect(handler).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1);
        dispatchPushTap({ uid: UID });
        expect(handler).toHaveBeenCalledTimes(3);
    });
});
