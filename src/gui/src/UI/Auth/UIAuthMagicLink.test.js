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
const { default: UIAuthLogin } = await import('./UIAuthLogin.js');
const { default: UIAuthMagicLink } = await import('./UIAuthMagicLink.js');
const { default: UIAuthMagicLinkConsume } = await import('./UIAuthMagicLinkConsume.js');

/** The channel a link's tab answers on; tests play that tab. */
class FakeChannel {
    static opened = [];
    constructor (name) {
        this.name = name;
        this.posted = [];
        FakeChannel.opened.push(this);
    }
    postMessage (data) {
        this.posted.push(data);
    }
    close () {
        this.closed = true;
    }
}

/** Answers each fetch from the first route whose path the URL ends with. */
const routeFetch = (routes) => {
    globalThis.fetch = vi.fn(async (url) => {
        const path = new URL(url).pathname;
        const handler = routes[path];
        if ( ! handler ) return reply(404, {});
        return typeof handler === 'function' ? handler(url) : handler;
    });
};

const sentBody = (path) => {
    const call = fetch.mock.calls.find(([url]) => new URL(url).pathname === path);
    return call ? JSON.parse(call[1].body) : undefined;
};

/** Records where the page navigates, while `run` executes. */
const captureNavigation = (run) => {
    const assign = vi.fn();
    const original = window.location;
    delete window.location;
    window.location = { ...original, set href (url) {
        assign(url);
    }, get href () {
        return original.href;
    } };
    try {
        run();
    } finally {
        window.location = original;
    }
    return assign.mock.calls.map(([url]) => url);
};

