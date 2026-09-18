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

import { openRevalidatePopup } from '../../util/openid.js';
import { fetchWithSessionCookieRetry, isSessionAuthError } from '../../util/sessionAuth.js';
import UIWindow from '../UIWindow.js';

async function UIWindowFinalizeUserDeletion (options) {
    return new Promise(async (resolve) => {
        options = options ?? {};
        const oidc_only = !!(window.user && window.user.oidc_only);

        let h = '';

        // if user is temporary, ask them to type in 'confirm' to delete their account
        if ( window.user.is_temp ) {
            h += '<div style="padding: 20px;">';
            h += '<div class="generic-close-window-button disable-user-select"> &times; </div>';
            h += `<img src="${window.icons['danger.svg']}"  class="account-deletion-confirmation-icon">`;
            h += `<p class="account-deletion-confirmation-prompt">${i18n('type_confirm_to_delete_account')}</p>`;
            // error message
            h += '<div class="error-message"></div>';
            // input field
            h += `<input type="text" class="confirm-temporary-user-deletion" placeholder="${i18n('type_confirm_to_delete_account')}">`;
            h += `<button class="button button-block button-danger proceed-with-user-deletion">${i18n('delete_account')}</button>`;
            h += `<button class="button button-block button-secondary cancel-user-deletion">${i18n('cancel')}</button>`;
            h += '</div>';
        }
        // OIDC-only: revalidate via popup (no password)
        else if ( oidc_only ) {
            h += '<div style="padding: 20px;">';
            h += '<div class="generic-close-window-button disable-user-select"> &times; </div>';
            h += `<img src="${window.icons['danger.svg']}" class="account-deletion-confirmation-icon">`;
            h += `<p class="account-deletion-confirmation-prompt">${i18n('confirm_delete_user')}</p>`;
            h += '<div class="delete-oidc-wrap" style="margin-top:10px;">';
            h += '<p class="delete-oidc-flow-notice" style="margin:0;font-size:12px;color:#666;"></p>';
            h += '<span class="delete-revalidated-msg" style="display:none;"></span>';
            h += '</div>';
            h += '<p class="delete-oidc-hint" style="margin-top:6px;font-size:12px;color:#666;display:none;"></p>';
            h += '<div class="error-message"></div>';
            h += `<button class="button button-block button-danger proceed-with-user-deletion">${i18n('delete_account')}</button>`;
            h += `<button class="button button-block button-secondary cancel-user-deletion">${i18n('cancel')}</button>`;
            h += '</div>';
        }
        // otherwise ask for password
        else {
            h += '<div style="padding: 20px;">';
            h += '<div class="generic-close-window-button disable-user-select"> &times; </div>';
            h += `<img src="${window.icons['danger.svg']}" class="account-deletion-confirmation-icon">`;
            h += `<p class="account-deletion-confirmation-prompt">${i18n('enter_password_to_confirm_delete_user')}</p>`;
            // error message
            h += '<div class="error-message"></div>';
            // input field
            h += `<input type="password" class="confirm-user-deletion-password" placeholder="${i18n('current_password')}">`;
            h += `<button class="button button-block button-danger proceed-with-user-deletion">${i18n('delete_account')}</button>`;
            h += `<button class="button button-block button-secondary cancel-user-deletion">${i18n('cancel')}</button>`;
            h += '</div>';
        }

        const el_window = await UIWindow({
            title: i18n('confirm_delete_user_title'),
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: true,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: true,
            onAppend: function (el_window) {
                if ( oidc_only ) {
                    $(el_window).find('.delete-oidc-flow-notice').text(
                        i18n('revalidate_flow_notice') ||
                        'You will be asked to sign in with your linked account when you continue.',
                    );
                }
            },
            width: 500,
            dominant: false,
            window_css: {
                height: 'initial',
                padding: '0',
                border: 'none',
                boxShadow: '0 0 10px rgba(0,0,0,.2)',
            },
        });

        $(el_window).find('.generic-close-window-button').on('click', function () {
            $(el_window).close();
        });

        $(el_window).find('.cancel-user-deletion').on('click', function () {
            $(el_window).close();
        });

        const origin = window.gui_origin || window.api_origin || '';
        const apiUrl = `${origin}/user-protected/delete-own-user`;
        const REVALIDATE_POPUP_TEXT = i18n('revalidate_sign_in_popup') || 'Sign in with your linked account in the popup.';
        let revalidated = false;

        // Do not send Authorization: user-protected endpoints use session cookie (hasHttpOnlyCookie).
        // On a 401 caused by a missing/bad cookie the wrapper mints the cookie
        // from the GUI bearer token via /session/sync-cookie and retries once.
        const doDeleteRequest = async (body = {}) => {
            const send = () => fetch(apiUrl, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            return fetchWithSessionCookieRetry(send, { origin, authToken: window.auth_token });
        };

        const showError = (msg) => {
            $(el_window).find('.error-message').html(html_encode(msg)).show();
        };

        // Session cookie is absent and couldn't be minted from the bearer
        // token. Don't hard-logout — that drops the window and looks like the
        // deletion went through. Prompt sign-in so the cookie gets set and the
        // user can decide again.
        const onReauthRequired = (data) => {
            showError(i18n('reauth_required_message'));
            $(el_window).find('.proceed-with-user-deletion').removeClass('disabled');
            window.handleReauthRequired({ reason: data.reason, auth_id: data.auth_id });
        };

        $(el_window).find('.proceed-with-user-deletion').on('click', async function () {
            $(el_window).find('.error-message').hide();
            // if user is temporary, check if they typed 'confirm'
            if ( window.user.is_temp ) {
                const confirm = $(el_window).find('.confirm-temporary-user-deletion').val().toLowerCase();

                // user must type 'confirm' or the translation of 'confirm' to delete their account
                if ( confirm !== 'confirm' && confirm !== i18n('confirm').toLowerCase() ) {
                    showError(i18n('type_confirm_to_delete_account', [], false));
                    return;
                }
            } else if ( oidc_only && !revalidated ) {
                $(el_window).find('.proceed-with-user-deletion').addClass('disabled');
                $(el_window).find('.delete-oidc-hint').text(REVALIDATE_POPUP_TEXT).show();
                try {
                    const revalidateUrl = window.user && window.user.oidc_revalidate_url;
                    await openRevalidatePopup(revalidateUrl);
                } catch (e) {
                    showError(e.message || 'Authentication failed');
                    $(el_window).find('.proceed-with-user-deletion').removeClass('disabled');
                    $(el_window).find('.delete-oidc-hint').hide();
                    return;
                }
                $(el_window).find('.delete-oidc-hint').hide();
                $(el_window).find('.delete-revalidated-msg').text(i18n('revalidated') || 'Re-validated.').show();
                revalidated = true;
                $(el_window).find('.proceed-with-user-deletion').removeClass('disabled');
                const res = await doDeleteRequest({});
                const data = await res.json().catch(() => ({}));
                if ( isSessionAuthError(res, data) ) {
                    onReauthRequired(data); return;
                }
                if ( res.ok && data.success ) {
                    window.user.deleted = true; window.logout(); return;
                }
                if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
                    try {
                        await openRevalidatePopup(data.revalidate_url);
                    } catch (e) {
                        showError(e.message || 'Authentication failed');
                        return;
                    }
                    const retry = await doDeleteRequest({});
                    const retryData = await retry.json().catch(() => ({}));
                    if ( retry.ok && retryData.success ) {
                        window.user.deleted = true; window.logout(); return;
                    }
                    if ( isSessionAuthError(retry, retryData) ) {
                        onReauthRequired(retryData); return;
                    }
                    showError(retryData.message || 'Request failed');
                    return;
                }
                showError(data.message || 'Request failed');
                return;
            } else if ( !window.user.is_temp && !oidc_only ) {
                const password = $(el_window).find('.confirm-user-deletion-password').val();
                if ( password === '' ) {
                    showError(i18n('all_fields_required', [], false));
                    return;
                }
            }

            let res = await doDeleteRequest(
                window.user.is_temp ? {} : { password: $(el_window).find('.confirm-user-deletion-password').val() || undefined },
            );
            const data = await res.json().catch(() => ({}));

            if ( isSessionAuthError(res, data) ) {
                onReauthRequired(data);
                return;
            }
            if ( res.ok && data.success ) {
                window.user.deleted = true;
                window.logout();
                return;
            }
            if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
                $(el_window).find('.proceed-with-user-deletion').addClass('disabled');
                $(el_window).find('.delete-oidc-hint').text(REVALIDATE_POPUP_TEXT).show();
                try {
                    await openRevalidatePopup(data.revalidate_url);
                } catch (e) {
                    showError(e.message || 'Authentication failed');
                    $(el_window).find('.proceed-with-user-deletion').removeClass('disabled');
                    $(el_window).find('.delete-oidc-hint').hide();
                    return;
                }
                $(el_window).find('.delete-oidc-hint').hide();
                $(el_window).find('.proceed-with-user-deletion').removeClass('disabled');
                const retry = await doDeleteRequest({});
                const retryData = await retry.json().catch(() => ({}));
                if ( retry.ok && retryData.success ) {
                    window.user.deleted = true;
                    window.logout();
                    return;
                }
                if ( isSessionAuthError(retry, retryData) ) {
                    onReauthRequired(retryData);
                    return;
                }
                showError(retryData.message || 'Request failed');
                return;
            }
            showError(data.message || 'Request failed');
        });
    });
}

export default UIWindowFinalizeUserDeletion;