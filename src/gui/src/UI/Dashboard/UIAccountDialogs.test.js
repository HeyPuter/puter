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
vi.mock('../UIWindowManageSessions.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });

const dialogs = await import('./UIAccountDialogs.js');
const { openRevalidatePopup } = await import('../../util/openid.js');

const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });
const bodyOf = (index) => JSON.parse(fetch.mock.calls[index][1].body);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const field = (name) => $(`.dashboard-form-input[name="${name}"]`);
const status = () => $('.dashboard-form-status').text();
const isOpen = () => $('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show');

/** Fills the named fields, submits, and waits for the handler to finish. */
const submitWith = async (values = {}) => {
    for ( const [name, value] of Object.entries(values) ) field(name).val(value);
    $('.dashboard-form-dialog').trigger('submit');
    // The handler awaits a fetch, a JSON parse and maybe a popup.
    for ( let i = 0; i < 10; i++ ) await settle();
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = vi.fn();
    globalThis.puter = { _cache: { flushall: vi.fn() } };
    window.gui_origin = 'https://puter.test';
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'tok-1';
    window.handleReauthRequired = vi.fn();
    window.logout = vi.fn();
    window.user = { username: 'alice', email: 'alice@example.com', profile: { displayName: 'Alice', bio: 'Hi there' } };
    openRevalidatePopup.mockClear();
});

describe('edit profile', () => {
    it('prefills the current display name and bio', () => {
        dialogs.openEditProfileDialog();
        expect(field('displayName').val()).toBe('Alice');
        expect(field('bio').val()).toBe('Hi there');
    });

    it('saves trimmed values, clears empty ones, and closes', async () => {
        window.update_profile = vi.fn(async (_username, patch) => patch);
        const onSave = vi.fn();
        dialogs.openEditProfileDialog({ onSave });

        await submitWith({ displayName: '  Alice Smith ', bio: '   ' });

        expect(window.update_profile).toHaveBeenCalledWith('alice', { displayName: 'Alice Smith', bio: null });
        expect(onSave).toHaveBeenCalledWith({ displayName: 'Alice Smith', bio: null });
        expect(isOpen()).toBe(false);
    });

    it('sends only the fields that were edited', async () => {
        window.update_profile = vi.fn(async (_username, patch) => patch);
        dialogs.openEditProfileDialog();

        await submitWith({ bio: 'New bio' });

        expect(window.update_profile).toHaveBeenCalledWith('alice', { bio: 'New bio' });
        expect(isOpen()).toBe(false);
    });

    it('closes without saving when nothing changed', async () => {
        window.update_profile = vi.fn();
        dialogs.openEditProfileDialog();

        await submitWith({ displayName: ' Alice ' });

        expect(window.update_profile).not.toHaveBeenCalled();
        expect(isOpen()).toBe(false);
    });

    it('stays open with an error when the save fails', async () => {
        window.update_profile = vi.fn(async () => undefined);
        const onSave = vi.fn();
        dialogs.openEditProfileDialog({ onSave });
        await settle();

        await submitWith({ bio: 'Bye' });

        expect(status()).toBe('profile_save_failed');
        expect(onSave).not.toHaveBeenCalled();
        expect(isOpen()).toBe(true);
    });
});

