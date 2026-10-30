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

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
globalThis.i18n = (key) => key;
window.user = { uuid: 'u-1' };
window.gui_params = { pushEnabled: true };
window.get_apps = vi.fn(async () => ({ title: 'Team Chat', icon: null }));
// jsdom has no top-layer dialogs and reports the document unfocused.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
};
document.hasFocus = () => true;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeClient = (status) => ({
    enable: vi.fn(async () => ({ deviceUid: 'dev-new' })),
    disable: vi.fn(async () => {}),
    status: vi.fn(async () => status),
});

let UIEnablePushDialog;
let INPUT_PROTECTION_MS;
let registerPushClient;

/** Waits until the dialog is up and its buttons take clicks. */
const shown = async () => {
    await vi.waitFor(() => expect(document.querySelector('.enable-push-dialog')).not.toBeNull());
    await wait(INPUT_PROTECTION_MS + 50);
};

beforeEach(async () => {
    vi.resetModules();
    ({ default: UIEnablePushDialog } = await import('./UIEnablePushDialog.js'));
    ({ INPUT_PROTECTION_MS } = await import('./UIPermissionDialog.js'));
    ({ registerPushClient } = await import('../helpers/pushClient.js'));
    document.body.innerHTML = '';
    window.gui_params = { pushEnabled: true };
    localStorage.clear();
});

