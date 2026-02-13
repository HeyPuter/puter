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
import TeePromise from '../../util/TeePromise.js';
import UIComponentWindow from '../UIComponentWindow.js';
import UIWindow2FASetup from '../UIWindow2FASetup.js';

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
            let win;
            const password_confirm_promise = new TeePromise();

            function openRevalidatePopup ($win, revalidateUrl, onDone) {
                const url = revalidateUrl || (window.user && window.user.oidc_revalidate_url);
                if ( ! url ) {
                    onDone && onDone(new Error('No revalidate URL'));
                    return null;
                }
                let doneCalled = false;
                const hint = $win.find('.disable-2fa-oidc-hint');
                hint.text(i18n('revalidate_sign_in_popup') || 'Sign in with your linked account in the popup.').show();
                const popup = window.open(url, 'puter-revalidate', 'width=500,height=600');
                const onMessage = (ev) => {
                    if ( (ev.origin !== window.gui_origin) && (ev.origin !== window.location.origin) ) return;
                    if ( !ev.data || ev.data.type !== 'puter-revalidate-done' ) return;
                    if ( doneCalled ) return;
                    doneCalled = true;
                    window.removeEventListener('message', onMessage);
                    hint.hide();
                    onDone && onDone();
                };
                window.addEventListener('message', onMessage);
                const checkClosed = setInterval(() => {
                    if ( popup && popup.closed ) {
                        clearInterval(checkClosed);
                        window.removeEventListener('message', onMessage);
                        hint.hide();
                        if ( ! doneCalled ) {
                            doneCalled = true;
                            onDone && onDone(new Error('Popup closed'));
                        }
                    }
                }, 300);
                return popup;
            }

            const doRequest = () => fetch(`${window.api_origin}/user-protected/disable-2fa`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: win ? $(win).find('.password-entry').val() : '',
                }),
            });

            const try_password = async () => {
                const resp = await doRequest();
                if ( resp.status === 200 ) {
                    password_confirm_promise.resolve(true);
                    $(win).close();
                    return;
                }
                const data = await resp.json().catch(() => ({}));
                const $win = $(win);
                if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
                    openRevalidatePopup($win, data.revalidate_url, async (err) => {
                        if ( err ) {
                            $win.find('.error-message').text(err.message || 'Re-validation required.').show();
                            return;
                        }
                        const r2 = await doRequest();
                        if ( r2.status === 200 ) {
                            password_confirm_promise.resolve(true);
                            $(win).close();
                        } else {
                            let message; try {
                                message = (await r2.json()).message;
                            } catch (e) {
                            }
                            $win.find('.error-message').text(message || i18n('error_unknown_cause')).show();
                        }
                    });
                    return;
                }
                $win.find('.password-entry').addClass('error');
                $win.find('.error-message').text(data.message || i18n('error_unknown_cause')).show();
            };

            const oidc_only = !!(window.user && window.user.oidc_only);
            let h = '';
            h += '<div style="display: flex; flex-direction: column; gap: 20pt; justify-content: center;">';
            h += '<div>';
            h += `<h3 style="text-align:center; font-weight: 500; font-size: 20px;">${i18n('disable_2fa_confirm')}</h3>`;
            h += `<p style="text-align:center; padding: 0 20px;">${i18n('disable_2fa_instructions')}</p>`;
            if ( oidc_only ) {
                h += `<p class="disable-2fa-oidc-flow-notice" style="text-align:center; padding: 0 20px; margin: 8px 0 0; font-size: 12px; color: #666;">${i18n('revalidate_flow_notice')}</p>`;
            }
            h += '</div>';
            h += '<div style="display: flex; flex-direction: column; gap: 10pt;">';
            h += '<input type="password" class="password-entry" />';
            h += '<p class="disable-2fa-oidc-hint" style="margin:0;font-size:12px;color:#666;display:none;"></p>';
            h += '<span class="error-message" style="color: red; display: none;"></span>';
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
                    'background-color': 'rgb(245 247 249)',
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

            $el_window.find('.enable-2fa').show();
            $el_window.find('.disable-2fa').hide();
            $el_window.find('.user-otp-state').text(i18n('two_factor_disabled'));
            $el_window.find('.settings-card-security').removeClass('settings-card-success');
            $el_window.find('.settings-card-security').addClass('settings-card-warning');
        });
    },
};
