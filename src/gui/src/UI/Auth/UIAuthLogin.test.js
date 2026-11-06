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

vi.mock('../UIWindowEmailConfirmationRequired.js', () => ({ default: vi.fn() }));
vi.mock('../UIWindowPhoneVerificationRequired.js', () => ({ default: vi.fn() }));
vi.mock('../UIWindowCardVerificationRequired.js', () => ({ default: vi.fn() }));

const { activeAuthFlow } = await import('./authFlow.js');
const { default: UIAuthLogin, loginErrorMessage } = await import('./UIAuthLogin.js');
const { default: UIAuth2FA } = await import('./UIAuth2FA.js');

const completed = { proceed: true, next_step: 'complete', token: 'gui-token', user: { username: 'user' }, redirectUrl: 'https://puter.test/dashboard' };

/** Captures the login request; returns its callbacks. */
const captureAjax = () => {
    const calls = [];
    vi.spyOn($, 'ajax').mockImplementation((opts) => {
        calls.push(opts);
    });
    return calls;
};

const submitLogin = (user = 'user', password = 'correct-password') => {
    $('[name="email_or_username"]').val(user);
    $('[name="password"]').val(password);
    $('.login-form').trigger('submit');
};

const enterOtp = (code) => {
    const inputs = $('.login-2fa-code-inputs input');
    [...code].forEach((digit, index) => inputs.eq(index).val(digit));
    inputs.last().trigger('input');
};

beforeEach(() => {
    resetAuthGlobals();
});
afterEach(() => {
    activeAuthFlow()?.finish(false);
    vi.restoreAllMocks();
});

describe('login screen', () => {
    it('asks for each field before sending anything', () => {
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        $('.login-form').trigger('submit');
        expect(screen().find('.dashboard-form-status').text()).toBe('login_email_username_required');
        expect($('[name="email_or_username"]').attr('aria-invalid')).toBe('true');
        $('[name="email_or_username"]').val('user');
        $('.login-form').trigger('submit');
        expect(screen().find('.dashboard-form-status').text()).toBe('login_password_required');
        expect(calls).toHaveLength(0);
    });

    it('logs in by username or email, forwarding a reauth identity', async () => {
        const calls = captureAjax();
        const result = UIAuthLogin({ reload_on_success: false, auth_id: 'aid', reauth_reason: 'rotated' });
        submitLogin(' someone@example.com ');
        expect(JSON.parse(calls[0].data)).toEqual({ email: 'someone@example.com', password: 'correct-password', auth_id: 'aid', reauth_reason: 'rotated' });
        expect($('.login-btn').hasClass('dashboard-form-busy')).toBe(true);
        calls[0].success({ token: 't', user: { username: 'someone' } });
        await expect(result).resolves.toBe(true);
        expect(window.update_auth_data).toHaveBeenCalledWith('t', { username: 'someone' });
        expect(activeAuthFlow()).toBeNull();
    });

    it('shows the server message, unlocks, and puts the user back on the password', async () => {
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        submitLogin('user', 'nope');
        calls[0].error({ status: 400, responseText: JSON.stringify({ message: '<b>Wrong</b> password' }) });
        await tick();
        // Text, never markup from the server.
        expect(screen().find('.dashboard-form-status').text()).toBe('<b>Wrong</b> password');
        expect(screen().find('.dashboard-form-status b')).toHaveLength(0);
        expect($('[name="password"]').prop('disabled')).toBe(false);
        expect(activeAuthFlow().isBusy()).toBe(false);
    });

    it('stays signed in as before when dismissed while the login is out', async () => {
        window.auth_token = 'current-token';
        const calls = captureAjax();
        const result = UIAuthLogin();
        submitLogin();
        $('.dashboard-dialog-close').trigger('click');
        await expect(result).resolves.toBe(false);
        calls[0].success({ token: 't', user: { username: 'other' } });
        await tick();
        expect(window.update_auth_data).not.toHaveBeenCalled();
        // The server answered by moving the session cookie; it comes back.
        expect(fetch).toHaveBeenCalledWith('https://puter.test/session/sync-cookie', expect.objectContaining({
            headers: { Authorization: 'Bearer current-token' },
        }));
    });

    it('leaves the session cookie alone when a dismissed login only asked for a code', async () => {
        window.auth_token = 'current-token';
        const calls = captureAjax();
        void UIAuthLogin();
        submitLogin();
        $('.dashboard-dialog-close').trigger('click');
        calls[0].success({ proceed: true, next_step: 'otp', otp_jwt_token: 'c' });
        await tick();
        expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/session/sync-cookie'))).toBe(false);
    });

    it('encodes a prefilled username', () => {
        void UIAuthLogin({ email_or_username: '"><img src=x onerror=alert(1)>' });
        expect($('.auth-dialog img[src="x"]')).toHaveLength(0);
        expect($('[name="email_or_username"]').val()).toBe('"><img src=x onerror=alert(1)>');
    });

    it('hides the signup link when asked to', () => {
        void UIAuthLogin({ show_signup_button: false });
        expect($('.auth-to-signup')).toHaveLength(0);
    });

    it('opens forgot password in place, prefilled, and comes back', () => {
        void UIAuthLogin();
        $('[name="email_or_username"]').val('someone');
        $('.forgot-password-link').trigger('click');
        expect(screen().attr('data-screen')).toBe('recover-password');
        expect(screen().find('[name="email_or_username"]').val()).toBe('someone');
        screen().find('.auth-to-login').trigger('click');
        expect(screen().attr('data-screen')).toBe('login');
        expect($('.auth-screen')).toHaveLength(1);
    });

    it('switches to signup and back without stacking screens', () => {
        void UIAuthLogin();
        $('.auth-to-signup').trigger('click');
        expect(screen().attr('data-screen')).toBe('signup');
        screen().find('.auth-to-login').trigger('click');
        expect($('.auth-screen')).toHaveLength(1);
    });

    it('joins a login that is already open', async () => {
        const first = UIAuthLogin({ reload_on_success: false });
        const second = UIAuthLogin({ reload_on_success: false });
        expect($('.auth-dialog')).toHaveLength(1);
        $('.dashboard-dialog-close').trigger('click');
        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(false);
    });

    it('explains an unreachable self-hosted server', () => {
        window.app_domain = 'my.host';
        expect(loginErrorMessage({ status: 0 }).html).toContain('config.json');
        window.app_domain = 'puter.com';
        expect(loginErrorMessage({ status: 0 }).text).toBe('Failed to log in: Error 0');
        expect(loginErrorMessage({ status: 404, responseText: '<html>' }).text).toContain('404');
    });
});

