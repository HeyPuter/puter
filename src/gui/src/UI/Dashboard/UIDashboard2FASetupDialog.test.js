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
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../../util/openid.js', () => ({ openRevalidatePopup: vi.fn(async () => {}) }));
// Draws with the QRCode library and can open a window; stand in an image.
vi.mock('../UIQRCode.js', () => ({
    default: vi.fn(({ value, appendTo }) => {
        jQuery(appendTo).append(`<div class="qr-code"><img alt="" data-value="${value}"></div>`);
    }),
}));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });

const { default: UIDashboard2FASetupDialog } = await import('./UIDashboard2FASetupDialog.js');
const { openRevalidatePopup } = await import('../../util/openid.js');
const { default: UIQRCode } = await import('../UIQRCode.js');

const SETUP = {
    url: 'otpauth://totp/Puter:alice?secret=JBSWY3DPEHPK3PXP&issuer=Puter',
    codes: ['AAAA1111', 'BBBB2222', 'CCCC<33>', 'DDDD4444'],
};

const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });
const bodyOf = (index) => JSON.parse(fetch.mock.calls[index][1].body);
const settle = async () => {
    for ( let i = 0; i < 10; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};
const screen = () => Number($('.tfa-screen').filter((_, el) => ! el.hidden).attr('data-screen'));
const action = (n) => $(`.tfa-action[data-screen="${n}"]`);
const password = () => $('.dashboard-form-input[name="password"]');
const identityStatus = () => $('.tfa-identity-status').text();
const codeStatus = () => $('.tfa-code-status').text();
const inputs = () => $('.login-2fa-code-inputs input');
const isOpen = () => $('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show');
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const clickBackdrop = () => {
    // A closed overlay stays in the page while it fades out.
    const $overlay = $('.dashboard-dialog-overlay').last();
    $overlay.trigger($.Event('mousedown', { target: $overlay.get(0), detail: 1 }));
    $overlay.trigger($.Event('click', { target: $overlay.get(0) }));
};

/** Opens the dialog; `result` fills in when its promise settles. */
const open = async (user = {}) => {
    window.user = { username: 'alice', otp: false, ...user };
    const result = { settled: false, value: undefined };
    UIDashboard2FASetupDialog().then((value) => Object.assign(result, { settled: true, value }));
    await settle();
    return result;
};

const confirmPassword = async (value = 'hunter2') => {
    password().val(value);
    action(0).trigger('click');
    await settle();
};

/** Types one digit per box, as a keyboard would. */
const typeCode = async (code) => {
    [...code].forEach((digit, i) => inputs().eq(i).val(digit).trigger('input'));
    await settle();
};

/** Walks from the password to the code entry. */
const reachVerify = async () => {
    fetch.mockResolvedValueOnce(reply(200, SETUP));
    const result = await open();
    await confirmPassword();
    action(1).trigger('click');
    $('.tfa-confirmations input').prop('checked', true).trigger('change');
    action(2).trigger('click');
    return result;
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = vi.fn();
    globalThis.puter = { authToken: 'tok-1' };
    window.gui_origin = 'https://puter.test';
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'tok-1';
    window.handleReauthRequired = vi.fn();
    openRevalidatePopup.mockClear();
    UIQRCode.mockClear();
    vi.useRealTimers();
});

