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

// The Account (and Security) tab's dialogs: dashboard form dialogs rather
// than desktop windows, so they read as part of the dashboard and dock as
// bottom sheets on phones.

import check_password_strength from '../../helpers/checkPasswordStrength.js';
import create_access_token from '../../helpers/createAccessToken.js';
import postUserProtected from '../../helpers/postUserProtected.js';
import update_username_in_gui from '../../helpers/updateUsernameInGui.js';
import UIWindowManageSessions from '../UIWindowManageSessions.js';
import UIDashboardFormDialog from './UIDashboardFormDialog.js';

// Keep in sync with ProfileService on the backend.
const DISPLAY_NAME_MAX_LENGTH = 64;
const BIO_MAX_LENGTH = 280;
const TOKEN_LABEL_MAX_LENGTH = 64;
const TOKEN_COPIED_RESET_MS = 2000;

/**
 * @typedef {object} AccountDialogOptions
 * @property {jQuery} [$container] Where the overlay mounts.
 * @property {HTMLElement} [returnFocusTo] Where focus goes on close.
 */

const t = (key) => i18n(key, [], false);

/** An account that signs in only through a linked provider has no password to ask for. */
const isOidcOnly = () => !! window.user?.oidc_only;

/** The account-password field the protected routes need, unless the account has none. */
const passwordField = (label) => ({
    name: 'password',
    type: 'password',
    label,
    hidden: isOidcOnly(),
    attrs: { autocomplete: 'current-password' },
});

/** Text that tells a provider-only account what will happen instead of a password. */
const oidcNotice = () => (isOidcOnly() ? `<p>${i18n('revalidate_flow_notice')}</p>` : '');

/** Status while the provider's sign-in popup is up. */
const revalidating = (dialog) => () => dialog.setStatus(t('revalidate_sign_in_popup'), { kind: 'info' });

/**
 * Edits the signed-in user's display name and bio.
 *
 * @param {AccountDialogOptions & { onSave?: (profile: { displayName?: string|null, bio?: string|null }) => void }} [opts]
 */
export function openEditProfileDialog ({ onSave, ...opts } = {}) {
    return UIDashboardFormDialog({
        ...opts,
        title: t('edit_profile'),
        submitLabel: t('save'),
        fields: [
            {
                name: 'displayName',
                label: i18n('display_name'),
                value: window.user?.profile?.displayName ?? '',
                attrs: { maxlength: DISPLAY_NAME_MAX_LENGTH, autocomplete: 'off' },
            },
            {
                name: 'bio',
                type: 'textarea',
                label: i18n('bio'),
                value: window.user?.profile?.bio ?? '',
                attrs: { maxlength: BIO_MAX_LENGTH, rows: 4 },
            },
        ],
        async onSubmit (dialog) {
            const values = dialog.values();
            // An empty field clears it.
            const patch = {
                displayName: values.displayName.trim() || null,
                bio: values.bio.trim() || null,
            };
            // update_profile resolves with no profile when the request failed.
            const profile = await window.update_profile(window.user.username, patch);
            if ( ! profile ) {
                dialog.setStatus(t('profile_save_failed'));
                return;
            }
            onSave?.(profile);
            dialog.close();
        },
    });
}

/**
 * Changes the signed-in user's username.
 *
 * @param {AccountDialogOptions} [opts]
 */