describe('change username', () => {
    it('asks for the password before posting', async () => {
        dialogs.openChangeUsernameDialog();
        await submitWith({ username: 'bob' });
        expect(status()).toBe('all_fields_required');
        expect(field('password').attr('aria-invalid')).toBe('true');
        expect(fetch).not.toHaveBeenCalled();
    });

    it("doesn't post the name the account already has", async () => {
        dialogs.openChangeUsernameDialog();
        await submitWith({ username: 'Alice', password: 'pw' });
        expect(status()).toBe('username_unchanged');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('renames the user everywhere on success', async () => {
        document.body.innerHTML = '<span class="username">alice</span>';
        fetch.mockResolvedValueOnce(reply(200));
        dialogs.openChangeUsernameDialog();

        await submitWith({ username: ' bob ', password: 'pw' });

        expect(bodyOf(0)).toEqual({ new_username: 'bob', password: 'pw' });
        expect(window.user.username).toBe('bob');
        expect($('span.username').text()).toBe('bob');
        expect($('.dashboard-form-done p').text()).toBe('username_changed');
    });

    it('hides the password field from a provider-only account and signs it in instead', async () => {
        window.user.oidc_only = true;
        window.user.oidc_revalidate_url = 'https://puter.test/revalidate';
        fetch.mockResolvedValueOnce(reply(200));
        dialogs.openChangeUsernameDialog();
        expect($('.dashboard-form-field[data-field="password"]').prop('hidden')).toBe(true);
        expect($('.dashboard-dialog-message').text()).toBe('revalidate_flow_notice');

        await submitWith({ username: 'bob' });

        expect(openRevalidatePopup).toHaveBeenCalledOnce();
        expect(bodyOf(0)).toEqual({ new_username: 'bob' });
    });
});

describe('change password', () => {
    const open = () => dialogs.openChangePasswordDialog();

    it('checks the new password before posting', async () => {
        open();
        await submitWith({ current: 'Old1!pass', next: 'Strong1!pass', confirm: 'Strong1!pas' });
        expect(status()).toBe('passwords_do_not_match');
        expect(field('confirm').attr('aria-invalid')).toBe('true');

        await submitWith({ next: 'weak', confirm: 'weak' });
        expect(status()).toBe('password_strength_error');
        expect(fetch).not.toHaveBeenCalled();
    });

    it("doesn't post a new password that is the current one", async () => {
        open();
        await submitWith({ current: 'Strong1!pass', next: 'Strong1!pass', confirm: 'Strong1!pass' });
        expect(status()).toBe('password_unchanged');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('posts the current and new password and confirms the change', async () => {
        fetch.mockResolvedValueOnce(reply(200));
        open();

        await submitWith({ current: 'Old1!pass', next: 'Strong1!pass', confirm: 'Strong1!pass' });

        expect(bodyOf(0)).toEqual({ new_pass: 'Strong1!pass', password: 'Old1!pass' });
        expect($('.dashboard-form-done p').text()).toBe('password_changed');
    });

    it('lets a provider-only account use its new password from then on', async () => {
        window.user.oidc_only = true;
        fetch.mockResolvedValueOnce(reply(200));
        open();

        await submitWith({ next: 'Strong1!pass', confirm: 'Strong1!pass' });

        expect(window.user.oidc_only).toBe(false);
    });

    it('shows the server message and keeps the form when the change is refused', async () => {
        fetch.mockResolvedValueOnce(reply(400, { message: 'Wrong password' }));
        open();

        await submitWith({ current: 'Old1!pass', next: 'Strong1!pass', confirm: 'Strong1!pass' });

        expect(status()).toBe('Wrong password');
        expect(field('next').prop('disabled')).toBe(false);
    });
});

describe('change email', () => {
    it('shows the code field for an account with 2FA and keeps leading zeroes', async () => {
        window.user.otp = true;
        fetch.mockResolvedValueOnce(reply(200));
        dialogs.openChangeEmailDialog();
        expect($('.dashboard-form-field[data-field="code"]').prop('hidden')).toBe(false);

        await submitWith({ email: 'new@example.com', password: 'pw', code: '000123' });

        expect(bodyOf(0)).toEqual({ new_email: 'new@example.com', password: 'pw', code: '000123' });
        expect($('.dashboard-form-done p').text()).toBe('email_change_confirmation_sent');
        // Unconfirmed until the emailed link is followed.
        expect(window.user.email).toBe('alice@example.com');
    });

    it("doesn't post the address the account already has", async () => {
        dialogs.openChangeEmailDialog();
        await submitWith({ email: ' Alice@Example.com ', password: 'pw' });
        expect(status()).toBe('email_unchanged');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('leaves the code out for an account without 2FA', async () => {
        fetch.mockResolvedValueOnce(reply(200));
        dialogs.openChangeEmailDialog();
        expect($('.dashboard-form-field[data-field="code"]').prop('hidden')).toBe(true);

        await submitWith({ email: 'new@example.com', password: 'pw' });

        expect(bodyOf(0)).not.toHaveProperty('code');
    });

    it('reveals the code field when the server asks for a second factor', async () => {
        fetch.mockResolvedValueOnce(reply(400, { factor: 'otp', code: 'bad_request', message: 'Enter your code' }));
        dialogs.openChangeEmailDialog();

        await submitWith({ email: 'new@example.com', password: 'pw' });

        expect($('.dashboard-form-field[data-field="code"]').prop('hidden')).toBe(false);
        expect(status()).toBe('Enter your code');
        expect(document.activeElement).toBe(field('code').get(0));
        expect(window.handleReauthRequired).not.toHaveBeenCalled();
    });
});

describe('create API token', () => {
    it('needs a label', async () => {
        dialogs.openCreateTokenDialog();
        await submitWith({ label: '  ' });
        expect(status()).toBe('token_label_required');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('mints the token and shows it once with a copy button', async () => {
        fetch.mockResolvedValueOnce(reply(200, { token: 'tok-abc' }));
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        dialogs.openCreateTokenDialog();

        await submitWith({ label: ' CLI ', expiresIn: '30d' });

        expect(String(fetch.mock.calls[0][0])).toBe('https://api.puter.test/auth/create-access-token');
        expect(bodyOf(0)).toMatchObject({ label: 'CLI', expiresIn: '30d' });
        expect($('.dashboard-copy-value').val()).toBe('tok-abc');

        $('.dashboard-copy-btn').trigger('click');
        await settle();
        expect(writeText).toHaveBeenCalledWith('tok-abc');
        expect($('.dashboard-copy-btn').text()).toBe('token_copied');
    });

    it('shows why minting failed', async () => {
        fetch.mockResolvedValueOnce(reply(403, { message: 'Verify your email first' }));
        dialogs.openCreateTokenDialog();

        await submitWith({ label: 'CLI' });

        expect(status()).toBe('Verify your email first');
    });
});

describe('change language', () => {
    beforeEach(() => {
        window.locale = 'en';
        window.listSupportedLanguages = () => [
            { code: 'en', name: 'English' },
            { code: 'de', name: 'Deutsch' },
            { code: 'ja', name: '日本語' },
        ];
        window.mutate_user_preferences = vi.fn();
        globalThis.puter.kv = { set: vi.fn(async () => true) };
    });

    it('lists every language by its own name, with the current one selected', () => {
        dialogs.openChangeLanguageDialog();
        const options = field('language').find('option').map((_, el) => [[el.value, el.textContent]]).get();
        expect(options).toEqual([['en', 'English'], ['de', 'Deutsch'], ['ja', '日本語']]);
        expect(field('language').val()).toBe('en');
    });

    it('closes without saving when the language is unchanged', async () => {
        dialogs.openChangeLanguageDialog();

        await submitWith({ language: 'en' });

        expect(puter.kv.set).not.toHaveBeenCalled();
        expect(isOpen()).toBe(false);
    });

    it('saves the picked language to the account', async () => {
        dialogs.openChangeLanguageDialog();

        await submitWith({ language: 'de' });

        expect(puter.kv.set).toHaveBeenCalledWith('user_preferences.language', 'de');
        expect(window.mutate_user_preferences).toHaveBeenCalledWith({ language: 'de' });
        expect(status()).toBe('');
    });

    it('stays open with an error when the save fails', async () => {
        puter.kv.set.mockRejectedValue(new Error('offline'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        dialogs.openChangeLanguageDialog();

        await submitWith({ language: 'de' });

        expect(window.mutate_user_preferences).not.toHaveBeenCalled();
        expect(status()).toBe('language_save_failed');
        expect(isOpen()).toBe(true);
    });
});

describe('delete account', () => {
    it('asks a temporary account to type confirm', async () => {
        // What the server sends for a temporary account: no password, so `oidc_only` too.
        window.user = { username: 'guest', is_temp: true, oidc_only: true };
        fetch.mockResolvedValueOnce(reply(200, { success: true }));
        dialogs.openDeleteAccountDialog();

        await submitWith({ confirm: 'nope' });
        expect(status()).toBe('type_confirm_to_delete_account');
        expect(fetch).not.toHaveBeenCalled();

        await submitWith({ confirm: ' Confirm ' });
        expect(openRevalidatePopup).not.toHaveBeenCalled();
        expect(bodyOf(0)).toEqual({});
        expect(window.logout).toHaveBeenCalled();
    });

    it('needs the password of a password account, then signs out', async () => {
        fetch.mockResolvedValueOnce(reply(200, { success: true }));
        dialogs.openDeleteAccountDialog();
        expect($('.dashboard-form-submit').hasClass('dashboard-dialog-btn-danger')).toBe(true);

        await submitWith();
        expect(status()).toBe('all_fields_required');

        await submitWith({ password: 'pw' });
        expect(bodyOf(0)).toEqual({ password: 'pw' });
        expect(window.user.deleted).toBe(true);
        expect(window.logout).toHaveBeenCalled();
    });

    // A hard logout here would read as "the account is gone".
    it('prompts sign-in rather than signing out when the session cookie cannot be restored', async () => {
        fetch
            .mockResolvedValueOnce(reply(401, { code: 'token_missing' }))
            .mockResolvedValueOnce(reply(401));
        dialogs.openDeleteAccountDialog();

        await submitWith({ password: 'pw' });

        expect(window.handleReauthRequired).toHaveBeenCalled();
        expect(window.logout).not.toHaveBeenCalled();
        expect(window.user.deleted).toBeUndefined();
        expect(status()).toBe('reauth_required_message');
    });
});

describe('disable 2FA', () => {
    const open = (user = {}) => {
        window.user = { username: 'alice', otp: true, ...user };
        const result = { settled: false, value: undefined };
        dialogs.openDisable2FADialog().then((value) => Object.assign(result, { settled: true, value }));
        return result;
    };

    it('sends the password and code, and resolves true only once the server accepts', async () => {
        fetch.mockResolvedValueOnce(reply(200));
        const result = open();

        await submitWith({ password: 'hunter2', code: '000123' });

        expect(String(fetch.mock.calls[0][0])).toBe('https://puter.test/user-protected/disable-2fa');
        expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(bodyOf(0)).toEqual({ password: 'hunter2', code: '000123' });
        expect(window.user.otp).toBe(false);
        expect(isOpen()).toBe(false);
        expect(result).toEqual({ settled: true, value: true });
    });

    it('trims and uppercases a pasted recovery code', async () => {
        fetch.mockResolvedValueOnce(reply(200));
        open();

        await submitWith({ password: 'hunter2', code: ' abcd2345\n' });

        expect(bodyOf(0)).toEqual({ password: 'hunter2', code: 'ABCD2345' });
    });

    it('asks for the password before sending anything', async () => {
        const result = open();

        await submitWith({ code: '000123' });

        expect(fetch).not.toHaveBeenCalled();
        expect(status()).toBe('all_fields_required');
        expect(field('password').attr('aria-invalid')).toBe('true');
        expect(result.settled).toBe(false);
    });

    it.each([400, 401])('leaves 2FA on and allows a retry after a code is refused (%s)', async (code) => {
        fetch.mockResolvedValueOnce(reply(code, { factor: 'otp', code: code === 401 ? 'code_mismatch' : 'bad_request', message: 'Enter your code' }));
        const result = open();

        await submitWith({ password: 'hunter2', code: '000123' });

        expect(window.user.otp).toBe(true);
        expect(window.handleReauthRequired).not.toHaveBeenCalled();
        expect(isOpen()).toBe(true);
        expect(result.settled).toBe(false);
        expect(status()).toBe(code === 401 ? 'confirm_code_generic_incorrect' : 'Enter your code');
        expect(field('code').attr('aria-invalid')).toBe('true');
        expect(field('code').prop('disabled')).toBe(false);
        expect($('.dashboard-form-submit').prop('disabled')).toBe(false);
    });

    it('puts a wrong password on the password field', async () => {
        fetch.mockResolvedValueOnce(reply(400, { code: 'password_mismatch' }));
        open();

        await submitWith({ password: 'nope', code: '000123' });

        expect(status()).toBe('incorrect_password');
        expect(field('password').attr('aria-invalid')).toBe('true');
        expect(window.user.otp).toBe(true);
    });

    it.each([true, false])('keeps the code across a provider sign-in (cached provider-only state: %s)', async (oidcOnly) => {
        if ( ! oidcOnly ) {
            fetch.mockResolvedValueOnce(reply(403, { code: 'oidc_revalidation_required', revalidate_url: 'https://puter.test/revalidate' }));
        }
        fetch.mockResolvedValueOnce(reply(200));
        const result = open({ oidc_only: oidcOnly, oidc_revalidate_url: 'https://puter.test/revalidate' });
        expect(field('password').closest('.dashboard-form-field').prop('hidden')).toBe(oidcOnly);

        await submitWith(oidcOnly ? { code: '000123' } : { password: 'hunter2', code: '000123' });

        expect(openRevalidatePopup).toHaveBeenCalledOnce();
        expect(openRevalidatePopup).toHaveBeenCalledWith('https://puter.test/revalidate');
        expect(bodyOf(oidcOnly ? 0 : 1)).toEqual({ code: '000123' });
        expect(result).toEqual({ settled: true, value: true });
    });

    it('sends nothing when the provider sign-in does not finish', async () => {
        openRevalidatePopup.mockRejectedValueOnce(new Error('closed'));
        const result = open({ oidc_only: true, oidc_revalidate_url: 'https://puter.test/revalidate' });

        await submitWith({ code: '000123' });

        expect(fetch).not.toHaveBeenCalled();
        expect(status()).toBe('revalidate_failed');
        expect(window.user.otp).toBe(true);
        expect(result.settled).toBe(false);
    });

    it('keeps the code when a missing session cookie is renewed', async () => {
        fetch.mockResolvedValueOnce(reply(401, { code: 'token_missing' }))
            .mockResolvedValueOnce(reply(200))
            .mockResolvedValueOnce(reply(200));
        const result = open();

        await submitWith({ password: 'hunter2', code: '000123' });

        expect(String(fetch.mock.calls[1][0])).toContain('/session/sync-cookie');
        expect(bodyOf(2)).toEqual(bodyOf(0));
        expect(bodyOf(2).code).toBe('000123');
        expect(result).toEqual({ settled: true, value: true });
    });

    it('starts the sign-in flow when the session cookie cannot be renewed', async () => {
        fetch.mockResolvedValueOnce(reply(401, { code: 'reauth_required', reason: 'legacy', auth_id: 'a1' }))
            .mockResolvedValueOnce(reply(401));
        const result = open();

        await submitWith({ password: 'hunter2', code: '000123' });

        expect(window.handleReauthRequired).toHaveBeenCalledWith({ reason: 'legacy', auth_id: 'a1' });
        expect(status()).toBe('reauth_required_message');
        expect(window.user.otp).toBe(true);
        expect(result.settled).toBe(false);
    });

    it('says something went wrong when the request gets no answer, and allows a retry', async () => {
        fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const result = open();

        await submitWith({ password: 'hunter2', code: '000123' });

        expect(status()).toBe('something_went_wrong');
        expect($('.dashboard-form-submit').prop('disabled')).toBe(false);
        expect(result.settled).toBe(false);
    });

    it.each(['.dashboard-form-cancel', '.dashboard-dialog-close'])('resolves false and changes nothing when closed with %s', async (selector) => {
        const result = open();

        $(selector).trigger('click');
        await settle();

        expect(result).toEqual({ settled: true, value: false });
        expect(window.user.otp).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['true when the server accepts', reply(200), true],
        ['false when the server refuses', reply(400, { code: 'code_mismatch', factor: 'otp' }), false],
    ])('closed while the request is out, resolves %s', async (_, response, value) => {
        let answer;
        fetch.mockReturnValueOnce(new Promise((resolve) => {
            answer = resolve;
        }));
        const result = open();
        await submitWith({ password: 'hunter2', code: '000123' });

        $('.dashboard-dialog-close').trigger('click');
        await settle();
        expect(isOpen()).toBe(false);
        expect(result.settled).toBe(false);

        answer(response);
        for ( let i = 0; i < 10; i++ ) await settle();
        expect(result).toEqual({ settled: true, value });
        expect(window.user.otp).toBe(! value);
    });

    it('resolves false when dismissed with Escape', async () => {
        const result = open();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();

        expect(result).toEqual({ settled: true, value: false });
    });
});
