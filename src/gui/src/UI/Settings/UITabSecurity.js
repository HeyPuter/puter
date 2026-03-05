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
import UIWindow2FASetup from '../UIWindow2FASetup.js';
import UIWindowDisable2FA from './UIWindowDisable2FA.js';

export default {
    id: 'security',
    title_i18n_key: 'security',
    icon: 'shield.svg',
    html: () => {
        let h = `<h1>${i18n('security')}</h1>`;
        let user = window.user;

        // change password button
        if ( ! user.is_temp ) {
            h += '<div class="settings-card">';
            h += `<strong>${i18n('password')}</strong>`;
            h += '<div style="flex-grow:1;">';
            h += `<button class="button change-password" style="float:right;">${i18n('change_password')}</button>`;
            h += '</div>';
            h += '</div>';
        }

        // session manager
        h += '<div class="settings-card">';
        h += `<strong>${i18n('sessions')}</strong>`;
        h += '<div style="flex-grow:1;">';
        h += `<button class="button manage-sessions" style="float:right;">${i18n('manage_sessions')}</button>`;
        h += '</div>';
        h += '</div>';

        // configure 2FA
        if ( !user.is_temp && user.email_confirmed ) {
            h += `<div class="settings-card settings-card-security ${user.otp ? 'settings-card-success' : 'settings-card-warning'}">`;
            h += '<div>';
            h += `<strong style="display:block;">${i18n('two_factor')}</strong>`;
            h += `<span class="user-otp-state" style="display:block; margin-top:5px;">${
                i18n(user.otp ? 'two_factor_enabled' : 'two_factor_disabled')
            }</span>`;
            h += '</div>';
            h += '<div style="flex-grow:1;">';
            h += `<button class="button enable-2fa" style="float:right;${user.otp ? 'display:none;' : ''}">${i18n('enable_2fa')}</button>`;
            h += `<button class="button disable-2fa" style="float:right;${user.otp ? '' : 'display:none;'}">${i18n('disable_2fa')}</button>`;
            h += '</div>';
            h += '</div>';
        }

        return h;
    },
    init: ($el_window) => {
        $el_window.find('.enable-2fa').on('click', async function (e) {

            const { promise } = await UIWindow2FASetup();
            const tfa_was_enabled = await promise;

            if ( tfa_was_enabled ) {
                $el_window.find('.enable-2fa').hide();
                $el_window.find('.disable-2fa').show();
                $el_window.find('.user-otp-state').text(i18n('two_factor_enabled'));
                $el_window.find('.settings-card-security').removeClass('settings-card-warning');
                $el_window.find('.settings-card-security').addClass('settings-card-success');
            }

            return;
        });

        $el_window.find('.disable-2fa').on('click', async function (e) {
            const { promise } = await UIWindowDisable2FA();
            const tfa_was_disabled = await promise;

            if ( tfa_was_disabled ) {
                $el_window.find('.enable-2fa').show();
                $el_window.find('.disable-2fa').hide();
                $el_window.find('.user-otp-state').text(i18n('two_factor_disabled'));
                $el_window.find('.settings-card-security').removeClass('settings-card-success');
                $el_window.find('.settings-card-security').addClass('settings-card-warning');
            }
        });
    },
};