describe('2FA setup: confirming identity', () => {
    it('opens as a dashboard dialog card asking for the password', async () => {
        await open();
        expect($('.dashboard-dialog-overlay .dashboard-tfa-dialog').length).toBe(1);
        expect($('.window').length).toBe(0);
        expect(screen()).toBe(0);
        expect($('.tfa-progress').prop('hidden')).toBe(true);
        expect(document.activeElement).toBe(password().get(0));
    });

    it('asks for the password before sending anything', async () => {
        const result = await open();
        await confirmPassword('');
        expect(fetch).not.toHaveBeenCalled();
        expect(identityStatus()).toBe('all_fields_required');
        expect(screen()).toBe(0);
        expect(result.settled).toBe(false);
    });

    it('requests the secret with the password and the session cookie, then shows the QR code and secret', async () => {
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        await open();
        await confirmPassword();

        expect(String(fetch.mock.calls[0][0])).toBe('https://puter.test/user-protected/setup-2fa');
        expect(fetch.mock.calls[0][1].credentials).toBe('include');
        expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(bodyOf(0)).toEqual({ password: 'hunter2' });
        expect(screen()).toBe(1);
        expect($('.tfa-progress').prop('hidden')).toBe(false);
        expect(UIQRCode).toHaveBeenCalledWith(expect.objectContaining({ value: SETUP.url }));
        expect($('.tfa-qr-area img').length).toBe(1);
        expect($('.tfa-secret-key').text()).toBe('JBSWY3DPEHPK3PXP');
        expect($('.tfa-secret-row').prop('hidden')).toBe(false);
    });

    it('submits on Enter in the password field', async () => {
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        await open();
        password().val('hunter2').trigger($.Event('keydown', { key: 'Enter' }));
        await settle();
        expect(bodyOf(0)).toEqual({ password: 'hunter2' });
        expect(screen()).toBe(1);
    });

    it('stays on the password with the reason when it is refused, and allows a retry', async () => {
        fetch.mockResolvedValueOnce(reply(400, { code: 'password_mismatch', message: 'Password mismatch' }));
        const result = await open();
        await confirmPassword('nope');

        expect(screen()).toBe(0);
        expect(identityStatus()).toBe('incorrect_password');
        expect(password().attr('aria-invalid')).toBe('true');
        expect(action(0).prop('disabled')).toBe(false);
        expect(result.settled).toBe(false);

        fetch.mockResolvedValueOnce(reply(200, SETUP));
        await confirmPassword();
        expect(screen()).toBe(1);
    });

    it('shows the server message for other refusals (2FA already on)', async () => {
        fetch.mockResolvedValueOnce(reply(409, { message: '2FA is already enabled' }));
        await open();
        await confirmPassword();
        expect(identityStatus()).toBe('2FA is already enabled');
        expect(screen()).toBe(0);
    });

    it('says something went wrong when the request gets no answer', async () => {
        fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await open();
        await confirmPassword();
        expect(identityStatus()).toBe('something_went_wrong');
        expect(action(0).prop('disabled')).toBe(false);
    });

    it('signs a provider-only account in with its provider instead of a password', async () => {
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        await open({ oidc_only: true, oidc_revalidate_url: 'https://puter.test/revalidate' });
        expect(password().length).toBe(0);
        expect($('.tfa-screen[data-screen="0"] .tfa-instruction').text()).toBe('revalidate_flow_notice');

        action(0).trigger('click');
        await settle();

        expect(openRevalidatePopup).toHaveBeenCalledWith('https://puter.test/revalidate');
        expect(bodyOf(0)).toEqual({});
        expect(screen()).toBe(1);
    });

    it('sends nothing when the provider sign-in does not finish', async () => {
        openRevalidatePopup.mockRejectedValueOnce(new Error('closed'));
        await open({ oidc_only: true });
        action(0).trigger('click');
        await settle();
        expect(fetch).not.toHaveBeenCalled();
        expect(identityStatus()).toBe('revalidate_failed');
        expect(screen()).toBe(0);
    });

    it('signs in with the provider when the server asks for it, then retries without the password', async () => {
        fetch.mockResolvedValueOnce(reply(403, { code: 'oidc_revalidation_required', revalidate_url: 'https://puter.test/revalidate' }))
            .mockResolvedValueOnce(reply(200, SETUP));
        await open();
        await confirmPassword();
        expect(openRevalidatePopup).toHaveBeenCalledWith('https://puter.test/revalidate');
        expect(bodyOf(1)).toEqual({});
        expect(screen()).toBe(1);
    });

    it('renews a missing session cookie and retries', async () => {
        fetch.mockResolvedValueOnce(reply(401, { code: 'token_missing' }))
            .mockResolvedValueOnce(reply(200))
            .mockResolvedValueOnce(reply(200, SETUP));
        await open();
        await confirmPassword();
        expect(String(fetch.mock.calls[1][0])).toContain('/session/sync-cookie');
        expect(bodyOf(2)).toEqual({ password: 'hunter2' });
        expect(screen()).toBe(1);
    });

    it('starts the sign-in flow when the session cookie cannot be renewed', async () => {
        fetch.mockResolvedValueOnce(reply(401, { code: 'reauth_required', reason: 'legacy', auth_id: 'a1' }))
            .mockResolvedValueOnce(reply(401));
        await open();
        await confirmPassword();
        expect(String(fetch.mock.calls[1][0])).toContain('/session/sync-cookie');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(window.handleReauthRequired).toHaveBeenCalledWith({ reason: 'legacy', auth_id: 'a1' });
        expect(identityStatus()).toBe('reauth_required_message');
        expect(screen()).toBe(0);
    });
});