beforeEach(() => {
    resetAuthGlobals();
    FakeChannel.opened = [];
    vi.stubGlobal('BroadcastChannel', FakeChannel);
});
afterEach(() => {
    activeAuthFlow()?.finish(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('email sign-in from the login screen', () => {
    it('is offered without any identity provider', async () => {
        void UIAuthLogin({ reload_on_success: false });
        await tick();
        expect(screen().find('.auth-providers').prop('hidden')).toBe(false);
        expect(screen().find('.magic-link-btn')).toHaveLength(1);
        expect(screen().find('.auth-provider-list').children()).toHaveLength(0);
    });

    it('carries a typed email over, and Back returns to the login', () => {
        void UIAuthLogin({ reload_on_success: false });
        $('[name="email_or_username"]').val('me@example.com');
        $('.magic-link-btn').trigger('click');
        expect(screen().attr('data-screen')).toBe('magic-link');
        expect(screen().find('[name="email"]').val()).toBe('me@example.com');
        $('.auth-dialog-back').trigger('click');
        expect(screen().attr('data-screen')).toBe('login');
    });

    it('leaves a username behind', () => {
        void UIAuthLogin({ reload_on_success: false });
        $('[name="email_or_username"]').val('someuser');
        $('.magic-link-btn').trigger('click');
        expect(screen().find('[name="email"]').val()).toBe('');
    });
});

describe('email screen', () => {
    it('routes an address its provider verifies to that provider, with a login hint', async () => {
        routeFetch({ '/auth/oidc/providers': reply(200, { providers: ['google'] }) });
        void UIAuthMagicLink({ email: 'me@gmail.com', reload_on_success: false });
        await vi.waitFor(() => expect(screen().find('.oidc-google-btn')).toHaveLength(1));
        expect(screen().find('.magic-link-send-btn').prop('hidden')).toBe(true);

        const urls = captureNavigation(() => screen().find('.oidc-google-btn').trigger('click'));
        expect(urls).toEqual(['https://puter.test/auth/oidc/google/start?flow=login&login_hint=me%40gmail.com']);
    });

    it('goes back to a link once the address changes', async () => {
        routeFetch({ '/auth/oidc/providers': reply(200, { providers: ['google'] }) });
        void UIAuthMagicLink({ email: 'me@gmail.com', reload_on_success: false });
        await vi.waitFor(() => expect(screen().find('.oidc-google-btn')).toHaveLength(1));
        screen().find('[name="email"]').val('me@example.com').trigger('input');
        expect(screen().find('.oidc-google-btn')).toHaveLength(0);
        expect(screen().find('.magic-link-send-btn').prop('hidden')).toBe(false);
    });

    it('checks the address before sending anything', async () => {
        void UIAuthMagicLink({ reload_on_success: false });
        screen().find('[name="email"]').val('not-an-email');
        screen().find('.magic-link-form').trigger('submit');
        expect(screen().find('.dashboard-form-status').text()).toBe('magic_link_invalid_email');
        expect(sentBody('/auth/magic-link/request')).toBeUndefined();
    });

    it('shows why the server refused an address', async () => {
        routeFetch({
            '/auth/oidc/providers': reply(200, { providers: [] }),
            '/auth/magic-link/request': () => reply(400, { message: 'This email is not allowed.' }),
        });
        void UIAuthMagicLink({ email: 'me@example.com', reload_on_success: false });
        screen().find('.magic-link-form').trigger('submit');
        await vi.waitFor(() => expect(screen().find('.dashboard-form-status').text()).toBe('This email is not allowed.'));
        expect(screen().find('.magic-link-form')).toHaveLength(1);
    });

    it('sends a link, then signs in when the link\'s tab in this browser does', async () => {
        routeFetch({
            '/auth/oidc/providers': reply(200, { providers: [] }),
            '/auth/magic-link/request': () => reply(200, { request_id: 'request-1' }),
            '/get-gui-token': () => reply(200, { token: 'gui-token' }),
            '/whoami': () => reply(200, { uuid: 'user-1', username: 'me' }),
        });
        const result = UIAuthMagicLink({ email: 'me@example.com', reload_on_success: false });
        screen().find('.magic-link-form').trigger('submit');
        await vi.waitFor(() => expect(screen().find('.magic-link-sent')).toHaveLength(1));
        expect(sentBody('/auth/magic-link/request')).toEqual({ email: 'me@example.com' });
        expect(screen().find('.magic-link-sent').text()).toContain('magic_link_sent_message:me@example.com');

        const [channel] = FakeChannel.opened;
        channel.onmessage({ data: { type: 'signed-in', request_id: 'request-1', user_uuid: 'user-1' } });
        expect(channel.posted).toEqual([{ type: 'ack', request_id: 'request-1' }]);
        await expect(result).resolves.toBe(true);
        expect(window.update_auth_data).toHaveBeenCalledWith('gui-token', { uuid: 'user-1', username: 'me' });
        expect(channel.closed).toBe(true);
    });

    it('ignores a sign-in for another request', async () => {
        routeFetch({
            '/auth/oidc/providers': reply(200, { providers: [] }),
            '/auth/magic-link/request': () => reply(200, { request_id: 'request-1' }),
        });
        void UIAuthMagicLink({ email: 'me@example.com', reload_on_success: false });
        screen().find('.magic-link-form').trigger('submit');
        await vi.waitFor(() => expect(screen().find('.magic-link-sent')).toHaveLength(1));
        FakeChannel.opened[0].onmessage({ data: { type: 'signed-in', request_id: 'request-2', user_uuid: 'user-1' } });
        await tick();
        expect(FakeChannel.opened[0].posted).toEqual([]);
        expect(window.update_auth_data).not.toHaveBeenCalled();
    });

    it('stops waiting for the link once the user goes back', async () => {
        routeFetch({
            '/auth/oidc/providers': reply(200, { providers: [] }),
            '/auth/magic-link/request': () => reply(200, { request_id: 'request-1' }),
        });
        void UIAuthLogin({ reload_on_success: false });
        $('[name="email_or_username"]').val('me@example.com');
        $('.magic-link-btn').trigger('click');
        screen().find('.magic-link-form').trigger('submit');
        await vi.waitFor(() => expect(screen().find('.magic-link-sent')).toHaveLength(1));
        $('.auth-dialog-back').trigger('click');
        expect(FakeChannel.opened[0].closed).toBe(true);
    });
});

describe('the page a sign-in link opens', () => {
    const signedIn = { proceed: true, next_step: 'complete', token: 'gui-token', user: { uuid: 'user-1' } };

    it('signs in with the link', async () => {
        routeFetch({ '/auth/magic-link/consume': () => reply(200, { ...signedIn, request_id: 'request-1' }) });
        await expect(UIAuthMagicLinkConsume('link-token')).resolves.toEqual({
            token: 'gui-token',
            user: { uuid: 'user-1' },
            request_id: 'request-1',
            app_origin: null,
        });
        expect(sentBody('/auth/magic-link/consume')).toEqual({ token: 'link-token' });
    });

    it('asks first when another browser requested the link', async () => {
        let confirmed = false;
        routeFetch({
            '/auth/magic-link/consume': () => (confirmed
                ? reply(200, { ...signedIn, request_id: 'request-1', app_origin: 'https://app.example' })
                : reply(200, { next_step: 'confirm', email: 'me@example.com', app_origin: 'https://app.example' })),
        });
        const result = UIAuthMagicLinkConsume('link-token');
        await vi.waitFor(() => expect(screen().find('.magic-link-confirm').prop('hidden')).toBe(false));
        expect(screen().find('.magic-link-confirm-msg').text()).toBe('magic_link_confirm_message_app:me@example.com,app.example');

        confirmed = true;
        screen().find('.magic-link-confirm').trigger('submit');
        await expect(result).resolves.toMatchObject({ token: 'gui-token', app_origin: 'https://app.example' });
        expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ token: 'link-token', confirm: true });
    });

    it('runs the second factor when the account has one', async () => {
        routeFetch({
            '/auth/magic-link/consume': () => reply(200, { next_step: 'otp', otp_jwt_token: 'otp-challenge', request_id: 'request-1' }),
            '/login/otp': () => reply(200, signedIn),
        });
        const result = UIAuthMagicLinkConsume('link-token');
        await vi.waitFor(() => expect(screen().attr('data-screen')).toBe('two-factor'));
        const inputs = $('.login-2fa-code-inputs input');
        [...'123456'].forEach((digit, index) => inputs.eq(index).val(digit));
        inputs.last().trigger('input');
        await expect(result).resolves.toMatchObject({ token: 'gui-token', request_id: 'request-1' });
        expect(sentBody('/login/otp')).toEqual({ token: 'otp-challenge', code: '123456' });
    });

    it('says why a link failed, and lets the user leave', async () => {
        routeFetch({ '/auth/magic-link/consume': () => reply(400, { code: 'link_expired' }) });
        const result = UIAuthMagicLinkConsume('link-token');
        await vi.waitFor(() => expect(screen().find('.dashboard-form-status').text()).toBe('magic_link_expired_message'));
        expect(screen().find('.magic-link-done').prop('hidden')).toBe(false);
        screen().find('.magic-link-done-btn').trigger('click');
        await expect(result).resolves.toBeNull();
    });
});
