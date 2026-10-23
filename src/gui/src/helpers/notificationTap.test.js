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
    appClickBroadcast,
    handleNotificationTap,
    normalizePushTap,
    openAppForTap,
    pushTapFromParams,
    tapRoute,
} from './notificationTap.js';

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

    it("falls back to the row's app uid when the message names none", () => {
        const route = tapRoute({ uid: 'n1', notification: appMessage({ app: undefined }), appUid: 'app-2' });
        expect(route.kind).toBe('app');
        expect(route.appUid).toBe('app-2');
        expect(tapRoute({ uid: 'n1', notification: appMessage({ app: undefined }) })).toEqual({ kind: 'panel' });
    });

    it('sends shares to the share handling and anything else to the list', () => {
        const share = { type: 'share.received', fields: { target: { path: '/a/b.txt' } } };
        expect(tapRoute({ uid: 'n1', notification: share })).toEqual({ kind: 'share', notification: share });
        expect(tapRoute({ uid: 'n1', notification: { type: 'app.events.suspended', title: 'x' } }))
            .toEqual({ kind: 'panel' });
    });

    it('reads a push tap: an app target is the app, a path is a shared item', () => {
        expect(tapRoute({ uid: 'n1', push: { uid: 'n1', target: { app: 'app-1', path: '/rooms/7' }, data: 5 } }))
            .toEqual({ kind: 'app', appUid: 'app-1', click: { uid: 'n1', target: '/rooms/7', data: 5 } });
        expect(tapRoute({ uid: 'n1', push: { uid: 'n1', target: { path: '/alice/Shared/a.txt' } } })).toEqual({
            kind: 'share',
            notification: { type: 'share.received', fields: { target: { path: '/alice/Shared/a.txt' } } },
        });
        expect(tapRoute({ uid: 'n1', push: { uid: 'n1' } })).toEqual({ kind: 'panel' });
    });
});

describe('normalizePushTap and pushTapFromParams', () => {
    it('keeps the expected fields and drops the rest', () => {
        expect(normalizePushTap({ uid: 'n1', target: { app: 'a', path: 7, x: 1 }, data: null, extra: 1 }))
            .toEqual({ uid: 'n1', target: { app: 'a' }, data: null });
        expect(normalizePushTap({ uid: '' })).toBeNull();
        expect(normalizePushTap('n1')).toBeNull();
    });

    it('reads the tap a page was opened for, and nothing from a bad value', () => {
        const tap = { uid: 'n1', target: { app: 'app-1' } };
        expect(pushTapFromParams(new URLSearchParams({ 'puter.notification': JSON.stringify(tap) }))).toEqual(tap);
        expect(pushTapFromParams(new URLSearchParams({ 'puter.notification': '{nope' }))).toBeNull();
        expect(pushTapFromParams(new URLSearchParams())).toBeNull();
        expect(pushTapFromParams(undefined)).toBeNull();
    });
});

describe('openAppForTap', () => {
    const click = { uid: 'n1', target: '/rooms/7', data: { room: 7 } };

    it('brings a running instance forward and broadcasts notificationClick to it', async () => {
        const instance = { reveal: vi.fn(), post: vi.fn() };
        const launch = vi.fn();
        const outcome = await openAppForTap({ appUid: 'app-1', click }, {
            running: () => instance,
            getApp: vi.fn(),
            launch,
        });
        expect(outcome).toBe('broadcast');
        expect(instance.reveal).toHaveBeenCalledOnce();
        expect(instance.post).toHaveBeenCalledWith({ msg: 'broadcast', name: 'notificationClick', data: click });
        expect(launch).not.toHaveBeenCalled();
    });

    it('launches the app with the tap as puter.args.notificationClick', async () => {
        const app = { uid: 'app-1', name: 'chat' };
        const getApp = vi.fn(async () => app);
        const launch = vi.fn(async () => {});
        const outcome = await openAppForTap({ appUid: 'app-1', click }, { running: () => null, getApp, launch });
        expect(outcome).toBe('launched');
        expect(getApp).toHaveBeenCalledWith('app-1', { icon_size: 64 });
        expect(launch).toHaveBeenCalledWith({ name: 'chat', app_obj: app, args: { notificationClick: click } });
    });

    it('does nothing for an app that no longer exists', async () => {
        const launch = vi.fn();
        const outcome = await openAppForTap({ appUid: 'gone', click }, {
            running: () => null,
            getApp: async () => null,
            launch,
        });
        expect(outcome).toBe('missing');
        expect(launch).not.toHaveBeenCalled();
    });

    it('builds the broadcast in the shape the SDK reads', () => {
        expect(appClickBroadcast(click)).toEqual({ msg: 'broadcast', name: 'notificationClick', data: click });
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

describe('push tap dispatch', () => {
    it('holds taps until a handler is set, then hands them over in order', async () => {
        const { dispatchPushTap, setPushTapHandler } = await import('./notificationTap.js');
        dispatchPushTap({ uid: 'n1' });
        dispatchPushTap({ uid: '' });
        dispatchPushTap({ uid: 'n2', target: { app: 'app-1' } });
        const handler = vi.fn();
        setPushTapHandler(handler);
        expect(handler.mock.calls).toEqual([[{ uid: 'n1' }], [{ uid: 'n2', target: { app: 'app-1' } }]]);
        dispatchPushTap({ uid: 'n3' });
        expect(handler).toHaveBeenLastCalledWith({ uid: 'n3' });
    });
});
