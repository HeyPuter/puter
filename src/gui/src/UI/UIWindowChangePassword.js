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

import check_password_strength from '../helpers/check_password_strength.js';
import { openRevalidatePopup } from '../util/openid.js';
import UIWindow from './UIWindow.js';

async function UIWindowChangePassword (options) {
    options = options ?? {};

    const internal_id = window.uuidv4();
    let h = '';
    h += '<div class="change-password" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
    // error msg
    h += '<div class="form-error-msg"></div>';
    // success msg
    h += '<div class="form-success-msg"></div>';
    // current password / OIDC revalidate
    h += '<div class="change-password-auth-row" style="overflow: hidden; margin-bottom: 20px;">';
    h += '<div class="change-password-current-wrap">';
    h += `<label for="current-password-${internal_id}">${i18n('current_password')}</label>`;
    h += `<input id="current-password-${internal_id}" class="current-password" type="password" name="current-password" autocomplete="current-password" />`;
    h += '</div>';
    h += '<div class="change-password-oidc-wrap" style="display:none;">';
    h += '<p class="change-password-oidc-flow-notice" style="margin:0;font-size:12px;color:#666;"></p>';
    h += '<span class="change-password-revalidated-msg" style="display:none;"></span>';
    h += '</div>';
    h += '</div>';
    // new password
    h += '<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">';
    h += `<label for="new-password-${internal_id}">${i18n('new_password')}</label>`;
    h += `<input id="new-password-${internal_id}" type="password" class="new-password" name="new-password" autocomplete="off" />`;
    h += '</div>';
    // confirm new password
    h += '<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">';
    h += `<label for="confirm-new-password-${internal_id}">${i18n('confirm_new_password')}</label>`;
    h += `<input id="confirm-new-password-${internal_id}" type="password" name="confirm-new-password" class="confirm-new-password" autocomplete="off" />`;
    h += '</div>';
    h += '<p class="change-password-oidc-hint" style="margin-top:6px;font-size:12px;color:#666;display:none;"></p>';

    // Change Password
    h += `<button class="change-password-btn button button-primary button-block button-normal">${i18n('change_password')}</button>`;
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('window_title_change_password'),
        app: 'change-passowrd',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: false,
        width: 350,
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        onAppend: function (this_window) {
            $(this_window).find('.current-password').get(0)?.focus({ preventScroll: true });
            const oidc_only = !!(window.user && window.user.oidc_only);
            const authRow = $(this_window).find('.change-password-auth-row');
            if ( oidc_only ) {
                authRow.find('.change-password-current-wrap').hide();
                const oidcWrap = authRow.find('.change-password-oidc-wrap').show();
                oidcWrap.find('.change-password-oidc-flow-notice').text(
                    i18n('revalidate_flow_notice') ||
                    'You will be asked to sign in with your linked account when you continue.',
                );
            } else {
                authRow.find('.change-password-oidc-wrap').hide();
            }
        },
        window_class: 'window-publishWebsite',
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        },
        ...options.window_options,
    });

    const origin = window.gui_origin || window.api_origin || '';
    const apiUrl = `${origin}/user-protected/change-password`;
    let revalidated = false;

    const hint = $(el_window).find('.change-password-oidc-hint');
    const REVALIDATE_POPUP_TEXT = i18n('revalidate_sign_in_popup') || 'Sign in with your linked account in the popup.';

    const myOpenRevalidatePopup = async (revalidateUrl) => {
        revalidateUrl = revalidateUrl || (window.user && window.user.oidc_revalidate_url);
        $(el_window).find('.change-password-btn').addClass('disabled');
        hint.text(REVALIDATE_POPUP_TEXT).show();
        try {
            await openRevalidatePopup(revalidateUrl);
        } catch (e) {
            onError(e.message || 'Authentication failed');
            return;
        } finally {
            hint.hide();
        }
        $(el_window).find('.change-password-revalidated-msg').text(i18n('revalidated') || 'Re-validated.').show();
    };

    $(el_window).find('.change-password-btn').on('click', async function (e) {
        const current_password = $(el_window).find('.current-password').val();
        const new_password = $(el_window).find('.new-password').val();
        const confirm_new_password = $(el_window).find('.confirm-new-password').val();
        const oidc_only = !!(window.user && window.user.oidc_only);

        $(el_window).find('.form-success-msg, .form-error-msg').hide();

        if ( !new_password || !confirm_new_password ) {
            $(el_window).find('.form-error-msg').html('All fields are required.');
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        // For password users, current password is required; for OIDC, we need revalidated or will open popup
        if ( !oidc_only && !current_password ) {
            $(el_window).find('.form-error-msg').html('All fields are required.');
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        if ( new_password !== confirm_new_password ) {
            $(el_window).find('.form-error-msg').html(i18n('passwords_do_not_match'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        const pass_strength = check_password_strength(new_password);
        if ( ! pass_strength.overallPass ) {
            $(el_window).find('.form-error-msg').html(i18n('password_strength_error'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }

        if ( oidc_only && !revalidated && !current_password ) {
            await myOpenRevalidatePopup();

            const res = await doSubmit({ new_password });
            const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
            if ( res.ok ) onSuccess();
            else onError(data.message || 'Request failed');
            return;
        }

        $(el_window).find('.form-error-msg').hide();
        $(el_window).find('.change-password-btn').addClass('disabled');
        $(el_window).find('.current-password, .new-password, .confirm-new-password').attr('disabled', true);

        let res = await doSubmit({ current_password, new_password });
        const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));

        if ( res.ok ) {
            onSuccess();
            return;
        }
        if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
            await myOpenRevalidatePopup(data.revalidate_url);
            const r = await doSubmit();
            if ( r.ok ) onSuccess();
            else r.json().then((d) => onError(d.message || 'Request failed')).catch(() => onError('Request failed'));
            return;
        }
        onError(data.message || res.statusText || 'Request failed');
    });

    // function openRevalidatePopup (revalidateUrl, onDone) {
    //     const url = revalidateUrl || (window.user && window.user.oidc_revalidate_url);
    //     if ( ! url ) {
    //         onDone && onDone(new Error('No revalidate URL'));
    //         return null;
    //     }
    //     let doneCalled = false;
    //     const hint = $(el_window).find('.change-password-oidc-hint');
    //     hint.text(i18n('revalidate_sign_in_popup') || 'Sign in with your linked account in the popup.').show();
    //     const popup = window.open(url, 'puter-revalidate', 'width=500,height=600');
    //     const onMessage = (ev) => {
    //         if ( (ev.origin !== window.gui_origin) && (ev.origin !== window.location.origin) ) return;
    //         if ( !ev.data || ev.data.type !== 'puter-revalidate-done' ) return;
    //         if ( doneCalled ) return;
    //         doneCalled = true;
    //         window.removeEventListener('message', onMessage);
    //         revalidated = true;
    //         hint.hide();
    //         $(el_window).find('.change-password-revalidated-msg').text(i18n('revalidated') || 'Re-validated.').show();
    //         $(el_window).find('.change-password-revalidate-btn').hide();
    //         onDone && onDone();
    //     };
    //     window.addEventListener('message', onMessage);
    //     const checkClosed = setInterval(() => {
    //         if ( popup && popup.closed ) {
    //             clearInterval(checkClosed);
    //             window.removeEventListener('message', onMessage);
    //             hint.hide();
    //             if ( ! doneCalled ) {
    //                 doneCalled = true;
    //                 onDone && onDone(new Error('Popup closed'));
    //             }
    //         }
    //     }, 300);
    //     return popup;
    // }
    function doSubmit ({ new_password, current_password }) {
        return fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: current_password,
                new_pass: new_password,
            }),
        });
    }

    function onError (message) {
        $(el_window).find('.form-error-msg').html(html_encode(message));
        $(el_window).find('.form-error-msg').fadeIn();
        $(el_window).find('.change-password-btn').removeClass('disabled');
        $(el_window).find('.current-password, .new-password, .confirm-new-password').attr('disabled', false);
    }

    function onSuccess () {
        $(el_window).find('.form-success-msg').html(i18n('password_changed'));
        $(el_window).find('.form-success-msg').fadeIn();
        $(el_window).find('input').val('');
        $(el_window).find('.change-password-btn').removeClass('disabled');
        $(el_window).find('.current-password, .new-password, .confirm-new-password').attr('disabled', false);
    }
}

export default UIWindowChangePassword;