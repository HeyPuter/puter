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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

// Renders the body and, as the real window does, asks on_before_exit before
// closing and runs on_close once it's removed.
vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        const el = document.createElement('div');
        el.className = `window ${opts.window_class}`;
        el.innerHTML = opts.body_content;
        el.onClose = opts.on_close;
        el.onBeforeExit = opts.on_before_exit;
        document.body.append(el);
        return el;
    }),
}));
vi.mock('./UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowPhoneVerificationRequired.js', () => ({ default: vi.fn(async () => true) }));
vi.mock('./UIWindowCardVerificationRequired.js', () => ({ default: vi.fn(async () => true) }));
vi.mock('../helpers/postUserProtected.js', () => ({ default: vi.fn() }));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindowEmailConfirmationRequired } = await import('./UIWindowEmailConfirmationRequired.js');
const { default: UIWindowPhoneVerificationRequired } = await import('./UIWindowPhoneVerificationRequired.js');
const { default: postUserProtected } = await import('../helpers/postUserProtected.js');

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r(PENDING), 0))]);
const win = () => jQuery('.window-confirm-email-using-code');

/** Opens the window and waits for it to render. Returns its answer, still pending. */
const open = async (options) => {
    const result = UIWindowEmailConfirmationRequired(options);
    await vi.waitFor(() => expect(win()).toHaveLength(1));
    return { result };
};

const enterCode = () => {
    const first = document.querySelector('[data-number-code-input="0"]');
    first.value = '123456';
    first.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = function () {
        this.each((_, el) => {
            if ( ! el.isConnected || el.onBeforeExit?.() === false ) return;
            el.remove();
            el.onClose?.();
        });
        return this;
    };
    globalThis.i18n = (key) => key;
    globalThis.html_encode = (value) => String(value);
    window.icons = {};
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'token-1';
    window.user = { email: 'a@b.test', email_confirmed: false };
    window.refresh_user_data = vi.fn();
    window.logout = vi.fn();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete jQuery.fn.close;
});

