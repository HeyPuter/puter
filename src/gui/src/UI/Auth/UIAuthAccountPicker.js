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

// The account picker: the accounts signed in on this browser, to continue
// as one of them, log in to another, or create one. In a sign-in popup,
// picking an account is the user's consent to sign the opener in.

import { SVG } from '../Dashboard/UIDashboardDialog.js';
import openAuthFlow, { authHeadHtml, joinAuthFlow, wireAuthHead } from './authFlow.js';
import { pushLoginScreen } from './UIAuthLogin.js';
import { pushSignupScreen } from './UIAuthSignup.js';

const CHEVRON_ICON = SVG('<path d="M9 18l6-6-6-6"/>');

/**
 * One account's row.
 *
 * @param {{ uuid: string, username: string, email?: string, profile?: { picture?: string } }} account
 * @returns {string}
 */
const accountRowHtml = (account) => {
    const username = String(account.username ?? '');
    const initial = username.charAt(0).toUpperCase();
    let h = '<li>';
    h += `<button type="button" class="auth-account" data-uuid="${html_encode(account.uuid)}">`;
    h += `<span class="auth-account-avatar" aria-hidden="true">${html_encode(initial)}</span>`;
    h += '<span class="auth-account-text">';
    h += `<span class="auth-account-name">${html_encode(username)}</span>`;
    if ( account.email ) h += `<span class="auth-account-detail">${html_encode(account.email)}</span>`;
    h += '</span>';
    h += '<span class="dashboard-form-spinner auth-account-spinner" aria-hidden="true"></span>';
    h += `<span class="auth-account-chevron" aria-hidden="true">${CHEVRON_ICON}</span>`;
    h += '</button>';
    h += '</li>';
    return h;
};

/**
 * Lays each account's picture over its initial. Set as a property, never
 * through markup; a picture that fails to load leaves the initial.
 *
 * @param {jQuery} $screen
 * @param {Array<{ uuid: string, profile?: { picture?: string } }>} accounts
 */
const paintPictures = ($screen, accounts) => {
    for ( const account of accounts ) {
        const picture = account.profile?.picture;
        if ( typeof picture !== 'string' || ! picture ) continue;
        const el_avatar = $screen.find('.auth-account').filter((_, el) => el.dataset.uuid === String(account.uuid))
            .find('.auth-account-avatar').get(0);
        if ( ! el_avatar ) continue;
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = picture;
        el_avatar.appendChild(img);
    }
};

/**
 * Shows the account picker in `flow`.
 *
 * @param {import('./authFlow.js').AuthFlow} flow
 * @returns {jQuery}
 */
export function pushAccountPickerScreen (flow) {
    const accounts = Array.isArray(window.logged_in_users) ? window.logged_in_users : [];

    let h = '<div class="dashboard-dialog-body auth-body">';
    // Everyone here has signed in to Puter before; no need to explain it.
    h += authHeadHtml(flow, i18n('sign_in_with_puter', [], false), { openerNotice: false });
    h += `<ul class="auth-accounts" aria-label="${i18n('sign_in_with_puter')}">`;
    h += accounts.map(accountRowHtml).join('');
    h += '</ul>';
    h += '</div>';
    h += '<div class="dashboard-dialog-footer auth-footer">';
    h += `<button type="button" class="auth-link auth-to-login">${i18n('add_another_account')}</button>`;
    h += '<span class="auth-footer-sep" aria-hidden="true">·</span>';
    h += `<button type="button" class="auth-link auth-to-signup">${i18n('create_account')}</button>`;
    h += '</div>';

    // Nothing to type here; focus lands on the card, not on an account.
    const $screen = flow.push({ name: 'accounts', html: h, autofocus: false });
    wireAuthHead($screen);
    paintPictures($screen, accounts);

    $screen.find('.auth-to-login').on('click', () => {
        if ( flow.isBusy() ) return;
        if ( ! flow.goTo('login') ) pushLoginScreen(flow);
    });
    $screen.find('.auth-to-signup').on('click', () => {
        if ( flow.isBusy() ) return;
        if ( ! flow.goTo('signup') ) pushSignupScreen(flow);
    });

    $screen.find('.auth-account').on('click', async function () {
        if ( flow.isBusy() ) return;
        const uuid = this.dataset.uuid;
        const account = accounts.find((candidate) => String(candidate.uuid) === uuid);
        if ( ! account ) return;
        flow.setBusy(true);
        $screen.find('.auth-account').prop('disabled', true);
        $(this).addClass('dashboard-form-busy').attr('aria-busy', 'true');

        await window.update_auth_data(account.auth_token, account);
        if ( flow.options.reload_on_success ) {
            // Disable the browser's own "leave this page?" prompt.
            window.onbeforeunload = null;
            location.reload();
            return;
        }
        flow.finish(true);
    });

    return $screen;
}

/**
 * Asks which of the accounts signed in on this browser to continue as.
 *
 * @param {Partial<import('./authFlow.js').AuthFlowOptions> & { page?: boolean }} [options]
 *   The picker can't be dismissed: it stands between a sign-in popup and
 *   the token it hands out, and on a signed-out boot it is the page.
 * @returns {Promise<boolean>} True once an account is picked or signed in,
 *   unless the page reloads first.
 */
export default function UIAuthAccountPicker (options = {}) {
    const joined = joinAuthFlow();
    if ( joined ) return joined;
    const flow = openAuthFlow({ page: options.page, dismissable: false, options });
    pushAccountPickerScreen(flow);
    return flow.result;
}
