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

// The sign-in link screen: mails a link that signs the user in. The sign-in
// finishes on the tab the link opens, and this screen only says to check the
// inbox.

import { formFieldHtml } from '../Dashboard/UIDashboardFormDialog.js';
import { SVG } from '../Dashboard/UIDashboardDialog.js';
import {
    authHeadHtml,
    setAuthStatus,
    setFormBusy,
    submitButtonHtml,
    wireAuthHead,
} from './authFlow.js';
import { pushLoginScreen } from './UIAuthLogin.js';
import { buildRequestBody, looksLikeEmail } from '../../helpers/magicLinkSignIn.js';

/** The envelope on the login screen's "Sign in with Email Link" button. */
export const MAGIC_LINK_ICON = SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>');

const SENT_ICON = SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>');

/**
 * Shows the sign-in link screen in `flow`.
 *
 * With `opener_origin`, this is a third-party site's popup: the link signs
 * the user in to that site and lands on `return_url`. Without it, the link
 * signs the user in to Puter itself.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @param {{ email?: string, opener_origin?: string, return_url?: string }} [opts]
 * @returns {jQuery}
 */
export function pushMagicLinkScreen (flow, { email = '', opener_origin, return_url } = {}) {
    const id = `auth-magic-link-${window.uuidv4?.() ?? Date.now()}`;

    let h = '<div class="dashboard-dialog-body auth-body">';
    h += authHeadHtml(flow, i18n('magic_link_title', [], false));
    h += '<form class="auth-form magic-link-form" novalidate>';
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += formFieldHtml({
        name: 'email',
        type: 'email',
        label: i18n('email'),
        value: email,
        attrs: { autocomplete: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
    }, id);
    h += submitButtonHtml(i18n('magic_link_continue', [], false), 'magic-link-send-btn');
    h += `<p class="signup-terms">${i18n('magic_link_tos_fineprint', [], false)}</p>`;
    h += '</form>';
    h += '</div>';
    h += '<div class="dashboard-dialog-footer auth-footer">';
    h += `<button type="button" class="auth-link auth-to-login">${i18n('magic_link_log_in_c2a')}</button>`;
    h += '</div>';

    const $screen = flow.push({ name: 'magic-link', html: h });
    const $form = $screen.find('.magic-link-form');
    const $email = $form.find('[name="email"]');
    wireAuthHead($screen);

    $form.on('input', '.dashboard-form-input', function () {
        $(this).removeAttr('aria-invalid');
    });

    $screen.find('.auth-to-login').on('click', () => {
        if ( flow.isBusy() ) return;
        const typed = String($email.val() ?? '').trim();
        if ( ! flow.goTo('login') ) pushLoginScreen(flow, typed ? { email_or_username: typed } : {});
    });

    $form.on('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ( flow.isBusy() ) return;

        const value = String($email.val() ?? '').trim();
        if ( ! looksLikeEmail(value) ) {
            setAuthStatus($screen, i18n('magic_link_invalid_email', [], false), { field: '[name="email"]' });
            return;
        }
        const body = buildRequestBody({
            email: value,
            returnUrl: return_url,
            openerOrigin: opener_origin,
        });
        if ( ! body ) {
            setAuthStatus($screen, i18n('magic_link_request_failed', [], false));
            return;
        }
        setAuthStatus($screen, '');
        flow.setBusy(true);
        setFormBusy($form, true);

        const unlock = () => {
            setFormBusy($form, false);
            flow.setBusy(false);
        };

        let resp;
        try {
            resp = await fetch(`${window.api_origin}/auth/magic-link/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch {
            unlock();
            setAuthStatus($screen, i18n('magic_link_request_failed', [], false));
            return;
        }
        unlock();
        if ( flow.isClosed() ) return;
        if ( resp.status === 429 ) {
            setAuthStatus($screen, i18n('magic_link_too_many_requests', [], false));
            return;
        }
        if ( ! resp.ok ) {
            setAuthStatus($screen, i18n('magic_link_request_failed', [], false));
            return;
        }

        // The rest happens from the inbox; the way back to the login stays below.
        $form.replaceWith('<div class="dashboard-form-done auth-done" role="status">'
            + `${SENT_ICON}<p>${html_encode(i18n('magic_link_sent_message', { email: value }, false))}</p></div>`);
        $screen.find('.auth-to-login').get(0)?.focus({ preventScroll: true });
    });

    return $screen;
}
