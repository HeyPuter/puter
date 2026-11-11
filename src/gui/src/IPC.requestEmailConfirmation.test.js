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

const { stub, confirmEmail, saveAccount } = vi.hoisted(() => ({
    stub: () => ({ default: () => {} }),
    confirmEmail: vi.fn(),
    saveAccount: vi.fn(),
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
vi.mock('./UI/UIWindowColorPicker.js', stub);
vi.mock('./UI/UIWindowEmailConfirmationRequired.js', () => ({ default: confirmEmail }));
vi.mock('./UI/UIWindowFontPicker.js', stub);
vi.mock('./UI/UIPermissionDialog.js', stub);
vi.mock('./UI/UIEnablePushDialog.js', stub);
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: saveAccount }));
vi.mock('./UI/Auth/UIAuthSignup.js', stub);
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
    confirmEmail.mockReset();
    saveAccount.mockReset();
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

const request = () =>
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { appInstanceID: 'inst-1', env: 'app', msg: 'requestEmailConfirmation', uuid: 'cb-1' },
            source: iframe.contentWindow,
            origin: 'https://app.example',
        }),
    );

const settle = () => new Promise((r) => setTimeout(r, 20));

const replies = () => posted.mock.calls
    .map(([data]) => data)
    .filter((data) => data.msg === 'requestEmailConfirmationResponded');

describe('requestEmailConfirmation', () => {
    it('answers a confirmed email true once, without a dialog', async () => {
        window.user = { email: 'a@b.test', email_confirmed: true };
        request();
        await settle();
        expect(replies()).toEqual([{ original_msg_id: 'cb-1', msg: 'requestEmailConfirmationResponded', response: true }]);
        expect(confirmEmail).not.toHaveBeenCalled();
        expect(saveAccount).not.toHaveBeenCalled();
    });

    it.each([true, false])('shows an unconfirmed email one dialog and answers its result, %s', async (answer) => {
        window.user = { email: 'a@b.test', email_confirmed: false };
        confirmEmail.mockResolvedValueOnce(answer);
        request();
        await settle();
        expect(confirmEmail).toHaveBeenCalledTimes(1);
        // The app's window stays on top in the dashboard, so the dialog has to as well.
        expect(confirmEmail).toHaveBeenCalledWith({ window_options: { stay_on_top: true } });
        expect(replies()).toEqual([{ original_msg_id: 'cb-1', msg: 'requestEmailConfirmationResponded', response: answer }]);
    });

    it('answers false once when a temporary account isn\'t saved', async () => {
        window.user = { is_temp: true };
        saveAccount.mockResolvedValueOnce(false);
        request();
        await settle();
        expect(saveAccount).toHaveBeenCalledTimes(1);
        expect(saveAccount.mock.calls[0][0].window_options).toMatchObject({ stay_on_top: true });
        expect(confirmEmail).not.toHaveBeenCalled();
        expect(replies()).toEqual([{ original_msg_id: 'cb-1', msg: 'requestEmailConfirmationResponded', response: false }]);
    });

    it('asks a temporary account that confirmed while saving for nothing more', async () => {
        window.user = { is_temp: true };
        saveAccount.mockImplementationOnce(async () => {
            window.user = { is_temp: false, email: 'a@b.test', email_confirmed: true };
            return true;
        });
        request();
        await settle();
        expect(confirmEmail).not.toHaveBeenCalled();
        expect(replies()).toEqual([{ original_msg_id: 'cb-1', msg: 'requestEmailConfirmationResponded', response: true }]);
    });
});
