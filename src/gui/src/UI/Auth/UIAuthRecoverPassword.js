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

// The password recovery screen: mails a link to set a new password.

import { formFieldHtml } from '../Dashboard/UIDashboardFormDialog.js';
import { SVG } from '../Dashboard/UIDashboardDialog.js';
import openAuthFlow, {
    authHeadHtml,
    joinAuthFlow,
    setAuthStatus,
    setFormBusy,
    submitButtonHtml,
    wireAuthHead,
} from './authFlow.js';
import { pushLoginScreen } from './UIAuthLogin.js';

const SENT_ICON = SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>');

/**
 * The message of a failed request.
 *
 * @param {{ responseText?: string }} err
 * @returns {string}
 */
const errorMessage = (err) => {
    const text = err?.responseText || '';
    try {
        const json = JSON.parse(text);
        return json.message || json.error || text;
    } catch {
        return text || i18n('something_went_wrong', [], false);
    }
};

/**
 * Shows the password recovery screen in `flow`.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {{ email_or_username?: string }} [opts] Prefills the field.
 * @returns {jQuery}
 */
export function pushRecoverPasswordScreen (flow, { email_or_username = '' } = {}) {
    const id = `auth-recover-${window.uuidv4?.() ?? Date.now()}`;

    let h = '<div class="dashboard-dialog-body auth-body">';
    h += authHeadHtml(flow, i18n('recover_password', [], false));
    h += '<form class="auth-form pass-recovery-form" novalidate>';
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += formFieldHtml({
        name: 'email_or_username',
        label: i18n('email_or_username'),
        value: email_or_username,
        attrs: { autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
    }, id);
    h += submitButtonHtml(i18n('send_password_recovery_email', [], false), 'send-recovery-email');
    h += '</form>';
    h += '</div>';
    h += '<div class="dashboard-dialog-footer auth-footer">';
    h += `<button type="button" class="auth-link auth-to-login">${i18n('log_in')}</button>`;
    h += '</div>';

    const $screen = flow.push({ name: 'recover-password', html: h });
    const $form = $screen.find('.pass-recovery-form');
    const $input = $form.find('[name="email_or_username"]');
    wireAuthHead($screen);

    $screen.find('.auth-to-login').on('click', () => {
        if ( flow.isBusy() ) return;
        if ( ! flow.goTo('login') ) pushLoginScreen(flow, { email_or_username: String($input.val() ?? '').trim() });
    });

    $form.on('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ( flow.isBusy() ) return;
        const value = String($input.val() ?? '').trim();
        if ( ! value ) {
            setAuthStatus($screen, i18n('login_email_username_required', [], false), { field: '[name="email_or_username"]' });
            return;
        }
        setAuthStatus($screen, '');
        flow.setBusy(true);
        setFormBusy($form, true);

        let res;
        try {
            res = await new Promise((resolve, reject) => {
                $.ajax({
                    url: `${window.api_origin}/send-pass-recovery-email`,
                    type: 'POST',
                    async: true,
                    contentType: 'application/json',
                    data: JSON.stringify(window.is_email(value) ? { email: value } : { username: value }),
                    statusCode: {
                        401: (xhr) => window.handle401(xhr),
                    },
                    success: resolve,
                    error: reject,
                });
            });
        } catch ( err ) {
            flow.setBusy(false);
            setFormBusy($form, false);
            setAuthStatus($screen, errorMessage(err), { field: '[name="email_or_username"]' });
            return;
        }
        flow.setBusy(false);

        // The form gives way to what the server said happened; the way back
        // to the login stays below it.
        $form.replaceWith('<div class="dashboard-form-done auth-done" role="status">'
            + `${SENT_ICON}<p>${html_encode(res?.message ?? '')}</p></div>`);
        $screen.find('.auth-to-login').get(0)?.focus({ preventScroll: true });
    });

    return $screen;
}

/**
 * Asks for the account whose password to reset, on its own.
 *
 * @param {{ page?: boolean, dismissable?: boolean }} [options]
 * @returns {Promise<unknown>} Settles only if the user dismisses the card or
 *   signs in from it without the page reloading.
 */
export default function UIAuthRecoverPassword (options = {}) {
    const joined = joinAuthFlow();
    if ( joined ) return joined;
    const flow = openAuthFlow({ page: options.page, dismissable: options.dismissable });
    pushRecoverPasswordScreen(flow);
    return flow.result;
}