describe('the enable-push dialog', () => {
    it.each([
        ['on', { permission: 'granted', registered: true, deviceUid: 'dev-1' }],
        ['blocked', { permission: 'denied', registered: false }],
    ])('answers %s without a dialog', async (state, status) => {
        registerPushClient(fakeClient(status));
        await expect(UIEnablePushDialog({ origin: 'https://chat.example' })).resolves.toBe(state);
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('answers unavailable without a dialog when no client registers', async () => {
        window.gui_params = { pushEnabled: false };
        await expect(UIEnablePushDialog({ origin: 'https://chat.example' })).resolves.toBe('unavailable');
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('names the site, then turns push on from the button', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        registerPushClient(client);
        localStorage.setItem('puter.push.browser-off:u-1', '1');

        const result = UIEnablePushDialog({ origin: 'https://chat.example' });
        await shown();
        expect($('.perm-dialog-entity-name').text()).toBe('chat.example');
        expect($('.perm-dialog-lead').text()).toBe('enable_push_lead');
        $('.perm-dialog-allow').trigger('click');

        await expect(result).resolves.toBe('on');
        expect(client.enable).toHaveBeenCalledTimes(1);
        expect(document.querySelector('dialog')).toBeNull();
        expect(localStorage.getItem('puter.push.browser-off:u-1')).toBeNull();
    });

    it('names the app by its title', async () => {
        registerPushClient(fakeClient({ permission: 'default', registered: false }));
        const result = UIEnablePushDialog({ app_name: 'team-chat' });
        await shown();
        expect($('.perm-dialog-entity-name').text()).toBe('Team Chat');
        expect($('.perm-dialog-entity-origin').text()).toBe('team-chat');
        $('.perm-dialog-deny').trigger('click');
        await expect(result).resolves.toBe('off');
    });

    it('answers off from Not now and from Escape', async () => {
        registerPushClient(fakeClient({ permission: 'default', registered: false }));
        const first = UIEnablePushDialog({ origin: 'https://chat.example' });
        await shown();
        $('.perm-dialog-deny').trigger('click');
        await expect(first).resolves.toBe('off');

        const second = UIEnablePushDialog({ origin: 'https://chat.example' });
        await shown();
        document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
        await expect(second).resolves.toBe('off');
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('answers blocked when the browser refused the prompt', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        client.enable.mockRejectedValue(new Error('permission_denied'));
        registerPushClient(client);
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

        const result = UIEnablePushDialog({ origin: 'https://chat.example' });
        await shown();
        client.status.mockResolvedValue({ permission: 'denied', registered: false });
        $('.perm-dialog-allow').trigger('click');

        await expect(result).resolves.toBe('blocked');
        debug.mockRestore();
    });

    describe('with the clock under control', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => {
            vi.useRealTimers();
            delete globalThis.Notification;
        });

        const shownFake = async () => {
            await vi.waitFor(() => expect(document.querySelector('.enable-push-dialog')).not.toBeNull());
            await vi.advanceTimersByTimeAsync(INPUT_PROTECTION_MS + 50);
        };

        it('waits as long as the browser prompt is open, then settles on when it registers', async () => {
            globalThis.Notification = { permission: 'default' };
            const client = fakeClient({ permission: 'default', registered: false });
            let finish;
            client.enable.mockImplementation(() => new Promise((resolve) => {
                finish = resolve;
            }));
            registerPushClient(client);

            const result = UIEnablePushDialog({ origin: 'https://chat.example' });
            await shownFake();
            $('.perm-dialog-allow').trigger('click');
            await vi.advanceTimersByTimeAsync(60_000);
            expect($('.perm-dialog-error').text()).toBe('');
            expect($('.perm-dialog-not-now, .perm-dialog-deny').prop('disabled')).toBe(true);
            expect(document.querySelector('dialog')).not.toBeNull();

            globalThis.Notification.permission = 'granted';
            finish({ deviceUid: 'dev-new' });
            await vi.advanceTimersByTimeAsync(10);
            await expect(result).resolves.toBe('on');
            expect(client.enable).toHaveBeenCalledTimes(1);
        });

        it('keeps the one registration after its deadline and settles on when it resolves', async () => {
            globalThis.Notification = { permission: 'granted' };
            const client = fakeClient({ permission: 'granted', registered: false });
            let finish;
            client.enable.mockImplementation(() => new Promise((resolve) => {
                finish = resolve;
            }));
            registerPushClient(client);

            const result = UIEnablePushDialog({ origin: 'https://chat.example' });
            await shownFake();
            $('.perm-dialog-allow').trigger('click');
            await vi.advanceTimersByTimeAsync(16_000);
            expect($('.perm-dialog-error').text()).toBe('push_enable_failed');
            expect($('.perm-dialog-allow').prop('disabled')).toBe(true);
            expect($('.perm-dialog-deny').prop('disabled')).toBe(false);
            $('.perm-dialog-allow').trigger('click');
            expect(client.enable).toHaveBeenCalledTimes(1);

            finish({ deviceUid: 'dev-new' });
            await vi.advanceTimersByTimeAsync(10);
            await expect(result).resolves.toBe('on');
        });

        it('stops the spinner and offers a retry when the registration fails after its deadline', async () => {
            globalThis.Notification = { permission: 'granted' };
            const client = fakeClient({ permission: 'granted', registered: false });
            let fail;
            client.enable.mockImplementationOnce(() => new Promise((_, reject) => {
                fail = reject;
            }));
            registerPushClient(client);
            const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

            const result = UIEnablePushDialog({ origin: 'https://chat.example' });
            await shownFake();
            $('.perm-dialog-allow').trigger('click');
            await vi.advanceTimersByTimeAsync(16_000);
            expect($('.perm-dialog-allow').hasClass('perm-dialog-busy')).toBe(true);
            expect($('.perm-dialog-allow').prop('disabled')).toBe(true);

            fail(new Error('no_worker'));
            await vi.advanceTimersByTimeAsync(10);
            expect($('.perm-dialog-allow').hasClass('perm-dialog-busy')).toBe(false);
            expect($('.perm-dialog-allow').prop('disabled')).toBe(false);

            $('.perm-dialog-allow').trigger('click');
            await vi.advanceTimersByTimeAsync(10);
            await expect(result).resolves.toBe('on');
            expect(client.enable).toHaveBeenCalledTimes(2);
            debug.mockRestore();
        });
    });

    it('offers a retry when registering failed and push is still off', async () => {
        const client = fakeClient({ permission: 'default', registered: false });
        client.enable.mockRejectedValueOnce(new Error('no_worker'));
        registerPushClient(client);
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

        const result = UIEnablePushDialog({ origin: 'https://chat.example' });
        await shown();
        $('.perm-dialog-allow').trigger('click');
        await vi.waitFor(() => expect($('.perm-dialog-error').text()).toBe('push_enable_failed'));
        expect($('.perm-dialog-error').css('display')).not.toBe('none');
        expect($('.perm-dialog-allow').prop('disabled')).toBe(false);
        $('.perm-dialog-allow').trigger('click');

        await expect(result).resolves.toBe('on');
        expect(client.enable).toHaveBeenCalledTimes(2);
        debug.mockRestore();
    });
});
