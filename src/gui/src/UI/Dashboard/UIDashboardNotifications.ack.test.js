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

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => String(value ?? '');
window.html_encode = globalThis.html_encode;
globalThis.i18n = (key) => key;
window.matchMedia = () => ({ matches: false, addEventListener () {}, removeEventListener () {} });
window.api_origin = 'https://api.puter.test';
window.auth_token = 'tok-1';
window.user = { uuid: 'u-1' };
globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 }));

vi.mock('../UINotification.js', () => ({ default: vi.fn(() => ({})) }));
vi.mock('../UIWindow.js', () => ({ reveal_dashboard: vi.fn() }));
vi.mock('../../helpers/getAppByUid.js', () => ({ get_app_by_uid: vi.fn(async () => null) }));
vi.mock('../../helpers/launchApp.js', () => ({ default: vi.fn() }));
vi.mock('../../helpers/notificationApi.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getNotification: vi.fn(async () => null),
    listNotifications: vi.fn(async () => ({ items: [] })),
    markNotificationAcknowledged: vi.fn(async () => {}),
}));

const { default: UIDashboardNotifications } = await import('./UIDashboardNotifications.js');

/** Records listeners the way socket.io-client registers them. */
const fakeSocket = () => {
    const handlers = {};
    return {
        handlers,
        on (event, fn) {
            (handlers[event] ??= []).push(fn);
        },
        emit () {},
    };
};

describe('UIDashboardNotifications notif.message', () => {
    it('acknowledges the delivery with the page visibility', () => {
        document.body.innerHTML = '<div class="win"><div class="dashboard-user-options"></div></div>';
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        const socket = fakeSocket();
        UIDashboardNotifications({ $el_window: $('.win'), socket });

        const ack = vi.fn();
        for ( const handler of socket.handlers['notif.message'] ) {
            handler({ uid: 'n-1', notification: { title: 'hi' } }, ack);
        }

        expect(ack).toHaveBeenCalledTimes(1);
        expect(ack).toHaveBeenCalledWith({ visibilityState: 'hidden' });
    });

    it('takes a message sent without a callback', () => {
        document.body.innerHTML = '<div class="win"><div class="dashboard-user-options"></div></div>';
        const socket = fakeSocket();
        UIDashboardNotifications({ $el_window: $('.win'), socket });

        expect(() => socket.handlers['notif.message'][0]({ uid: 'n-2', notification: { title: 'hi' } }))
            .not.toThrow();
    });
});
