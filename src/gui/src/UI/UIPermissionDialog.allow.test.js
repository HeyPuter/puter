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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
globalThis.i18n = (key) => key;
window.api_origin = 'https://api.puter.test';
window.auth_token = 'tok-1';
window.user = { uuid: 'u-1' };
window.gui_params = { pushEnabled: true };
// jsdom has no top-layer dialogs and reports the document unfocused.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
};
document.hasFocus = () => true;

let UIPermissionDialog;
let INPUT_PROTECTION_MS;
let registerPushClient;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeClient = (status) => ({
    enable: vi.fn(async () => ({ deviceUid: 'dev-new' })),
    disable: vi.fn(async () => {}),
    status: vi.fn(async () => status),
});

/** Waits until the dialog is up and its buttons take clicks. */
const shown = async () => {
    await vi.waitFor(() => expect(document.querySelector('.perm-dialog')).not.toBeNull());
    await wait(INPUT_PROTECTION_MS + 50);
};

const allow = () => $('.perm-dialog-allow').trigger('click');

let apps = 0;

beforeEach(async () => {
    vi.resetModules();
    ({ default: UIPermissionDialog, INPUT_PROTECTION_MS } = await import('./UIPermissionDialog.js'));
    ({ registerPushClient } = await import('../helpers/pushClient.js'));
    document.body.innerHTML = '';
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    window.gui_params = { pushEnabled: true };
    apps += 1;
});

describe('Allow on a request for notifications:push', () => {
    it('turns push on in this browser before the grant is sent, and says so', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        registerPushClient(client);
        const enabling = vi.fn();

        const decision = UIPermissionDialog({ permissions: ['notifications:push'], app_uid: `app-${apps}`, on_push_enable: enabling });
        await shown();
        expect($('.perm-dialog-push-note').text()).toBe('perm_dialog_push_note');
        allow();

        await expect(decision).resolves.toBe(true);
        expect(client.enable).toHaveBeenCalledTimes(1);
        expect(client.enable.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
        expect(enabling).toHaveBeenCalledTimes(1);
        await expect(enabling.mock.calls[0][0]).resolves.toBe(true);
    });

    it('grants even when turning push on fails', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        client.enable.mockRejectedValue(new Error('permission_denied'));
        registerPushClient(client);
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const enabling = vi.fn();

        const decision = UIPermissionDialog({ permissions: ['notifications:push'], app_uid: `app-${apps}`, on_push_enable: enabling });
        await shown();
        allow();

        await expect(decision).resolves.toBe(true);
        await expect(enabling.mock.calls[0][0]).resolves.toBe(false);
        expect(debug).toHaveBeenCalled();
        debug.mockRestore();
    });

    it('starts one registration however often Allow is retried', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        registerPushClient(client);
        fetch.mockResolvedValueOnce({ ok: false, status: 500 });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        const decision = UIPermissionDialog({ permissions: ['notifications:push'], app_uid: `app-${apps}` });
        await shown();
        allow();
        await vi.waitFor(() => expect($('.perm-dialog-error').text()).toBe('perm_dialog_error'));
        allow();

        await expect(decision).resolves.toBe(true);
        expect(client.enable).toHaveBeenCalledTimes(1);
        errors.mockRestore();
    });

    it('turns push back off, and restores the opt-out, when the grant fails and the user then denies', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        registerPushClient(client);
        localStorage.setItem('puter.push.browser-off:u-1', '1');
        fetch.mockResolvedValue({ ok: false, status: 500 });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        const decision = UIPermissionDialog({ permissions: ['notifications:push'], app_uid: `app-${apps}` });
        await shown();
        allow();
        await vi.waitFor(() => expect($('.perm-dialog-error').text()).toBe('perm_dialog_error'));
        expect(localStorage.getItem('puter.push.browser-off:u-1')).toBeNull();
        $('.perm-dialog-deny').trigger('click');

        await expect(decision).resolves.toBe(false);
        await vi.waitFor(() => expect(client.disable).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(localStorage.getItem('puter.push.browser-off:u-1')).toBe('1'));
        errors.mockRestore();
    });

    it.each([
        ['on', { permission: 'granted', registered: true, deviceUid: 'dev-1' }],
        ['blocked', { permission: 'denied', registered: false }],
    ])('leaves the browser alone when push is %s here', async (_state, status) => {
        const client = fakeClient(status);
        registerPushClient(client);
        const enabling = vi.fn();

        const decision = UIPermissionDialog({ permissions: ['notifications:push'], app_uid: `app-${apps}`, on_push_enable: enabling });
        await shown();
        expect($('.perm-dialog-push-note')).toHaveLength(0);
        allow();

        await expect(decision).resolves.toBe(true);
        expect(client.status).toHaveBeenCalled();
        expect(client.enable).not.toHaveBeenCalled();
        expect(enabling).not.toHaveBeenCalled();
    });

    it('leaves the browser alone when the server has push off and no client registers', async () => {
        window.gui_params = { pushEnabled: false };
        const enabling = vi.fn();

        const decision = UIPermissionDialog({ permissions: ['notifications:push'], app_uid: `app-${apps}`, on_push_enable: enabling });
        await shown();
        expect($('.perm-dialog-push-note')).toHaveLength(0);
        allow();

        await expect(decision).resolves.toBe(true);
        expect(enabling).not.toHaveBeenCalled();
    });

    it('turns push on for a batch that includes it, and grants the batch in one request', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        registerPushClient(client);
        const enabling = vi.fn();

        const decision = UIPermissionDialog({
            permissions: ['events:background', 'notifications:push'],
            app_uid: `app-${apps}`,
            on_push_enable: enabling,
        });
        await shown();
        expect($('.perm-dialog-push-note').text()).toBe('perm_dialog_push_note');
        allow();

        await expect(decision).resolves.toBe(true);
        expect(client.enable).toHaveBeenCalledTimes(1);
        expect(enabling).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetch.mock.calls[0][1].body).permissions).toEqual(['events:background', 'notifications:push']);
    });

    it('leaves the browser alone for a request without that permission', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        registerPushClient(client);
        const enabling = vi.fn();

        const decision = UIPermissionDialog({ permissions: ['events:background'], app_uid: `app-${apps}`, on_push_enable: enabling });
        await shown();
        allow();

        await expect(decision).resolves.toBe(true);
        expect(client.status).not.toHaveBeenCalled();
        expect(client.enable).not.toHaveBeenCalled();
        expect(enabling).not.toHaveBeenCalled();
    });
});
