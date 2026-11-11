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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));
globalThis.$ = globalThis.jQuery = jQuery;

const { stub, dialog, permissionDialog } = vi.hoisted(() => ({
    stub: () => ({ default: () => {} }),
    dialog: vi.fn(),
    permissionDialog: vi.fn(),
}));
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
vi.mock('./UI/UIPermissionDialog.js', () => ({ default: permissionDialog }));
vi.mock('./UI/UIEnablePushDialog.js', () => ({ default: dialog }));
vi.mock('./UI/UIWindowSaveAccount.js', stub);
vi.mock('./UI/Auth/UIAuthSignup.js', stub);
vi.mock('./UI/UINotification.js', stub);
vi.mock('./helpers/godmodeTokens.js', () => ({ renewGodmodeToken: vi.fn() }));
vi.mock('./helpers/watchItems.js', () => ({ addItemWatcher: vi.fn() }));
vi.mock('./helpers/verification_gates.js', () => ({
    openVerificationGateWindow: vi.fn(),
}));

let iframe;
let posted;
let registerPushClient;
let forgetPushApps;
/** What this browser's push client reports. */
let browser;

beforeAll(async () => {
    window.when_puter_happens = [];
    window.appCallbackFunctions = {};
    ({ registerPushClient } = await import('./helpers/pushClient.js'));
    ({ forgetPushApps } = await import('./helpers/notificationApi.js'));
    await import('./IPC.js');
    globalThis.puter = { services: undefined, util: { rpc: { send: vi.fn() } } };
    for (const fn of window.when_puter_happens) await fn();
});

beforeEach(() => {
    dialog.mockReset();
    permissionDialog.mockReset();
    forgetPushApps();
    browser = { permission: 'granted', registered: false };
    window.gui_params = { pushEnabled: true };
    registerPushClient({
        enable: async () => {
            browser.registered = true;
            return { deviceUid: 'd-1' };
        },
        disable: async () => {
            browser.registered = false;
        },
        status: async () => {
            if ( browser.broken ) throw new Error('no push service');
            return { ...browser };
        },
    });
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

const post = (msg, extra = {}) =>
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { appInstanceID: 'inst-1', env: 'app', msg, uuid: 'cb-1', ...extra },
            source: iframe.contentWindow,
            origin: 'https://app.example',
        }),
    );

const settle = () => new Promise((r) => setTimeout(r, 20));

/** What /auth/check-permissions answers for notifications:push, and /push/apps lists. */
const holds = (value, apps = []) => {
    globalThis.fetch = vi.fn(async (url, init) => ({
        ok: true,
        json: async () => (url.endsWith('/push/apps')
            ? { apps }
            : { permissions: { 'notifications:push': value } }),
        url,
        init,
    }));
};

/** A grant written by the app's own website through Web Push. */
const websiteOnly = () => holds(true, [{ uid: 'app-1', name: 'team-chat', puterDevices: false }]);

describe('push held only from a website`s own Web Push', () => {
    it('shows Puter`s permission dialog on enablePush, not the turn-on dialog', async () => {
        websiteOnly();
        permissionDialog.mockResolvedValue(false);
        post('enablePush');
        await settle();

        expect(permissionDialog).toHaveBeenCalledWith(expect.objectContaining({ permission: 'notifications:push', app_uid: 'app-1' }));
        expect(dialog).not.toHaveBeenCalled();
    });

    it('shows Puter`s permission dialog on requestPermission', async () => {
        websiteOnly();
        permissionDialog.mockResolvedValue(true);
        post('requestPermission', { options: { permission: 'notifications:push' } });
        await settle();

        expect(permissionDialog).toHaveBeenCalledTimes(1);
        expect(posted).toHaveBeenCalledWith(
            { msg: 'permissionGranted', granted: true, original_msg_id: 'cb-1' },
            '*',
        );
    });

    it('answers requestPermission without a dialog when the app may push to Puter`s devices', async () => {
        holds(true, [{ uid: 'app-1', name: 'team-chat', puterDevices: true }]);
        post('requestPermission', { options: { permission: 'notifications:push' } });
        await settle();

        expect(permissionDialog).not.toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith(
            { msg: 'permissionGranted', granted: true, original_msg_id: 'cb-1' },
            '*',
        );
    });
});

