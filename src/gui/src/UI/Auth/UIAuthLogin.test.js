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
const { default: UIAuthLogin, loginErrorMessage, loginRequestBody } = await import('./UIAuthLogin.js');
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

/** Waits for the login request, which goes out once the fingerprint settles. */
const sent = (calls, count = 1) => vi.waitFor(() => expect(calls).toHaveLength(count));

const enterOtp = (code) => {
    const inputs = $('.login-2fa-code-inputs input');
    [...code].forEach((digit, index) => inputs.eq(index).val(digit));
    inputs.last().trigger('input');
};

/** The test i18n, showing a request code substituted into its message. */
const plainI18n = globalThis.i18n;
const i18nWithCode = (key, args) => (args?.id ? `${key}(${args.id})` : plainI18n(key, args));

beforeEach(() => {
    resetAuthGlobals();
    delete window.getDeviceFingerprint;
    for ( const gate of Object.values(gates) ) gate.mockReset();
});
afterEach(() => {
    activeAuthFlow()?.finish(false);
    vi.restoreAllMocks();
    globalThis.i18n = plainI18n;
});

describe('login screen', () => {
    it('leaves out the opener notice in a sign-in popup', () => {
        window.embedded_in_popup = true;
        window.openerOrigin = 'https://builder.puter.com';
        void UIAuthLogin({ reload_on_success: false });
        expect(screen().find('.auth-title')).toHaveLength(1);
        expect(screen().find('.auth-opener-notice')).toHaveLength(0);
    });

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
        await sent(calls);
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
        await sent(calls);
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
        await sent(calls);
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
        await sent(calls);
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

describe('login request', () => {
    it('builds the body by email or username, with a fingerprint and a captcha answer only when given', () => {
        expect(loginRequestBody({ emailOrUsername: 'a@b.c', password: 'pw' })).toEqual({ email: 'a@b.c', password: 'pw' });
        expect(loginRequestBody({ emailOrUsername: 'name', password: 'pw', reauth: { auth_id: 'aid' }, fingerprint: 'fp', captchaToken: 'tok' }))
            .toEqual({ username: 'name', password: 'pw', auth_id: 'aid', fingerprint: 'fp', 'cf-turnstile-response': 'tok' });
        // A captcha that never loaded still says so, as signup does.
        expect(loginRequestBody({ emailOrUsername: 'name', password: 'pw', captchaToken: null })).toHaveProperty('cf-turnstile-response', null);
    });

    it('sends the device fingerprint', async () => {
        window.getDeviceFingerprint = vi.fn(async () => 'fp-1');
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        submitLogin();
        await sent(calls);
        expect(JSON.parse(calls[0].data).fingerprint).toBe('fp-1');
        // Asked for once, when the screen opened.
        expect(window.getDeviceFingerprint).toHaveBeenCalledOnce();
    });

    it('signs in without a fingerprint when the getter fails', async () => {
        window.getDeviceFingerprint = vi.fn(async () => {
            throw new Error('blocked');
        });
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        submitLogin();
        await sent(calls);
        expect(JSON.parse(calls[0].data)).toEqual({ username: 'user', password: 'correct-password' });
    });

    it('sends nothing when dismissed before the fingerprint settles', async () => {
        let settle;
        window.getDeviceFingerprint = () => new Promise((resolve) => {
            settle = resolve;
        });
        const calls = captureAjax();
        const result = UIAuthLogin();
        submitLogin();
        $('.dashboard-dialog-close').trigger('click');
        await expect(result).resolves.toBe(false);
        settle('fp');
        await tick();
        expect(calls).toHaveLength(0);
    });
});

describe('login captcha', () => {
    const turnstileOn = (params) => {
        window.gui_params = { turnstileSiteKey: 'key', ...params };
        window.turnstile = { render: vi.fn(() => 'widget'), reset: vi.fn() };
    };

    it('stays off without the server flag, even with a site key', async () => {
        turnstileOn({});
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        expect($('.cf-turnstile')).toHaveLength(0);
        submitLogin();
        await sent(calls);
        expect(window.turnstile.render).not.toHaveBeenCalled();
        expect(JSON.parse(calls[0].data)).not.toHaveProperty('cf-turnstile-response');
    });

    it('asks for it when the server flag is on, and gets a fresh one after a refusal', async () => {
        turnstileOn({ turnstileLogin: true });
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        expect(window.turnstile.render).toHaveBeenCalledWith($('.cf-turnstile').get(0), expect.objectContaining({ sitekey: 'key' }));
        expect($('.cf-turnstile').attr('data-appearance')).toBe('interaction-only');
        submitLogin();
        expect(screen().find('.dashboard-form-status').text()).toBe('captcha_required');
        window.turnstile.render.mock.calls[0][1].callback('tok');
        submitLogin('user', 'wrong-password');
        await sent(calls);
        expect(JSON.parse(calls[0].data)['cf-turnstile-response']).toBe('tok');
        calls[0].error({ status: 401, responseText: JSON.stringify({ message: 'Incorrect password.' }) });
        await tick();
        expect(window.turnstile.reset).toHaveBeenCalledWith('widget');
        expect($('.cf-turnstile').attr('data-token')).toBeUndefined();
    });

    it('needs a site key as well as the flag', () => {
        window.gui_params = { turnstileLogin: true };
        void UIAuthLogin({ reload_on_success: false });
        expect($('.cf-turnstile')).toHaveLength(0);
    });
});

describe('refused logins', () => {
    const refuse = async (status, json, user = 'someone') => {
        const calls = captureAjax();
        void UIAuthLogin({ reload_on_success: false });
        submitLogin(user);
        await sent(calls);
        calls[0].error({ status, responseText: JSON.stringify(json) });
        await tick();
    };
    const LOCKED = {
        error: 'Too many incorrect passwords for this account. Reset your password, or try again later.',
        message: 'Too many incorrect passwords for this account. Reset your password, or try again later.',
        code: 'too_many_requests',
        errorCode: 'login_locked',
        action: 'reset_password',
    };

    it('offers a password reset for the typed account when its password sign-in is locked', async () => {
        await refuse(429, LOCKED, 'someone@example.com');
        expect(screen().find('.dashboard-form-status').text()).toContain('login_locked_message');
        const $reset = screen().find('.login-reset-password');
        expect($reset.text()).toBe('login_locked_reset_password');
        expect(document.activeElement).toBe($reset.get(0));
        $reset.trigger('click');
        expect(screen().attr('data-screen')).toBe('recover-password');
        expect(screen().find('[name="email_or_username"]').val()).toBe('someone@example.com');
    });

    it('encodes a lockout message it has no wording of its own for', () => {
        const message = loginErrorMessage({
            status: 429,
            responseText: JSON.stringify({ ...LOCKED, errorCode: undefined, message: '<img src=x>' }),
        });
        expect(message.text).toBe('<img src=x>');
        expect(message.html).toContain('&lt;img src=x&gt;');
        expect(message.html).toContain('login-reset-password');
    });

    it('shows the per-network limit as before, without a reset offer', async () => {
        await refuse(429, { error: 'Too many requests.', message: 'Too many requests.', code: 'too_many_requests' });
        expect(screen().find('.dashboard-form-status').text()).toBe('Too many requests.');
        expect(screen().find('.login-reset-password')).toHaveLength(0);
    });

    it('shows a blocked sign-in in its own words, with its request code', async () => {
        globalThis.i18n = i18nWithCode;
        const message = 'This sign-in was blocked. Request Code: rc-123';
        await refuse(403, { error: message, message, code: 'signin_blocked', request_code: 'rc-123' });
        expect(screen().find('.dashboard-form-status').text())
            .toBe('signin_blocked_message contact_support_with_code(rc-123)');
        expect(window.update_auth_data).not.toHaveBeenCalled();
    });

    it('words captcha refusals itself', () => {
        const refusal = (code) => loginErrorMessage({
            status: 403,
            responseText: JSON.stringify({ message: 'Server wording.', code }),
        }).text;
        expect(refusal('captcha_required')).toBe('captcha_required');
        expect(refusal('captcha_failed')).toBe('captcha_failed');
    });

    it('shows the server message for a refusal it has no words for', () => {
        const message = 'Sign-in refused. Request Code: rc-7';
        expect(loginErrorMessage({
            status: 403,
            responseText: JSON.stringify({ message, code: 'signin_suspicious', request_code: 'rc-7' }),
        }).text).toBe(message);
    });
});

describe('account checks set at sign-in', () => {
    beforeEach(() => {
        window.update_auth_data = vi.fn(async (token) => {
            window.auth_token = token;
        });
    });

    const signIn = async (user, options = { reload_on_success: false }) => {
        const calls = captureAjax();
        const result = UIAuthLogin(options);
        submitLogin();
        await sent(calls);
        calls[0].success({ token: 't', user });
        return { calls, result };
    };

    it('keeps the login open, out of sight, so another sign-in prompt waits on it', async () => {
        let clearPhone;
        gates.phone.mockImplementation(() => new Promise((resolve) => {
            clearPhone = resolve;
        }));
        const { calls, result } = await signIn({ requires_phone_verification: true });
        await vi.waitFor(() => expect(gates.phone).toHaveBeenCalled());
        expect($('.auth-dialog-overlay').is(':visible')).toBe(false);

        const second = UIAuthLogin({ reload_on_success: false });
        expect($('.auth-dialog')).toHaveLength(1);
        expect(calls).toHaveLength(1);

        clearPhone(true);
        await expect(result).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
    });

    it('does not finish signing in when the page moved to another account during the checks', async () => {
        gates.phone.mockImplementation(async () => {
            window.auth_token = 'another-account';
            return true;
        });
        const { result } = await signIn({ requires_phone_verification: true });
        await expect(result).resolves.toBe(false);
    });

    it('opens the emailed-code window without sending another code, then phone, then card', async () => {
        const order = [];
        gates.email.mockImplementation(async () => order.push('email') && true);
        gates.phone.mockImplementation(async () => order.push('phone') && true);
        gates.card.mockImplementation(async () => order.push('card') && true);
        const { calls, result } = await signIn({
            requires_email_confirmation: true,
            email_confirmed: false,
            requires_phone_verification: true,
            requires_card_verification: true,
            card_fallback_available: true,
        });
        await expect(result).resolves.toBe(true);
        expect(order).toEqual(['email', 'phone', 'card']);
        expect(calls).toHaveLength(1);
        expect(fetch.mock.calls.some(([url]) => String(url).includes('send-confirm-email'))).toBe(false);
        expect(gates.email.mock.calls[0][0].show_close_button).toBe(false);
        expect(gates.phone.mock.calls[0][0].card_fallback_available).toBe(true);
        expect($('.auth-dialog-overlay.dashboard-dialog-show')).toHaveLength(0);
    });

    it('takes the email last for an account that clears it last', async () => {
        const order = [];
        gates.email.mockImplementation(async () => order.push('email') && true);
        gates.card.mockImplementation(async () => order.push('card') && true);
        const { result } = await signIn({ requires_email_confirmation: true, requires_card_verification: true, email_gate_last: true });
        await result;
        expect(order).toEqual(['card', 'email']);
    });

    it('covers a sign-in page with the checks', async () => {
        gates.phone.mockResolvedValue(true);
        const { result } = await signIn({ requires_phone_verification: true }, { reload_on_success: false, page: true });
        await result;
        expect(gates.phone.mock.calls[0][0].window_options).toEqual({ cover_page: true, has_head: false });
    });

    it('skips a confirmed email and finishes as a plain sign-in', async () => {
        const { result } = await signIn({ requires_email_confirmation: true, email_confirmed: true });
        await expect(result).resolves.toBe(true);
        expect(gates.email).not.toHaveBeenCalled();
    });

    it('leaves the checks to boot when the sign-in reloads the page', async () => {
        const original = window.location;
        const replace = vi.fn();
        delete window.location;
        window.location = { ...original, href: original.href, origin: original.origin, pathname: '/', replace, reload: vi.fn() };
        try {
            await signIn({ requires_phone_verification: true }, { reload_on_success: true, redirect_url: 'https://puter.test/next' });
            await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('https://puter.test/next'));
            expect(gates.phone).not.toHaveBeenCalled();
        } finally {
            window.location = original;
        }
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

    it('hands a framed sign-in to the popup instead of leaving for the provider', async () => {
        asPopup('msg_id=1');
        window.embedded_in_frame = true;
        window.tell_popup_frame = vi.fn();
        try {
            void UIAuthLogin();
            await vi.waitFor(() => expect($('.oidc-google-btn')).toHaveLength(1));
            const href = window.location.href;
            $('.oidc-google-btn').trigger('click');
            expect(window.tell_popup_frame.mock.calls).toEqual([
                ['provider', { url: expect.stringContaining('https://puter.test/auth/oidc/google/start?flow=login') }],
                ['unavailable'],
            ]);
            const start = new URL(window.tell_popup_frame.mock.calls[0][1].url);
            expect(start.searchParams.get('embedded_in_popup')).toBe('true');
            expect(start.searchParams.get('msg_id')).toBe('1');
            expect(window.location.href).toBe(href);
        } finally {
            delete window.embedded_in_frame;
            delete window.tell_popup_frame;
        }
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
        await sent(calls);
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
        await sent(calls);
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
        await sent(calls);
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
        await sent(calls);
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

describe('second factor refusals', () => {
    const blocked = 'This sign-in was blocked. Request Code: rc-9';
    beforeEach(() => {
        globalThis.i18n = i18nWithCode;
    });

    it('sends the device fingerprint with the code', async () => {
        window.getDeviceFingerprint = vi.fn(async () => 'fp-2');
        fetch.mockResolvedValue(reply(200, completed));
        const result = UIAuth2FA('t');
        enterOtp('001234');
        await result;
        expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ token: 't', code: '001234', fingerprint: 'fp-2' });
    });

    it('shows a refused sign-in instead of calling the code wrong, and leaves only Back', async () => {
        fetch.mockResolvedValue(reply(403, { error: blocked, message: blocked, code: 'signin_blocked', request_code: 'rc-9' }));
        void UIAuth2FA('t');
        enterOtp('001234');
        await vi.waitFor(() => expect(screen().find('.dashboard-form-status').text())
            .toBe('signin_blocked_message contact_support_with_code(rc-9)'));
        expect($('.login-2fa-code-inputs input').first().prop('disabled')).toBe(true);
        expect($('.login-2fa-to-recovery').prop('disabled')).toBe(true);
        expect(activeAuthFlow().isBusy()).toBe(false);
        expect($('.auth-dialog-back').prop('disabled')).toBe(false);
    });

    it('shows a refused sign-in on the recovery code screen too', async () => {
        fetch.mockResolvedValue(reply(403, { error: 'Not allowed here.', message: 'Not allowed here.', code: 'signin_policy' }));
        void UIAuth2FA('t');
        $('.login-2fa-to-recovery').trigger('click');
        $('.login-2fa-recovery-input').val('ABCDEFG2').trigger('input');
        await vi.waitFor(() => expect(screen().find('.dashboard-form-status').text()).toBe('Not allowed here.'));
        expect($('.login-2fa-recovery-input').prop('disabled')).toBe(true);
    });
});