describe('2FA setup: recovery codes', () => {
    it('lists the codes encoded and holds Continue until both boxes are ticked', async () => {
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        await open();
        await confirmPassword();
        action(1).trigger('click');

        expect(screen()).toBe(2);
        expect($('.tfa-code-item').map((_, el) => el.textContent).get())
            .toEqual(['1.AAAA1111', '2.BBBB2222', '3.CCCC<33>', '4.DDDD4444']);
        expect(action(2).prop('disabled')).toBe(true);

        const $boxes = $('.tfa-confirmations input');
        $boxes.eq(0).prop('checked', true).trigger('change');
        expect(action(2).prop('disabled')).toBe(true);
        $boxes.eq(1).prop('checked', true).trigger('change');
        expect(action(2).prop('disabled')).toBe(false);
        $boxes.eq(0).prop('checked', false).trigger('change');
        expect(action(2).prop('disabled')).toBe(true);
    });

    it('copies the secret and the recovery codes', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        await open();
        await confirmPassword();

        $('.tfa-copy-secret').trigger('click');
        expect(writeText).toHaveBeenLastCalledWith('JBSWY3DPEHPK3PXP');
        $('.tfa-copy-codes').trigger('click');
        expect(writeText).toHaveBeenLastCalledWith(SETUP.codes.join('\n'));
        expect($('.tfa-copy-codes span').text()).toBe('copied');
    });
});