describe('OIDC buttons on the login and signup screens', () => {
    const PROVIDERS_URL = 'https://api.puter.test/auth/oidc/providers';
    const asPopup = (query) => {
        window.embedded_in_popup = true;
        window.gui_action = 'sign-in';
        window.url_query_params = new URLSearchParams(query);
    };
    const askedForProviders = () => fetch.mock.calls.some(([url]) => url === PROVIDERS_URL);

    beforeEach(() => {
        globalThis.fetch = vi.fn(async () => reply(200, { providers: ['google'] }));
    });

    it.each(['login', 'signup'])('hides them in a cross-origin-isolated relay popup (%s)', async (kind) => {
        asPopup('embedded_in_popup=true&msg_id=1&cross_origin_isolated=true&signin_session=s');
        void UIAuthLogin();
        if ( kind === 'signup' ) $('.auth-to-signup').trigger('click');
        await tick();
        expect(askedForProviders()).toBe(false);
        expect(screen().find('.oidc-google-btn')).toHaveLength(0);
    });

    it.each(['login', 'signup'])('keeps them in a regular sign-in popup (%s)', async (kind) => {
        asPopup('embedded_in_popup=true&msg_id=1');
        void UIAuthLogin();
        if ( kind === 'signup' ) $('.auth-to-signup').trigger('click');
        await vi.waitFor(() => expect(screen().find('.oidc-google-btn')).toHaveLength(1));
    });

    it('starts the provider login with where to come back to', async () => {
        void UIAuthLogin({ referrer: 'ref' });
        await vi.waitFor(() => expect($('.oidc-google-btn')).toHaveLength(1));
        expect($('.auth-providers').prop('hidden')).toBe(false);
        const assign = vi.fn();
        const original = window.location;
        delete window.location;
        window.location = { ...original, set href (url) {
            assign(url);
        }, get href () {
            return original.href;
        } };
        $('.oidc-google-btn').trigger('click');
        window.location = original;
        expect(assign.mock.calls[0][0]).toBe('https://puter.test/auth/oidc/google/start?flow=login&referrer=ref');
    });
});

