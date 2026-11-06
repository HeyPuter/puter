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
import { reply, resetAuthGlobals, screen, tick } from './authTestSetup.js';

const gates = vi.hoisted(() => ({ email: vi.fn(), phone: vi.fn(), card: vi.fn() }));
vi.mock('../UIWindowEmailConfirmationRequired.js', () => ({ default: gates.email }));
vi.mock('../UIWindowPhoneVerificationRequired.js', () => ({ default: gates.phone }));
vi.mock('../UIWindowCardVerificationRequired.js', () => ({ default: gates.card }));

const { activeAuthFlow } = await import('./authFlow.js');
const { default: UIAuthSignup, signupRedirectUrl } = await import('./UIAuthSignup.js');
const { default: UIAuthAccountPicker } = await import('./UIAuthAccountPicker.js');
const { default: UIAuthRecoverPassword } = await import('./UIAuthRecoverPassword.js');

const providers = (body) => {
    globalThis.fetch = vi.fn(async () => reply(200, body));
};

const fillForm = () => {
    $('[name="username"]').val('someone');
    $('[name="email"]').val('someone@example.com');
    $('[name="password"]').val('a-Strong-pass-1');
    $('[name="confirm_password"]').val('a-Strong-pass-1');
};

const captureAjax = () => {
    const calls = [];
    vi.spyOn($, 'ajax').mockImplementation((opts) => {
        calls.push(opts);
    });
    return calls;
};

beforeEach(() => {
    resetAuthGlobals();
    gates.email.mockReset();
    gates.phone.mockReset();
    gates.card.mockReset();
});
afterEach(() => {
    activeAuthFlow()?.finish(false);
    vi.restoreAllMocks();
});

describe('signup when only OIDC signups are open', () => {
    const open = async () => {
        void UIAuthSignup({ reload_on_success: false });
        await vi.waitFor(() => expect($('.oidc-google-btn')).toHaveLength(1));
    };

    it('offers the email form behind a button normally', async () => {
        providers({ providers: ['google'], signupOidcOnly: false });
        await open();
        expect($('.signup-with-email-wrapper').prop('hidden')).toBe(false);
        expect($('.signup-form').prop('hidden')).toBe(true);
        $('.signup-with-email-btn').trigger('click');
        expect($('.signup-form').prop('hidden')).toBe(false);
    });

    it('drops the email form', async () => {
        providers({ providers: ['google'], signupOidcOnly: true });
        await open();
        expect($('.signup-form').prop('hidden')).toBe(true);
        expect($('.signup-with-email-wrapper').prop('hidden')).toBe(true);
    });

    it('switches to the providers when a form signup is refused for it', async () => {
        providers({ providers: ['google'], signupOidcOnly: false });
        await open();
        const calls = captureAjax();
        $('.signup-with-email-btn').trigger('click');
        fillForm();
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0].error({ responseText: JSON.stringify({ code: 'signup_oidc_only', message: 'closed' }) });
        await tick();
        expect($('.signup-form').prop('hidden')).toBe(true);
    });

    it.each([false, true])('keeps an error it opened with in view (OIDC only: %s)', async (signupOidcOnly) => {
        providers({ providers: ['google'], signupOidcOnly });
        void UIAuthSignup({ authError: 'Your account could not be created.' });
        await vi.waitFor(() => expect($('.oidc-google-btn')).toHaveLength(1));
        expect($('.signup-form').prop('hidden')).toBe(true);
        const $status = screen().find('.dashboard-form-status');
        expect($status.text()).toBe('Your account could not be created.');
        expect($status.closest('[hidden]')).toHaveLength(0);
    });

    it('leaves a form the user already typed into', async () => {
        let answer;
        globalThis.fetch = vi.fn(() => new Promise((resolve) => {
            answer = resolve;
        }));
        void UIAuthSignup();
        $('[name="username"]').val('started');
        answer(reply(200, { providers: ['google'] }));
        await vi.waitFor(() => expect($('.oidc-google-btn')).toHaveLength(1));
        expect($('.signup-form').prop('hidden')).toBe(false);
    });
});