describe('UIWindowEmailConfirmationRequired', () => {
    it('resolves true once the code confirms the email, and says so on window.user straight away', async () => {
        const ajax = vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.success({ email_confirmed: true });
            opts.complete?.();
        });
        const { result } = await open();
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        await expect(result).resolves.toBe(true);
        expect(ajax).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://api.puter.test/confirm-email',
            data: JSON.stringify({ code: '123456' }),
        }));
        // Callers read it next, before the refresh lands.
        expect(window.user.email_confirmed).toBe(true);
        expect(window.refresh_user_data).toHaveBeenCalledWith('token-1');
        expect(win()).toHaveLength(0);
    });

    it('stays open on a wrong code', async () => {
        vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.success({ email_confirmed: false });
            opts.complete?.();
        });
        const { result } = await open();
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        expect(await settled(result)).toBe(PENDING);
        expect(win()).toHaveLength(1);
        expect(window.user.email_confirmed).toBe(false);
    });

    it.each([
        ['the server\'s error', { status: 429, responseJSON: { error: 'Too many requests.' } }, 'Too many requests.'],
        ['an unknown error on a network failure', { status: 0 }, 'error_unknown_cause'],
    ])('shows %s and lets the user try again', async (_label, xhr, shown) => {
        vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.error(xhr);
            opts.complete?.();
        });
        const { result } = await open();
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        expect(win().find('.error').text()).toBe(shown);
        expect(win().find('.digit-input').prop('disabled')).toBe(false);
        expect(win().find('.email-confirm-btn').text()).toBe('Confirm Email');
        expect(await settled(result)).toBe(PENDING);
    });

    it('takes the code typed in a second window open over another', async () => {
        const ajax = vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            opts.success({ email_confirmed: true });
            opts.complete?.();
        });
        const { result: under } = await open();
        const over = UIWindowEmailConfirmationRequired();
        await vi.waitFor(() => expect(win()).toHaveLength(2));
        vi.useFakeTimers();
        const first = win().get(1).querySelector('[data-number-code-input="0"]');
        first.value = '123456';
        first.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        await expect(over).resolves.toBe(true);
        expect(ajax).toHaveBeenCalledWith(expect.objectContaining({ data: JSON.stringify({ code: '123456' }) }));
        expect(win()).toHaveLength(1);
        expect(await settled(under)).toBe(PENDING);
    });

    it.each([
        ['the server\'s error', { status: 429, responseJSON: { error: 'Too many requests.' } }, 'Too many requests.'],
        ['an unknown error on a network failure', { status: 0 }, 'error_unknown_cause'],
    ])('shows %s when a new code can\'t be sent', async (_label, xhr, shown) => {
        const ajax = vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => opts.error(xhr));
        await open();
        win().find('.send-conf-email').trigger('click');

        expect(ajax).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.puter.test/send-confirm-email' }));
        expect(win().find('.error').text()).toBe(shown);
    });

    it('resolves false when it closes without a confirmation', async () => {
        const { result } = await open();
        win().close();
        await expect(result).resolves.toBe(false);
    });

    it('sends no code when it closes before the code is sent', async () => {
        const ajax = vi.spyOn(jQuery, 'ajax').mockImplementation(() => {});
        const { result } = await open();
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(500);
        win().close();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        await expect(result).resolves.toBe(false);
        expect(ajax).not.toHaveBeenCalled();
        expect(window.user.email_confirmed).toBe(false);
    });

    it.each([
        ['true when the code confirms the email', { email_confirmed: true }, true],
        ['false when it doesn\'t', { email_confirmed: false }, false],
    ])('waits for a code already sent when asked to close, and resolves %s', async (_label, answer, expected) => {
        let respond;
        vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            respond = () => {
                opts.success(answer);
                opts.complete();
            };
        });
        const { result } = await open();
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();
        win().close();
        expect(win()).toHaveLength(1);
        expect(await settled(result)).toBe(PENDING);

        respond();
        await expect(result).resolves.toBe(expected);
        expect(win()).toHaveLength(0);
        expect(window.user.email_confirmed).toBe(expected);
    });

    it('closes once a code already sent fails, when asked to close meanwhile', async () => {
        let fail;
        vi.spyOn(jQuery, 'ajax').mockImplementation((opts) => {
            fail = () => {
                opts.error({ status: 0 });
                opts.complete();
            };
        });
        const { result } = await open();
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();
        win().close();
        fail();

        await expect(result).resolves.toBe(false);
        expect(win()).toHaveLength(0);
    });

    it('closes for a logout from its footer while a code is being checked', async () => {
        vi.spyOn(jQuery, 'ajax').mockImplementation(() => {});
        const { result } = await open({ logout_in_footer: true });
        vi.useFakeTimers();
        enterCode();
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();
        win().find('.conf-email-log-out').trigger('click');

        expect(win()).toHaveLength(0);
        expect(await settled(result)).toBe(PENDING);
    });

    it('stays unsettled when a logout elsewhere closes it, so a gate doesn\'t reopen it', async () => {
        const { result } = await open();
        // As the logout handler leaves things when it closes every window.
        window.auth_token = null;
        win().close();
        expect(win()).toHaveLength(0);
        expect(await settled(result)).toBe(PENDING);
    });

    it('stays unsettled on a logout from its footer, so a gate doesn\'t reopen it', async () => {
        const { result } = await open({ logout_in_footer: true });
        win().find('.conf-email-log-out').trigger('click');
        expect(window.logout).toHaveBeenCalledTimes(1);
        expect(win()).toHaveLength(0);
        expect(await settled(result)).toBe(PENDING);
    });
});