describe('2FA setup: verifying the code', () => {
    it('enables 2FA with the bearer token once six digits are typed, and resolves true on Done', async () => {
        const result = await reachVerify();
        expect(screen()).toBe(3);
        expect($('.dashboard-dialog-footer').prop('hidden')).toBe(true);
        fetch.mockResolvedValueOnce(reply(200, {}));

        await typeCode('12345');
        expect(fetch).toHaveBeenCalledTimes(1);
        inputs().eq(5).val('6').trigger('input');
        await settle();

        expect(String(fetch.mock.calls[1][0])).toBe('https://api.puter.test/auth/configure-2fa/enable');
        expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-1');
        expect(bodyOf(1)).toEqual({ code: '123456' });
        expect(screen()).toBe(4);
        expect(result.settled).toBe(false);

        action(4).trigger('click');
        await settle();
        expect(result).toEqual({ settled: true, value: true });
        expect(isOpen()).toBe(false);
    });

    it('keeps only digits, one per box', async () => {
        await reachVerify();
        inputs().eq(0).val('a7b').trigger('input');
        expect(inputs().eq(0).val()).toBe('7');
        inputs().eq(1).val('x').trigger('input');
        expect(inputs().eq(1).val()).toBe('');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('takes a pasted code and submits it', async () => {
        await reachVerify();
        fetch.mockResolvedValueOnce(reply(200, {}));
        inputs().eq(0).trigger($.Event('paste', { originalEvent: { preventDefault () {}, clipboardData: { getData: () => ' 654 321 ' } } }));
        await settle();
        expect(bodyOf(1)).toEqual({ code: '654321' });
        expect(screen()).toBe(4);
    });

    it('reports a wrong code, then clears the boxes for another try', async () => {
        const result = await reachVerify();
        fetch.mockResolvedValueOnce(reply(400, { code: 'code_mismatch' }));
        await typeCode('111111');

        expect(screen()).toBe(3);
        expect(codeStatus()).toBe('confirm_code_generic_incorrect');
        expect(inputs().prop('disabled')).toBe(false);
        expect(inputs().first().hasClass('login-2fa-wrong')).toBe(true);
        expect(result.settled).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 1300));
        expect(inputs().map((_, el) => el.value).get().join('')).toBe('');
        expect(inputs().first().hasClass('login-2fa-wrong')).toBe(false);

        fetch.mockResolvedValueOnce(reply(200, {}));
        await typeCode('222222');
        expect(bodyOf(2)).toEqual({ code: '222222' });
        expect(screen()).toBe(4);
    });

    it('gives the boxes back when the request gets no answer', async () => {
        await reachVerify();
        fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await typeCode('111111');
        expect(codeStatus()).toBe('something_went_wrong');
        expect(inputs().prop('disabled')).toBe(false);
        expect(screen()).toBe(3);
    });

    it('does not send a second request while one is out', async () => {
        await reachVerify();
        let answer;
        fetch.mockReturnValueOnce(new Promise((resolve) => {
            answer = resolve;
        }));
        await typeCode('111111');
        inputs().eq(5).val('1').trigger('input');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(inputs().prop('disabled')).toBe(true);
        answer(reply(200, {}));
        await settle();
        expect(screen()).toBe(4);
    });
});

describe('2FA setup: closing', () => {
    it('resolves false when closed before 2FA is enabled', async () => {
        const result = await open();
        $('.dashboard-dialog-close').trigger('click');
        await settle();
        expect(result).toEqual({ settled: true, value: false });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('resolves false on Escape while the recovery codes are showing', async () => {
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        const result = await open();
        await confirmPassword();
        escape();
        await settle();
        expect(result).toEqual({ settled: true, value: false });
    });

    it('closes on a backdrop click only while nothing shown once is on screen', async () => {
        fetch.mockResolvedValueOnce(reply(200, SETUP));
        const result = await open();
        await confirmPassword();
        clickBackdrop();
        await settle();
        expect(isOpen()).toBe(true);
        expect(result.settled).toBe(false);

        $('.dashboard-dialog-close').trigger('click');
        await settle();
        expect(result).toEqual({ settled: true, value: false });

        const second = await open();
        clickBackdrop();
        await settle();
        expect(second).toEqual({ settled: true, value: false });
    });

    it.each([
        ['Escape', escape],
        ['the backdrop', clickBackdrop],
        ['the close button', () => $('.dashboard-dialog-close').trigger('click')],
    ])('resolves true when the success screen is closed with %s', async (_name, dismiss) => {
        const result = await reachVerify();
        fetch.mockResolvedValueOnce(reply(200, {}));
        await typeCode('123456');
        expect(screen()).toBe(4);

        dismiss();
        await settle();
        expect(result).toEqual({ settled: true, value: true });
    });

    it('stays up on Escape while the code is being checked, and resolves false if closed anyway', async () => {
        const result = await reachVerify();
        let answer;
        fetch.mockReturnValueOnce(new Promise((resolve) => {
            answer = resolve;
        }));
        await typeCode('123456');

        escape();
        await settle();
        expect(isOpen()).toBe(true);
        expect(result.settled).toBe(false);

        $('.dashboard-dialog-close').trigger('click');
        await settle();
        expect(result).toEqual({ settled: true, value: false });
        answer(reply(200, {}));
        await settle();
    });
});