describe('signup form', () => {
    it.each([
        [{}, 'username_required', 'username'],
        [{ username: 'a' }, 'email_required', 'email'],
        [{ username: 'a', email: 'nope' }, 'email_invalid', 'email'],
        [{ username: 'a', email: 'a@b.c' }, 'password_required', 'password'],
        [{ username: 'a', email: 'a@b.c', password: 'weak' }, 'password_strength_error', 'password'],
        [{ username: 'a', email: 'a@b.c', password: 'a-Strong-pass-1' }, 'confirm_password_required', 'confirm_password'],
        [{ username: 'a', email: 'a@b.c', password: 'a-Strong-pass-1', confirm_password: 'other' }, 'passwords_do_not_match', 'confirm_password'],
    ])('checks %j before sending', (values, message, field) => {
        const calls = captureAjax();
        void UIAuthSignup();
        for ( const [name, value] of Object.entries(values) ) $(`[name="${name}"]`).val(value);
        $('.signup-form').trigger('submit');
        expect(screen().find('.dashboard-form-status').text()).toBe(message);
        expect($(`[name="${field}"]`).attr('aria-invalid')).toBe('true');
        expect(calls).toHaveLength(0);
    });

    it('asks for the CAPTCHA when Turnstile is on', async () => {
        window.gui_params = { turnstileSiteKey: 'key' };
        window.turnstile = { render: vi.fn(() => 'widget'), reset: vi.fn() };
        const calls = captureAjax();
        void UIAuthSignup();
        expect(window.turnstile.render).toHaveBeenCalledWith($('.cf-turnstile').get(0), expect.objectContaining({ sitekey: 'key' }));
        fillForm();
        $('.signup-form').trigger('submit');
        expect(screen().find('.dashboard-form-status').text()).toBe('captcha_required');
        window.turnstile.render.mock.calls[0][1].callback('tok');
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].data)['cf-turnstile-response']).toBe('tok');
        calls[0].error({ responseText: '{"message":"no"}' });
        await tick();
        expect(window.turnstile.reset).toHaveBeenCalledWith('widget');
    });

    it('sends the honeypot, referrer, bonus code and confirmation setting', async () => {
        window.signup_bonus_code = 'BONUS';
        globalThis.fetch = vi.fn(async () => reply(200, { valid: true, display: { title: 'T', description: 'D' } }));
        const calls = captureAjax();
        void UIAuthSignup({ referrer: 'app-x', send_confirmation_code: true });
        fillForm();
        $('.p102xyzname').val('bot');
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].data)).toMatchObject({
            username: 'someone',
            email: 'someone@example.com',
            referrer: 'app-x',
            send_confirmation_code: true,
            p102xyzname: 'bot',
            bonusCode: 'BONUS',
        });
        expect(calls[0].timeout).toBe(30000);
    });

    it('drops a refused bonus code and says so', async () => {
        window.signup_bonus_code = 'BAD';
        const calls = captureAjax();
        void UIAuthSignup();
        fillForm();
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0].error({ responseText: JSON.stringify({ code: 'bonus_code_invalid' }) });
        await tick();
        expect(window.signup_bonus_code).toBeNull();
        expect(screen().find('.dashboard-form-status').text()).toBe('signup_bonus_code_invalid_retry');
        expect($('.signup-btn').prop('disabled')).toBe(false);
    });

    it('puts focus back in the form after the server refuses, so Enter can retry', async () => {
        const calls = captureAjax();
        void UIAuthSignup();
        fillForm();
        $('[name="confirm_password"]').get(0).focus();
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0].error({ responseText: '{"message":"This username is not available."}' });
        await tick();
        expect(screen().find('.dashboard-form-status').text()).toBe('This username is not available.');
        expect(document.activeElement).toBe($('[name="confirm_password"]').get(0));
    });

    it('covers the page when signups are blocked here', async () => {
        const calls = captureAjax();
        void UIAuthSignup();
        fillForm();
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0].error({ responseText: JSON.stringify({ code: 'signup_blocked', message: '<i>No</i>' }) });
        await tick();
        expect($('.signup-blocked-overlay').text()).toContain('<i>No</i>');
        expect($('.signup-blocked-overlay i')).toHaveLength(0);
    });

    it('runs the account checks after the card makes way, then settles', async () => {
        gates.email.mockResolvedValue(true);
        gates.phone.mockResolvedValueOnce(false).mockResolvedValueOnce('card');
        const calls = captureAjax();
        const result = UIAuthSignup({ reload_on_success: false, send_confirmation_code: true });
        fillForm();
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0].success({ token: 't', user: { requires_phone_verification: true, requires_card_verification: true } });
        await expect(result).resolves.toBe(true);
        expect($('.auth-dialog-overlay.dashboard-dialog-show')).toHaveLength(0);
        // email → phone (retried until passed) → card, which the phone's card fallback cleared.
        expect(gates.email).toHaveBeenCalledOnce();
        // Closing a check without an answer would strand the caller.
        for ( const gate of [gates.email, gates.phone] ) {
            expect(gate.mock.calls[0][0].show_close_button).toBe(false);
        }
        expect(gates.phone).toHaveBeenCalledTimes(2);
        expect(gates.card).not.toHaveBeenCalled();
    });

    it.each([
        [true, { cover_page: true, has_head: false }],
        [false, {}],
    ])('covers the page with the account checks when signup was a page (%s)', async (page, window_options) => {
        gates.email.mockResolvedValue(true);
        gates.phone.mockResolvedValue(true);
        gates.card.mockResolvedValue(true);
        const calls = captureAjax();
        const result = UIAuthSignup({ page, reload_on_success: false, send_confirmation_code: true });
        fillForm();
        $('.signup-form').trigger('submit');
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0].success({ token: 't', user: { requires_phone_verification: true, requires_card_verification: true } });
        await result;
        for ( const gate of [gates.email, gates.phone, gates.card] ) {
            expect(gate.mock.calls[0][0].window_options).toEqual(window_options);
        }
    });

    it('keeps an app landing after a signup that reloads', () => {
        expect(signupRedirectUrl('/x')).toBe('/x');
        expect(signupRedirectUrl(undefined)).toBe('/');
    });
});