describe('UIWindowEmailConfirmationRequired replacing the address', () => {
    beforeEach(() => {
        postUserProtected.mockReset();
        UIWindowPhoneVerificationRequired.mockReset();
        UIWindowPhoneVerificationRequired.mockResolvedValue(true);
    });

    const submitChange = async (email = 'new@b.test') => {
        win().find('.change-conf-email').trigger('click');
        win().find('.email-change-new').val(email);
        win().find('.email-change-password').val('pw');
        win().find('.email-change-form').trigger('submit');
    };

    it('opens the phone step the account still owes, then retries the change', async () => {
        postUserProtected
            .mockResolvedValueOnce({ ok: false, data: { code: 'phone_verification_required' }, message: 'verify' })
            .mockResolvedValueOnce({ ok: true, data: {} });
        await open();
        await submitChange();

        await vi.waitFor(() => expect(win().find('.email-change-sent').css('display')).not.toBe('none'));
        // Read first, so the phone window knows which number the code goes to.
        expect(window.refresh_user_data).toHaveBeenCalled();
        expect(UIWindowPhoneVerificationRequired).toHaveBeenCalledWith(expect.not.objectContaining({ card_alternative: true }));
        expect(postUserProtected).toHaveBeenCalledTimes(2);
        expect(postUserProtected).toHaveBeenLastCalledWith('change-email', { new_email: 'new@b.test', code: undefined }, { password: 'pw' });
    });

    it('says the code is needed when nothing on the account vouches for the change', async () => {
        postUserProtected.mockResolvedValueOnce({ ok: false, data: { code: 'email_confirmation_required' }, message: 'Please confirm your email to continue' });
        await open();
        await submitChange();

        await vi.waitFor(() => expect(win().find('.email-change-form .email-change-error').text()).toBe('email_change_needs_code'));
        expect(UIWindowPhoneVerificationRequired).not.toHaveBeenCalled();
        expect(postUserProtected).toHaveBeenCalledTimes(1);
    });

    it('stops when the verification is not completed', async () => {
        postUserProtected.mockResolvedValueOnce({ ok: false, data: { code: 'phone_verification_required' }, message: 'verify' });
        UIWindowPhoneVerificationRequired.mockResolvedValueOnce(false);
        await open();
        await submitChange();

        await vi.waitFor(() => expect(UIWindowPhoneVerificationRequired).toHaveBeenCalled());
        expect(postUserProtected).toHaveBeenCalledTimes(1);
        expect(win().find('.email-change-sent').css('display')).toBe('none');
    });

    it('resolves true once the new address is confirmed through its link', async () => {
        postUserProtected.mockResolvedValueOnce({ ok: true, data: {} });
        window.refresh_user_data = vi.fn(async () => {
            window.user = { email: 'new@b.test', email_confirmed: true };
        });
        const { result } = await open();
        await submitChange();
        await vi.waitFor(() => expect(win().find('.email-change-sent').css('display')).not.toBe('none'));
        win().find('.email-change-continue').trigger('click');

        await expect(result).resolves.toBe(true);
    });

    it('stays open while the new address is not confirmed yet', async () => {
        postUserProtected.mockResolvedValueOnce({ ok: true, data: {} });
        window.refresh_user_data = vi.fn(async () => {
            window.user = { email: 'a@b.test', email_confirmed: false, requires_email_confirmation: true };
        });
        const { result } = await open();
        await submitChange();
        await vi.waitFor(() => expect(win().find('.email-change-sent').css('display')).not.toBe('none'));
        win().find('.email-change-continue').trigger('click');

        await vi.waitFor(() => expect(win().find('.email-change-sent .email-change-error').text()).toBe('email_change_not_confirmed'));
        expect(await settled(result)).toBe(PENDING);
    });

    it('refuses the address already on the account without asking the server', async () => {
        await open();
        await submitChange('A@B.test');
        expect(postUserProtected).not.toHaveBeenCalled();
        expect(win().find('.email-change-form .email-change-error').text()).toBe('email_unchanged');
    });
});