describe('second factor', () => {
    it('passes leading-zero codes to the verifier and keeps the continuation data', async () => {
        fetch.mockResolvedValue(reply(200, completed));
        const result = UIAuth2FA('first-factor-challenge');
        enterOtp('001234');
        await expect(result).resolves.toEqual(completed);
        expect(fetch).toHaveBeenCalledWith('https://puter.test/login/otp', expect.objectContaining({
            body: JSON.stringify({ token: 'first-factor-challenge', code: '001234' }),
        }));
    });

    it('takes a whole code autofilled into the first box', async () => {
        fetch.mockResolvedValue(reply(200, completed));
        const result = UIAuth2FA('t');
        $('.login-2fa-code-inputs input').first().val('987654').trigger('input');
        await expect(result).resolves.toEqual(completed);
        expect(JSON.parse(fetch.mock.calls[0][1].body).code).toBe('987654');
    });

    it('keeps a failed challenge open for a recovery-code retry', async () => {
        fetch.mockResolvedValueOnce(reply(200, { proceed: false })).mockResolvedValueOnce(reply(200, completed));
        const result = UIAuth2FA('first-factor-challenge');
        enterOtp('001234');
        await vi.waitFor(() => expect(screen().find('.dashboard-form-status').text()).toBe('confirm_code_generic_incorrect'));
        $('.login-2fa-to-recovery').trigger('click');
        expect(screen().attr('data-screen')).toBe('recovery-code');
        $('.login-2fa-recovery-input').val(' abcdefg2\n').trigger('input');
        await expect(result).resolves.toEqual(completed);
        expect(fetch.mock.calls[1][0]).toBe('https://puter.test/login/recovery-code');
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ token: 'first-factor-challenge', code: 'ABCDEFG2' });
    });

    it('reports throttling without completing', async () => {
        fetch.mockResolvedValue(reply(429, {}));
        const result = UIAuth2FA('t');
        let settled = false;
        result.then(() => {
            settled = true;
        });
        enterOtp('001234');
        await vi.waitFor(() => expect(screen().find('.dashboard-form-status').text()).toBe('confirm_code_generic_too_many_requests'));
        expect(settled).toBe(false);
    });

    it('ignores incomplete recovery codes', () => {
        void UIAuth2FA('t');
        $('.login-2fa-to-recovery').trigger('click');
        $('.login-2fa-recovery-input').val('ABC').trigger('input');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('resolves null when the user goes back from a standalone challenge', async () => {
        const result = UIAuth2FA('t');
        $('.auth-dialog-back').trigger('click');
        await expect(result).resolves.toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('password login with a second factor', () => {
    it('completes only after the challenge succeeds', async () => {
        fetch.mockImplementation(async (url) => (String(url).endsWith('/providers') ? reply(200, { providers: [] }) : reply(200, completed)));
        const calls = captureAjax();
        const result = UIAuthLogin({ reload_on_success: false });
        submitLogin();
        const submitted = calls[0].success({ proceed: true, next_step: 'otp', otp_jwt_token: 'password-challenge' });
        await vi.waitFor(() => expect(screen().attr('data-screen')).toBe('two-factor'));
        expect(window.update_auth_data).not.toHaveBeenCalled();
        enterOtp('001234');
        await submitted;
        await expect(result).resolves.toBe(true);
        expect(window.update_auth_data).toHaveBeenCalledWith(completed.token, completed.user);
        expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).token).toBe('password-challenge');
    });

    it('shows a failure to finish signing in on the login screen, not a stuck code screen', async () => {
        fetch.mockImplementation(async (url) => (String(url).endsWith('/providers') ? reply(200, { providers: [] }) : reply(200, completed)));
        window.update_auth_data = vi.fn(async () => {
            throw new Error('Storage is full');
        });
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        submitLogin();
        calls[0].success({ proceed: true, next_step: 'otp', otp_jwt_token: 'c' });
        await vi.waitFor(() => expect(screen().attr('data-screen')).toBe('two-factor'));
        enterOtp('001234');
        await vi.waitFor(() => expect(screen().attr('data-screen')).toBe('login'));
        expect(screen().find('.dashboard-form-status').text()).toBe('Storage is full');
        expect($('.login-btn').prop('disabled')).toBe(false);
        expect(activeAuthFlow().isBusy()).toBe(false);
    });

    it('stays signed in as before when dismissed while the code is out', async () => {
        window.auth_token = 'current-token';
        let answer;
        fetch.mockImplementation(async (url) => {
            if ( String(url).endsWith('/providers') ) return reply(200, { providers: [] });
            if ( String(url).endsWith('/login/otp') ) return new Promise((resolve) => {
                answer = resolve;
            });
            return reply(204, null);
        });
        const calls = captureAjax();
        const result = UIAuthLogin({ reload_on_success: false });
        submitLogin();
        const submitted = calls[0].success({ proceed: true, next_step: 'otp', otp_jwt_token: 'c' });
        await vi.waitFor(() => expect(screen().attr('data-screen')).toBe('two-factor'));
        enterOtp('001234');
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
        $('.dashboard-dialog-close').trigger('click');
        await expect(result).resolves.toBe(false);
        answer(reply(200, completed));
        await submitted;
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('https://puter.test/session/sync-cookie', expect.objectContaining({
            headers: { Authorization: 'Bearer current-token' },
        })));
        expect(window.update_auth_data).not.toHaveBeenCalled();
    });

    it('returns to the enabled password form when the user goes back', async () => {
        const calls = captureAjax();
        const result = UIAuthLogin({ reload_on_success: false });
        submitLogin();
        const submitted = calls[0].success({ proceed: true, next_step: 'otp', otp_jwt_token: 'c' });
        await vi.waitFor(() => expect(screen().attr('data-screen')).toBe('two-factor'));
        $('.auth-dialog-back').trigger('click');
        await submitted;
        expect(screen().attr('data-screen')).toBe('login');
        expect($('.login-btn').prop('disabled')).toBe(false);
        expect(window.update_auth_data).not.toHaveBeenCalled();
        $('.dashboard-dialog-close').trigger('click');
        await expect(result).resolves.toBe(false);
    });
});