describe('account picker', () => {
    beforeEach(() => {
        window.logged_in_users = [
            { uuid: 'u1', username: 'alice', email: 'a@x.y', auth_token: 'ta', profile: { picture: 'data:image/png;base64,AA' } },
            { uuid: 'u2', username: '<b>bob</b>', auth_token: 'tb' },
        ];
    });

    it('lists the accounts, encoded, and can not be dismissed', () => {
        void UIAuthAccountPicker({ reload_on_success: false, page: true });
        expect($('.auth-account')).toHaveLength(2);
        expect($('.auth-account b')).toHaveLength(0);
        expect($('.auth-account-avatar img').attr('src')).toBe('data:image/png;base64,AA');
        expect($('.dashboard-dialog-close')).toHaveLength(0);
    });

    it('signs in as the picked account', async () => {
        const result = UIAuthAccountPicker({ reload_on_success: false });
        $('.auth-account[data-uuid="u2"]').trigger('click');
        await expect(result).resolves.toBe(true);
        expect(window.update_auth_data).toHaveBeenCalledWith('tb', window.logged_in_users[1]);
    });

    it('logs in to another account with a way back to the list', async () => {
        captureAjax();
        void UIAuthAccountPicker({ reload_on_success: false });
        $('.auth-to-login').trigger('click');
        expect(screen().attr('data-screen')).toBe('login');
        $('.auth-dialog-back').trigger('click');
        expect(screen().attr('data-screen')).toBe('accounts');
        $('.auth-to-signup').trigger('click');
        expect(screen().attr('data-screen')).toBe('signup');
    });
});

describe('password recovery', () => {
    it('asks for the account, then shows what the server said', async () => {
        const calls = captureAjax();
        void UIAuthRecoverPassword({ page: true });
        $('.pass-recovery-form').trigger('submit');
        expect(screen().find('.dashboard-form-status').text()).toBe('login_email_username_required');
        $('[name="email_or_username"]').val('someone@example.com');
        $('.pass-recovery-form').trigger('submit');
        expect(calls[0].url).toBe('https://api.puter.test/send-pass-recovery-email');
        expect(JSON.parse(calls[0].data)).toEqual({ email: 'someone@example.com' });
        calls[0].success({ message: 'Sent <b>it</b>' });
        await tick();
        expect($('.auth-done').text()).toBe('Sent <b>it</b>');
        expect($('.pass-recovery-form')).toHaveLength(0);
        // The page has a way on to the login.
        $('.auth-to-login').trigger('click');
        expect(screen().attr('data-screen')).toBe('login');
    });

    it('shows a refusal on the form', async () => {
        const calls = captureAjax();
        void UIAuthRecoverPassword();
        $('[name="email_or_username"]').val('someone');
        $('.pass-recovery-form').trigger('submit');
        expect(JSON.parse(calls[0].data)).toEqual({ username: 'someone' });
        calls[0].error({ responseText: JSON.stringify({ message: 'Too many' }) });
        await tick();
        expect(screen().find('.dashboard-form-status').text()).toBe('Too many');
        expect($('[name="email_or_username"]').prop('disabled')).toBe(false);
    });
});
