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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));
globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;

const { stub } = vi.hoisted(() => ({ stub: () => ({ default: () => {} }) }));
vi.mock('./helpers/download.js', stub);
vi.mock('./helpers/itemIcon.js', stub);
vi.mock('./helpers/socialLink.js', stub);
vi.mock('./helpers/updateMousePosition.js', stub);
vi.mock('./UI/UIAlert.js', stub);
vi.mock('./UI/UIContextMenu.js', stub);
vi.mock('./UI/UIItem.js', stub);
vi.mock('./UI/UIPopover.js', stub);
vi.mock('./UI/UIPrompt.js', stub);
vi.mock('./UI/UIWindow.js', stub);
vi.mock('./UI/UIWindowAppFeedback.js', stub);
vi.mock('./UI/UIWindowEmailConfirmationRequired.js', stub);
vi.mock('./UI/UIWindowFontPicker.js', stub);
vi.mock('./UI/UIPermissionDialog.js', stub);
vi.mock('./UI/UIEnablePushDialog.js', stub);
vi.mock('./UI/UIWindowSaveAccount.js', stub);
vi.mock('./UI/Auth/UIAuthSignup.js', stub);
vi.mock('./UI/UINotification.js', stub);
vi.mock('./helpers/godmodeTokens.js', () => ({ renewGodmodeToken: vi.fn() }));
vi.mock('./helpers/watchItems.js', () => ({ addItemWatcher: vi.fn() }));
vi.mock('./helpers/verification_gates.js', () => ({
    openVerificationGateWindow: vi.fn(),
}));

// Stands in for puter.js's <puter-color-picker>, which the GUI page gets from
// the SDK: it records how it was opened, and the test answers for the user.
const opened = [];
class FakeColorPicker extends HTMLElement {
    open () {
        opened.push(this);
    }
    answer (color) {
        this.dispatchEvent(new CustomEvent('response', { detail: color }));
    }
}
customElements.define('puter-color-picker', FakeColorPicker);

let iframe;
let posted;

beforeAll(async () => {
    window.when_puter_happens = [];
    window.appCallbackFunctions = {};
    await import('./IPC.js');
    globalThis.puter = { services: undefined, util: { rpc: { send: vi.fn() } } };
    for (const fn of window.when_puter_happens) await fn();
});

beforeEach(() => {
    opened.length = 0;
    document.body.innerHTML = '';
    const win = document.createElement('div');
    win.setAttribute('data-app_uuid', 'app-1');
    iframe = document.createElement('iframe');
    iframe.setAttribute('data-app', 'notes');
    win.append(iframe);
    document.body.append(win);
    posted = vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => {});
    window.app_instance_ids = new Set(['inst-1']);
    window.iframe_for_app_instance = (id) => (id === 'inst-1' ? iframe : null);
    window.window_for_app_instance = () => win;
    window.is_auth = () => true;
    window.ipc_handlers = {};
    globalThis.services = { get: () => ({ get_by_uuid: () => ({ name: 'caller', uuid: 'inst-1' }) }) };
});

const request = (options) =>
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { appInstanceID: 'inst-1', env: 'app', msg: 'showColorPicker', uuid: 'cb-1', options },
            source: iframe.contentWindow,
            origin: 'https://app.example',
        }),
    );

const settle = () => new Promise((r) => setTimeout(r, 20));

const replies = () => posted.mock.calls
    .map(([data]) => data)
    .filter((data) => data.msg === 'colorPicked');

describe('showColorPicker', () => {
    it.each([
        ['a string', '#abcdef'],
        ['defaultColor', { defaultColor: '#abcdef' }],
        ['the legacy default alias', { default: '#abcdef' }],
        ['the legacy defaultValue alias', { defaultValue: '#abcdef' }],
        ['an 8-digit hex, without its alpha', '#abcdef80'],
    ])('opens the picker on the color given as %s', async (_, options) => {
        request(options);
        await settle();
        expect(opened).toHaveLength(1);
        expect(opened[0].getAttribute('default-color')).toBe('#abcdef');
        expect(opened[0].isConnected).toBe(true);
    });

    it.each([
        ['no color', undefined],
        ['a color that isn\'t hex', 'red'],
        ['a malformed hex', '#abcd'],
    ])('leaves the picker\'s own default when the app gives %s', async (_, options) => {
        request(options);
        await settle();
        expect(opened[0].hasAttribute('default-color')).toBe(false);
    });

    it('replies with the picked color', async () => {
        request('#abcdef');
        await settle();
        opened[0].answer('#123456');
        await settle();
        expect(replies()).toEqual([{ msg: 'colorPicked', original_msg_id: 'cb-1', color: '#123456' }]);
        expect(opened[0].isConnected).toBe(false);
    });

    it('replies null when the user cancels', async () => {
        request();
        await settle();
        opened[0].answer(null);
        await settle();
        expect(replies()).toEqual([{ msg: 'colorPicked', original_msg_id: 'cb-1', color: null }]);
        expect(opened[0].isConnected).toBe(false);
    });
});
