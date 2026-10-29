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

const { stub, dialog } = vi.hoisted(() => ({
    stub: () => ({ default: () => {} }),
    dialog: vi.fn(),
}));
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
vi.mock('./UI/UIWindowColorPicker.js', stub);
vi.mock('./UI/UIWindowEmailConfirmationRequired.js', stub);
vi.mock('./UI/UIWindowFontPicker.js', stub);
vi.mock('./UI/UIPermissionDialog.js', stub);
vi.mock('./UI/UIEnablePushDialog.js', () => ({ default: dialog }));
vi.mock('./UI/UIWindowSaveAccount.js', stub);
vi.mock('./UI/UIWindowSignup.js', stub);
vi.mock('./UI/UINotification.js', stub);
vi.mock('./helpers/godmodeTokens.js', () => ({ renewGodmodeToken: vi.fn() }));
vi.mock('./helpers/watchItems.js', () => ({ addItemWatcher: vi.fn() }));
vi.mock('./helpers/verification_gates.js', () => ({
    openVerificationGateWindow: vi.fn(),
}));

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
    dialog.mockReset();
    document.body.innerHTML = '';
    const win = document.createElement('div');
    win.setAttribute('data-app_uuid', 'app-1');
    iframe = document.createElement('iframe');
    iframe.setAttribute('data-app', 'team-chat');
    win.append(iframe);
    document.body.append(win);
    posted = vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => {});
    window.app_instance_ids = new Set(['inst-1']);
    window.iframe_for_app_instance = (id) => (id === 'inst-1' ? iframe : null);
    window.window_for_app_instance = () => win;
    window.is_auth = () => true;
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'tok-1';
    holds(true);
    window.ipc_handlers = {};
    globalThis.services = { get: () => ({ get_by_uuid: () => ({ name: 'caller', uuid: 'inst-1' }) }) };
});

const post = (msg) =>
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { appInstanceID: 'inst-1', env: 'app', msg, uuid: 'cb-1' },
            source: iframe.contentWindow,
            origin: 'https://app.example',
        }),
    );

const settle = () => new Promise((r) => setTimeout(r, 20));

/** What /auth/check-permissions answers for notifications:push. */
const holds = (value) => {
    globalThis.fetch = vi.fn(async (url, init) => ({
        ok: true,
        json: async () => ({ permissions: { 'notifications:push': value } }),
        url,
        init,
    }));
};

describe('the enablePush IPC message', () => {
    it('offers the dialog for the calling app and reports the state', async () => {
        dialog.mockResolvedValue('on');
        post('enablePush');
        await settle();

        expect(dialog).toHaveBeenCalledWith({ app_name: 'team-chat' });
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'on', original_msg_id: 'cb-1' },
            '*',
        );
    });

    it('asks the server whether this app may send pushes, and shows nothing when it may not', async () => {
        holds(false);
        dialog.mockResolvedValue('on');
        post('enablePush');
        await settle();

        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ permissions: ['notifications:push'], app_uid: 'app-1' });
        expect(dialog).not.toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'unavailable', original_msg_id: 'cb-1' },
            '*',
        );
    });

    it('answers a second call unavailable while the dialog is up', async () => {
        let finish;
        dialog.mockImplementation(() => new Promise((resolve) => {
            finish = resolve;
        }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        post('enablePush');
        await settle();
        post('enablePush');
        await settle();

        expect(dialog).toHaveBeenCalledTimes(1);
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'unavailable', original_msg_id: 'cb-1' },
            '*',
        );
        finish('on');
        await settle();
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'on', original_msg_id: 'cb-1' },
            '*',
        );

        post('enablePush');
        await settle();
        expect(dialog).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it('reports unavailable when the dialog fails', async () => {
        dialog.mockRejectedValue(new Error('boom'));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        post('enablePush');
        await settle();

        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'unavailable', original_msg_id: 'cb-1' },
            '*',
        );
        errors.mockRestore();
    });
});
