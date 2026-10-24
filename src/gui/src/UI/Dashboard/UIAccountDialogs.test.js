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
        expect($('.dashboard-token-value').val()).toBe('tok-abc');

        $('.dashboard-token-copy').trigger('click');
        await settle();
        expect(writeText).toHaveBeenCalledWith('tok-abc');
        expect($('.dashboard-token-copy').text()).toBe('token_copied');
    });

    it('shows why minting failed', async () => {
        fetch.mockResolvedValueOnce(reply(403, { message: 'Verify your email first' }));
        dialogs.openCreateTokenDialog();

        await submitWith({ label: 'CLI' });

        expect(status()).toBe('Verify your email first');
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
