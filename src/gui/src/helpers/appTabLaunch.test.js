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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchAppInTab, offerAppTabLaunch } from './appTabLaunch.js';

const ORIGIN = 'https://notes.example.com';
const ITEM = { 'puter.item.uid': 'file-1', 'puter.item.read_url': 'https://api.puter.test/file?signature=r' };
let nextId = 0;

const offer = () => {
    const appInstanceID = `instance-${++nextId}`;
    const tab = { postMessage: vi.fn() };
    offerAppTabLaunch({ appInstanceID, tab, origin: ORIGIN, token: 'app-token', item: ITEM });
    return { appInstanceID, tab };
};

const request = ({ appInstanceID, source, origin = ORIGIN }) => {
    window.dispatchEvent(new MessageEvent('message', {
        data: { msg: 'puter.requestLaunch', env: 'app-tab', appInstanceID },
        origin,
        source,
    }));
};

afterEach(() => {
    vi.useRealTimers();
});

describe('offerAppTabLaunch', () => {
    it('answers the tab it was offered to, at its origin, once', () => {
        const { appInstanceID, tab } = offer();
        request({ appInstanceID, source: tab });
        request({ appInstanceID, source: tab });
        expect(tab.postMessage).toHaveBeenCalledOnce();
        expect(tab.postMessage).toHaveBeenCalledWith({
            msg: 'puter.launch',
            appInstanceID,
            token: 'app-token',
            item: ITEM,
        }, ORIGIN);
    });

    it('ignores another window that knows the instance id', () => {
        const { appInstanceID, tab } = offer();
        const other = { postMessage: vi.fn() };
        request({ appInstanceID, source: other });
        expect(other.postMessage).not.toHaveBeenCalled();
        expect(tab.postMessage).not.toHaveBeenCalled();
    });

    it('ignores the tab once it has navigated to another origin', () => {
        const { appInstanceID, tab } = offer();
        request({ appInstanceID, source: tab, origin: 'https://elsewhere.example' });
        expect(tab.postMessage).not.toHaveBeenCalled();
    });

    it('withdraws an offer nobody asked for in time', () => {
        vi.useFakeTimers();
        const { appInstanceID, tab } = offer();
        vi.advanceTimersByTime(2 * 60 * 1000);
        request({ appInstanceID, source: tab });
        expect(tab.postMessage).not.toHaveBeenCalled();
    });
});

describe('launchAppInTab', () => {
    const app = { uid: 'app-123', name: 'notes', index_url: 'https://notes.example.com/start?mode=1' };
    const launch = (tab, overrides = {}) => launchAppInTab({
        name: 'notes',
        tab,
        guiOrigin: 'https://puter.test',
        apiOrigin: 'https://api.puter.test',
        authToken: 'session',
        locale: 'fr',
        ...overrides,
    });
    const arrange = ({ appRow = app, tokenResponse = { ok: true, json: async () => ({ token: 'app-token' }) } } = {}) => {
        vi.stubGlobal('puter', { apps: { get: vi.fn(async () => appRow) } });
        vi.stubGlobal('fetch', vi.fn(async () => tokenResponse));
        vi.stubGlobal('$', { ajax: vi.fn() });
    };
    const newTab = () => ({ location: { href: '' }, postMessage: vi.fn(), closed: false });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends the tab to the app\'s URL and answers its request for the token', async () => {
        arrange();
        const tab = newTab();
        expect(await launch(tab)).toBe(true);

        const url = new URL(tab.location.href);
        expect(`${url.origin}${url.pathname}`).toBe('https://notes.example.com/start');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'mode': '1',
            'puter.app.id': 'app-123',
            'puter.app.name': 'notes',
            'puter.domain': 'puter.test',
            'puter.origin': 'https://puter.test',
            'puter.api_origin': 'https://api.puter.test',
            'puter.locale': 'fr',
            'puter.args': '{}',
            'utm_source': 'puter.com',
            'utm_medium': 'referral',
            'utm_campaign': 'app_browser_embed',
        });
        expect(url.searchParams.has('puter.auth.token')).toBe(false);
        expect(fetch).toHaveBeenCalledWith('https://api.puter.test/auth/get-user-app-token', expect.objectContaining({
            headers: expect.objectContaining({ 'Authorization': 'Bearer session' }),
        }));
        expect($.ajax).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.puter.test/rao' }));

        const appInstanceID = url.searchParams.get('puter.app_instance_id');
        request({ appInstanceID, source: tab, origin: 'https://notes.example.com' });
        expect(tab.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ msg: 'puter.launch', appInstanceID, token: 'app-token', item: null }),
            'https://notes.example.com',
        );
    });

    it.each([
        ['a built-in app', { ...app, index_url: 'https://builtins.namespaces.puter.com/settings' }],
        ['a godmode app', { ...app, godmode: 1 }],
        ['a private app the user can\'t open', { ...app, privateAccess: { hasAccess: false } }],
    ])('leaves %s to the desktop', async (_label, appRow) => {
        arrange({ appRow });
        const tab = newTab();
        expect(await launch(tab)).toBe(false);
        expect(tab.location.href).toBe('');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('leaves the tab alone when the token can\'t be fetched', async () => {
        arrange({ tokenResponse: { ok: false, status: 500, json: async () => ({}) } });
        const tab = newTab();
        expect(await launch(tab)).toBe(false);
        expect(tab.location.href).toBe('');
        expect($.ajax).not.toHaveBeenCalled();
    });

    it('calls the launch off when the user closed the tab meanwhile', async () => {
        arrange();
        const tab = { ...newTab(), closed: true };
        expect(await launch(tab)).toBe(false);
        expect(tab.location.href).toBe('');
        expect($.ajax).not.toHaveBeenCalled();
    });
});
