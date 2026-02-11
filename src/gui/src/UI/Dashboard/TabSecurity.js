/**
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

import TeePromise from '../../util/TeePromise.js';
import UIComponentWindow from '../UIComponentWindow.js';
import UIWindow2FASetup from '../UIWindow2FASetup.js';
import UIWindowChangePassword from '../UIWindowChangePassword.js';
import UIWindowManageSessions from '../UIWindowManageSessions.js';

const TabSecurity = {
    id: 'security',
    label: i18n('security'),
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',

    html () {
        let h = '';
        let user = window.user;

        h += '<div class="dashboard-tab-content">';

        // Section header
        h += '<div class="dashboard-section-header">';
        h += `<h2>${i18n('security')}</h2>`;
        h += '<p>Manage your security settings and sessions</p>';
        h += '</div>';

        // Security settings cards
        h += '<div class="dashboard-settings-grid">';

        // Password card (only for non-temp users)
        if ( ! user.is_temp ) {
            h += '<div class="dashboard-card dashboard-settings-card">';
            h += '<div class="dashboard-settings-card-content">';
            h += '<div class="dashboard-settings-card-icon">';
            h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
            h += '</div>';
            h += '<div class="dashboard-settings-card-info">';
            h += `<strong>${i18n('password')}</strong>`;
            h += '<span>••••••••</span>';
            h += '</div>';
            h += '</div>';
            h += `<button class="button change-password">${i18n('change_password')}</button>`;
            h += '</div>';
        }

        // Sessions card
        h += '<div class="dashboard-card dashboard-settings-card">';
        h += '<div class="dashboard-settings-card-content">';
        h += '<div class="dashboard-settings-card-icon">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
        h += '</div>';
        h += '<div class="dashboard-settings-card-info">';
        h += `<strong>${i18n('sessions')}</strong>`;
        h += '<span>Manage active sessions</span>';
        h += '</div>';
        h += '</div>';
        h += `<button class="button manage-sessions">${i18n('manage_sessions')}</button>`;
        h += '</div>';

        // 2FA card (only for non-temp users with confirmed email)
        if ( !user.is_temp && user.email_confirmed ) {
            const twoFaStatusClass = user.otp ? 'dashboard-settings-card-success' : 'dashboard-settings-card-warning';
            h += `<div class="dashboard-card dashboard-settings-card dashboard-settings-card-2fa ${twoFaStatusClass}">`;
            h += '<div class="dashboard-settings-card-content">';
            h += '<div class="dashboard-settings-card-icon">';
            h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
            h += '</div>';
            h += '<div class="dashboard-settings-card-info">';
            h += `<strong>${i18n('two_factor')}</strong>`;
            h += `<span class="user-otp-state">${i18n(user.otp ? 'two_factor_enabled' : 'two_factor_disabled')}</span>`;
            h += '</div>';
            h += '</div>';
            h += `<button class="button enable-2fa" style="${user.otp ? 'display:none;' : ''}">${i18n('enable_2fa')}</button>`;
            h += `<button class="button disable-2fa" style="${user.otp ? '' : 'display:none;'}">${i18n('disable_2fa')}</button>`;
            h += '</div>';
        }

        h += '</div>'; // end settings-grid

        h += '</div>'; // end dashboard-tab-content
        return h;
    },

    init ($el_window) {
        $el_window.find('.dashboard-section-security .change-password').on('click', function (e) {
            UIWindowChangePassword({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                },
            });
        });

        $el_window.find('.dashboard-section-security .manage-sessions').on('click', function (e) {
            UIWindowManageSessions({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    parent_center: true,
                    stay_on_top: true,
                    has_head: false,
                    parent_center: true,
                },
            });
        });

        $el_window.find('.dashboard-section-security .enable-2fa').on('click', async function (e) {
            const { promise } = await UIWindow2FASetup({
                window_options: {
                    parent_uuid: $el_window.attr('data-element_uuid'),
                    backdrop: true,
                    close_on_backdrop_click: true,
                    stay_on_top: true,
                    has_head: false,
                    parent_center: true,
                },
            });
            const tfa_was_enabled = await promise;

            if ( tfa_was_enabled ) {
                $el_window.find('.dashboard-section-security .enable-2fa').hide();
                $el_window.find('.dashboard-section-security .disable-2fa').show();
                $el_window.find('.dashboard-section-security .user-otp-state').text(i18n('two_factor_enabled'));
                $el_window.find('.dashboard-section-security .dashboard-settings-card-2fa').removeClass('dashboard-settings-card-warning');
                $el_window.find('.dashboard-section-security .dashboard-settings-card-2fa').addClass('dashboard-settings-card-success');
            }
        });

        $el_window.find('.dashboard-section-security .disable-2fa').on('click', async function (e) {
            let win;
            const password_confirm_promise = new TeePromise();
            const try_password = async () => {
                const value = $win.find('.password-entry').val();
                // Do not send Authorization: user-protected endpoints use session cookie (hasHttpPowers)
                const resp = await fetch(`${window.api_origin}/user-protected/disable-2fa`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        password: value,
                    }),
                });
                if ( resp.status !== 200 ) {
                    /* eslint no-empty: ["error", { "allowEmptyCatch": true }] */
                    let message; try {
                        message = (await resp.json()).message;
                    } catch (e) {
                    }
                    message = message || i18n('error_unknown_cause');
                    $win.find('.password-entry').addClass('error');
                    $win.find('.error-message').text(message).show();
                    return;
                }
                password_confirm_promise.resolve(true);
                $(win).close();
            };

            let h = '';
            h += '<div style="display: flex; flex-direction: column; gap: 20pt; justify-content: center;">';
            h += '<div>';
            h += `<h3 style="text-align:center; font-weight: 500; font-size: 20px;">${i18n('disable_2fa_confirm')}</h3>`;
            h += `<p style="text-align:center; padding: 0 20px;">${i18n('disable_2fa_instructions')}</p>`;
            h += '</div>';
            h += '<div style="display: flex; flex-direction: column; gap: 10pt;">';
            h += '<input type="password" class="password-entry" />';
            h += '<span class="error-message" style="color: var(--dashboard-error-text); display: none;"></span>';
            h += '</div>';
            h += '<div style="display: flex; gap: 5pt;">';
            h += `<button class="button confirm-disable-2fa">${i18n('disable_2fa')}</button>`;
            h += `<button class="button secondary cancel-disable-2fa">${i18n('cancel')}</button>`;
            h += '</div>';
            h += '</div>';

            win = await UIComponentWindow({
                html: h,
                width: 500,
                backdrop: true,
                is_resizable: false,
                body_css: {
                    width: 'initial',
                    'background-color': 'var(--dashboard-input-background)',
                    'backdrop-filter': 'blur(3px)',
                    padding: '20px',
                },
            });

            // Set up event listeners
            const $win = $(win);
            const $password_entry = $win.find('.password-entry');

            $password_entry.on('keypress', (e) => {
                if ( e.which === 13 ) { // Enter key
                    try_password();
                }
            });

            $win.find('.confirm-disable-2fa').on('click', () => {
                try_password();
            });

            $win.find('.cancel-disable-2fa').on('click', () => {
                password_confirm_promise.resolve(false);
                $win.close();
            });

            $password_entry.focus();

            const ok = await password_confirm_promise;
            if ( ! ok ) return;

            $el_window.find('.dashboard-section-security .enable-2fa').show();
            $el_window.find('.dashboard-section-security .disable-2fa').hide();
            $el_window.find('.dashboard-section-security .user-otp-state').text(i18n('two_factor_disabled'));
            $el_window.find('.dashboard-section-security .dashboard-settings-card-2fa').removeClass('dashboard-settings-card-success');
            $el_window.find('.dashboard-section-security .dashboard-settings-card-2fa').addClass('dashboard-settings-card-warning');
        });
    },
};

export default TabSecurity;