export function openChangeUsernameDialog (opts = {}) {
    return UIDashboardFormDialog({
        ...opts,
        title: t('change_username'),
        intro: oidcNotice(),
        submitLabel: t('change_username'),
        fields: [
            {
                name: 'username',
                label: i18n('new_username'),
                attrs: { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
            },
            passwordField(i18n('account_password')),
        ],
        async onSubmit (dialog) {
            const { username, password } = dialog.values();
            const new_username = username.trim();
            if ( ! new_username ) {
                dialog.setStatus(t('all_fields_required'), { field: 'username' });
                return;
            }
            if ( ! isOidcOnly() && ! password ) {
                dialog.setStatus(t('all_fields_required'), { field: 'password' });
                return;
            }
            const result = await postUserProtected('change-username', { new_username }, {
                password,
                onRevalidate: revalidating(dialog),
            });
            if ( ! result.ok ) {
                dialog.setStatus(result.message);
                return;
            }
            update_username_in_gui(new_username);
            window.user.username = new_username;
            dialog.finish({ message: t('username_changed') });
        },
    });
}

/**
 * Changes the signed-in user's password.
 *
 * @param {AccountDialogOptions} [opts]
 */
export function openChangePasswordDialog (opts = {}) {
    return UIDashboardFormDialog({
        ...opts,
        title: t('window_title_change_password'),
        intro: oidcNotice(),
        submitLabel: t('change_password'),
        fields: [
            {
                ...passwordField(i18n('current_password')),
                name: 'current',
            },
            {
                name: 'next',
                type: 'password',
                label: i18n('new_password'),
                hint: i18n('password_strength_error'),
                attrs: { autocomplete: 'new-password' },
            },
            {
                name: 'confirm',
                type: 'password',
                label: i18n('confirm_new_password'),
                attrs: { autocomplete: 'new-password' },
            },
        ],
        async onSubmit (dialog) {
            const { current, next, confirm } = dialog.values();
            if ( ! isOidcOnly() && ! current ) {
                dialog.setStatus(t('all_fields_required'), { field: 'current' });
                return;
            }
            if ( ! next || ! confirm ) {
                dialog.setStatus(t('all_fields_required'), { field: next ? 'confirm' : 'next' });
                return;
            }
            if ( next !== confirm ) {
                dialog.setStatus(t('passwords_do_not_match'), { field: 'confirm' });
                return;
            }
            if ( ! check_password_strength(next).overallPass ) {
                dialog.setStatus(t('password_strength_error'), { field: 'next' });
                return;
            }
            const result = await postUserProtected('change-password', { new_pass: next }, {
                password: current,
                onRevalidate: revalidating(dialog),
            });
            if ( ! result.ok ) {
                dialog.setStatus(result.message);
                return;
            }
            dialog.finish({ message: t('password_changed') });
        },
    });
}

/**
 * Starts changing the signed-in user's email: the server mails a link to
 * the new address, and the change lands when it is followed.
 *
 * @param {AccountDialogOptions} [opts]
 */
export function openChangeEmailDialog (opts = {}) {
    const dialog = UIDashboardFormDialog({
        ...opts,
        title: t('change_email'),
        intro: oidcNotice(),
        submitLabel: t('change_email'),
        fields: [
            {
                name: 'email',
                type: 'email',
                label: i18n('new_email'),
                attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false' },
            },
            passwordField(i18n('account_password')),
            {
                name: 'code',
                label: i18n('confirm_code_2fa_instruction'),
                hidden: ! window.user?.otp,
                attrs: { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*' },
            },
        ],
        async onSubmit () {
            const { email, password, code } = dialog.values();
            const new_email = email.trim();
            if ( ! new_email ) {
                dialog.setStatus(t('all_fields_required'), { field: 'email' });
                return;
            }
            if ( ! isOidcOnly() && ! password ) {
                dialog.setStatus(t('all_fields_required'), { field: 'password' });
                return;
            }
            // Kept as typed: an authenticator code can start with zeroes.
            const result = await postUserProtected('change-email', { new_email, code: code || undefined }, {
                password,
                onRevalidate: revalidating(dialog),
            });
            if ( ! result.ok ) {
                // Accounts with 2FA turned on since the page loaded learn about it here.
                const needs_code = result.data.factor === 'otp';
                if ( needs_code ) dialog.showField('code', true);
                dialog.setStatus(result.message, needs_code ? { field: 'code' } : undefined);
                return;
            }
            window.user.email = new_email;
            dialog.finish({ message: t('email_change_confirmation_sent') });
        },
    });
    return dialog;
}

/**
 * Mints a named, revocable API token and shows it once.
 *
 * @param {AccountDialogOptions & { $sessionsParent?: jQuery }} [opts]
 *   `$sessionsParent` is the window the session manager link opens over.
 */
export function openCreateTokenDialog ({ $sessionsParent, ...opts } = {}) {
    const dialog = UIDashboardFormDialog({
        ...opts,
        title: t('create_api_token'),
        intro: `<p>${i18n('create_token_message')}</p>`,
        submitLabel: t('create_token'),
        fields: [
            {
                name: 'label',
                label: i18n('token_label'),
                placeholder: i18n('token_label_placeholder'),
                attrs: { maxlength: TOKEN_LABEL_MAX_LENGTH, autocomplete: 'off' },
            },
            {
                name: 'expiresIn',
                type: 'select',
                label: i18n('token_expiry'),
                value: '',
                options: [
                    { value: '', label: i18n('token_expiry_never') },
                    { value: '7d', label: i18n('token_expiry_7d') },
                    { value: '30d', label: i18n('token_expiry_30d') },
                    { value: '90d', label: i18n('token_expiry_90d') },
                ],
            },
        ],
        async onSubmit () {
            const { label, expiresIn } = dialog.values();
            if ( ! label.trim() ) {
                dialog.setStatus(t('token_label_required'), { field: 'label' });
                return;
            }
            const token = await create_access_token({ label: label.trim(), expiresIn: expiresIn || null });

            let h = `<div class="dashboard-token-warning">${i18n('token_shown_once_warning')}</div>`;
            h += '<div class="dashboard-token-row">';
            h += `<input type="text" class="dashboard-dialog-input dashboard-token-value" readonly value="${html_encode(token)}" aria-label="${i18n('api_token')}" spellcheck="false">`;
            h += `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-token-copy">${i18n('copy')}</button>`;
            h += '</div>';
            h += `<p class="dashboard-form-hint">${i18n('token_manage_hint')} <button type="button" class="dashboard-token-sessions">${i18n('ui_manage_sessions')}</button>.</p>`;
            dialog.finish({ html: h });
        },
    });

    let copied_timer = null;
    dialog.$dialog.on('click', '.dashboard-token-copy', function () {
        const $btn = $(this);
        const $value = dialog.$dialog.find('.dashboard-token-value');
        navigator.clipboard.writeText(String($value.val())).then(() => {
            $btn.text(t('token_copied'));
            clearTimeout(copied_timer);
            copied_timer = setTimeout(() => $btn.text(t('copy')), TOKEN_COPIED_RESET_MS);
        }, () => {
            // No clipboard access: select it so the user can copy it by hand.
            $value.get(0)?.select();
        });
    });
    dialog.$dialog.on('focus', '.dashboard-token-value', function () {
        this.select();
    });
    dialog.$dialog.on('click', '.dashboard-token-sessions', () => {
        UIWindowManageSessions({
            window_options: {
                parent_uuid: $sessionsParent?.attr('data-element_uuid'),
                backdrop: true,
                close_on_backdrop_click: true,
                parent_center: true,
                stay_on_top: true,
                has_head: false,
            },
        });
    });
    return dialog;
}

/**
 * Deletes the signed-in user's account once they confirm it: by typing
 * "confirm" for a temporary account, with their password, or by signing in
 * with their linked provider when the account has no password.
 *
 * @param {AccountDialogOptions} [opts]
 */
export function openDeleteAccountDialog (opts = {}) {
    const is_temp = !! window.user?.is_temp;
    const fields = [];
    if ( is_temp ) {
        fields.push({
            name: 'confirm',
            label: i18n('type_confirm_to_delete_account'),
            attrs: { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
        });
    } else if ( ! isOidcOnly() ) {
        fields.push(passwordField(i18n('enter_password_to_confirm_delete_user')));
    }

    return UIDashboardFormDialog({
        ...opts,
        tone: 'danger',
        title: t('confirm_delete_user_title'),
        intro: `<p>${i18n('confirm_delete_user')}</p>${is_temp ? '' : oidcNotice()}`,
        submitLabel: t('delete_account'),
        fields,
        async onSubmit (dialog) {
            const { confirm, password } = dialog.values();
            if ( is_temp ) {
                // "confirm", or the word in the user's language.
                const typed = confirm.trim().toLowerCase();
                if ( typed !== 'confirm' && typed !== t('confirm').toLowerCase() ) {
                    dialog.setStatus(t('type_confirm_to_delete_account'), { field: 'confirm' });
                    return;
                }
            } else if ( ! isOidcOnly() && ! password ) {
                dialog.setStatus(t('all_fields_required'), { field: 'password' });
                return;
            }
            const result = await postUserProtected('delete-own-user', {}, {
                password: is_temp ? undefined : password,
                onRevalidate: revalidating(dialog),
            });
            if ( ! result.ok || ! result.data.success ) {
                dialog.setStatus(result.message ?? t('error_unknown_cause'));
                return;
            }
            window.user.deleted = true;
            window.logout();
        },
    });
}