describe('push held while the app list can`t be read', () => {
    /** The app holds the permission and `/push/apps` fails as `list` does. */
    const listFails = (list) => {
        holds(true);
        const check = fetch.getMockImplementation();
        fetch.mockImplementation(async (url, init) => (url.endsWith('/push/apps') ? list() : check(url, init)));
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    };
    let warn;
    afterEach(() => warn.mockRestore());
    const failures = [
        ['answers 500', async () => ({ ok: false, status: 500, json: async () => ({ code: 'internal_error' }) })],
        ['never answers', async () => {
            throw new TypeError('Failed to fetch');
        }],
    ];

    it.each(failures)('answers requestPermission without a dialog when the list %s', async (_label, list) => {
        listFails(list);
        post('requestPermission', { options: { permission: 'notifications:push' } });
        await settle();

        expect(permissionDialog).not.toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith(
            { msg: 'permissionGranted', granted: true, original_msg_id: 'cb-1' },
            '*',
        );
    });

    it.each(failures)('shows the turn-on dialog on enablePush when the list %s', async (_label, list) => {
        listFails(list);
        dialog.mockResolvedValue('on');
        post('enablePush');
        await settle();

        expect(dialog).toHaveBeenCalledWith({ app_name: 'team-chat' });
        expect(permissionDialog).not.toHaveBeenCalled();
    });
});

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

    it('asks for the permission when the app may not send pushes, and reports the state once Allow`s registration settles', async () => {
        holds(false);
        permissionDialog.mockImplementation(async (options) => {
            options.on_push_enable(new Promise((resolve) => {
                setTimeout(() => {
                    browser.registered = true;
                    resolve(true);
                }, 5);
            }));
            return true;
        });
        post('enablePush');
        await settle();

        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ permissions: ['notifications:push'], app_uid: 'app-1' });
        expect(permissionDialog).toHaveBeenCalledTimes(1);
        expect(permissionDialog).toHaveBeenCalledWith(expect.objectContaining({
            permission: 'notifications:push',
            app_uid: 'app-1',
            app_name: 'team-chat',
        }));
        expect(dialog).not.toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'on', original_msg_id: 'cb-1' },
            '*',
        );
    });

    it('answers off when the user denies the permission', async () => {
        holds(false);
        browser.registered = true;
        permissionDialog.mockResolvedValue(false);
        post('enablePush');
        await settle();

        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'off', original_msg_id: 'cb-1' },
            '*',
        );
    });

    it.each([
        ['blocked', () => {
            browser.permission = 'denied';
        }],
        ['unavailable', () => {
            browser.broken = true;
        }],
    ])('asks nothing of an app without the permission when this browser is %s', async (state, setUp) => {
        holds(false);
        setUp();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        post('enablePush');
        await settle();
        warn.mockRestore();

        expect(permissionDialog).not.toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state, original_msg_id: 'cb-1' },
            '*',
        );
    });

    it('answers a second call unavailable while the permission dialog is up', async () => {
        holds(false);
        let finish;
        permissionDialog.mockImplementation(() => new Promise((resolve) => {
            finish = resolve;
        }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        post('enablePush');
        await settle();
        post('enablePush');
        await settle();

        expect(permissionDialog).toHaveBeenCalledTimes(1);
        expect(posted).toHaveBeenCalledWith(
            { msg: 'pushEnabled', state: 'unavailable', original_msg_id: 'cb-1' },
            '*',
        );
        finish(false);
        await settle();
        warn.mockRestore();
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
