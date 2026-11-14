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
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./launchApp.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIAlert.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = key => key;

const { default: launch_app } = await import('./launchApp.js');
const { default: UIAlert } = await import('../UI/UIAlert.js');
const { openAppInNewTab, openDesktopInNewTab } = await import('./dashboardAppLaunch.js');

describe('openAppInNewTab', () => {
    let opened;

    beforeEach(() => {
        opened = { closed: false };
        vi.spyOn(window, 'open').mockImplementation(() => opened);
        launch_app.mockResolvedValue({ launchResult: { launched: true } });
        jQuery.fn.focusWindow = vi.fn();
        jQuery.fn.showWindow = vi.fn();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('opens the app in a new tab, kept connected so the app can ask it for its token', async () => {
        await openAppInNewTab('notes');
        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(launch_app).toHaveBeenCalledWith({ name: 'notes', newTab: opened });
    });

    it('ignores a second click while the first launch is loading', async () => {
        let finish;
        launch_app.mockReturnValueOnce(new Promise((resolve) => {
            finish = resolve;
        }));
        const first = openAppInNewTab('notes');
        openAppInNewTab('notes');
        expect(window.open).toHaveBeenCalledTimes(1);

        finish();
        await first;
        await openAppInNewTab('notes');
        expect(window.open).toHaveBeenCalledTimes(2);
    });

    it('brings back an open window when the browser refuses the tab', async () => {
        window.open.mockReturnValue(null);
        document.body.innerHTML = '<div class="window" data-app="notes"></div>';
        await openAppInNewTab('notes');
        expect(jQuery.fn.focusWindow).toHaveBeenCalled();
        expect(launch_app).not.toHaveBeenCalled();
    });

    it('opens the app in this page when the browser refuses the tab', async () => {
        window.open.mockReturnValue(null);
        await openAppInNewTab('notes');
        expect(launch_app).toHaveBeenCalledWith({ name: 'notes', maximized: true });
    });

    it('tells the user when the launch fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        launch_app.mockRejectedValueOnce(new Error('offline'));
        await openAppInNewTab('notes');
        expect(UIAlert).toHaveBeenCalledWith('something_went_wrong');
    });
});

describe('openDesktopInNewTab', () => {
    const DESKTOP = 'https://desktop.puter.com';
    let tab;

    const answerTokenRequest = (status, body) => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: status === 200,
            status,
            json: async () => body,
        })));
    };

    /** Asks for the launch as the desktop's SDK would, from `source` at `origin`. */
    const requestLaunch = (appInstanceID, { source = tab, origin = DESKTOP } = {}) => {
        window.dispatchEvent(new MessageEvent('message', {
            origin,
            source,
            data: { msg: 'puter.requestLaunch', appInstanceID },
        }));
    };

    beforeEach(() => {
        tab = { closed: false, location: { href: '' }, postMessage: vi.fn() };
        vi.spyOn(window, 'open').mockImplementation(() => tab);
        window.api_origin = 'https://api.puter.test';
        window.auth_token = 'session-token';
        window.app_domain = 'puter.site';
        window.locale = 'en';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sends the tab to the desktop with the launch params and hands its token over on request', async () => {
        answerTokenRequest(200, { token: 'app-token', app_uid: 'app-desktop' });
        await openDesktopInNewTab();

        expect(window.open).toHaveBeenCalledWith('', '_blank');
        const [endpoint, request] = fetch.mock.calls[0];
        expect(endpoint).toBe('https://api.puter.test/auth/get-user-app-token');
        expect(JSON.parse(request.body)).toEqual({ origin: DESKTOP });

        const url = new URL(tab.location.href);
        expect(url.origin).toBe(DESKTOP);
        expect(url.searchParams.get('puter.app.id')).toBe('app-desktop');
        expect(url.searchParams.get('puter.api_origin')).toBe('https://api.puter.test');
        expect(url.searchParams.get('puter.origin')).toBe(window.location.origin);
        expect(url.searchParams.get('utm_campaign')).toBe('dashboard');
        expect(url.href).not.toContain('app-token');

        const appInstanceID = url.searchParams.get('puter.app_instance_id');
        requestLaunch(appInstanceID, { origin: 'https://evil.example' });
        requestLaunch(appInstanceID, { source: {} });
        expect(tab.postMessage).not.toHaveBeenCalled();

        requestLaunch(appInstanceID);
        expect(tab.postMessage).toHaveBeenCalledWith(
            { msg: 'puter.launch', appInstanceID, token: 'app-token', item: null },
            DESKTOP,
        );
    });

    it('opens the desktop without launch params when no token came back', async () => {
        answerTokenRequest(500, null);
        await openDesktopInNewTab();
        expect(tab.location.href).toBe(`${DESKTOP}/`);
    });

    it('leaves a tab the user closed alone', async () => {
        answerTokenRequest(200, { token: 'app-token', app_uid: 'app-desktop' });
        const launch = openDesktopInNewTab();
        tab.closed = true;
        await launch;
        expect(tab.location.href).toBe('');
    });

    it('returns null when the browser refuses the tab', () => {
        window.open.mockReturnValue(null);
        vi.stubGlobal('fetch', vi.fn());
        expect(openDesktopInNewTab()).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
