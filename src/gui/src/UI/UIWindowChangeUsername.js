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

import update_username_in_gui from '../helpers/update_username_in_gui.js';
import UIWindow from './UIWindow.js';

async function UIWindowChangeUsername (options) {
    options = options ?? {};

    const internal_id = window.uuidv4();
    let h = '';
    h += '<div class="change-username" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
    h += '<div class="form-error-msg"></div>';
    h += '<div class="form-success-msg"></div>';
    h += '<div style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">';
    h += `<label for="confirm-new-username-${internal_id}">${i18n('new_username')}</label>`;
    h += `<input id="confirm-new-username-${internal_id}" type="text" name="new-username" class="new-username" autocomplete="off" />`;
    h += '</div>';
    h += '<div class="change-username-auth-row" style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">';
    h += `<label for="change-username-password-${internal_id}">${i18n('account_password')}</label>`;
    h += '<div class="change-username-password-wrap">';
    h += `<input id="change-username-password-${internal_id}" type="password" name="password" class="change-username-password" autocomplete="current-password" placeholder="" />`;
    h += '</div>';
    h += '<div class="change-username-oidc-wrap" style="display:none;">';
    h += '<button type="button" class="button change-username-revalidate-btn"></button>';
    h += '<span class="change-username-revalidated-msg" style="display:none;"></span>';
    h += '</div>';
    h += '<p class="change-username-oidc-hint" style="margin-top:6px;font-size:12px;color:#666;display:none;"></p>';
    h += '</div>';
    h += `<button class="change-username-btn button button-primary button-block button-normal">${i18n('change_username')}</button>`;
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('change_username'),
        app: 'change-username',
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
            $(this_window).find('.new-username').get(0)?.focus({ preventScroll: true });
            const oidc_only = !!(window.user && window.user.oidc_only);
            const authRow = $(this_window).find('.change-username-auth-row');
            if ( oidc_only ) {
                authRow.find('.change-username-password-wrap').hide();
                const oidcWrap = authRow.find('.change-username-oidc-wrap').show();
                oidcWrap.find('.change-username-revalidate-btn').text(i18n('revalidate_with_google') || 'Re-validate with Google');
            } else {
                authRow.find('.change-username-oidc-wrap').hide();
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
    const apiUrl = `${origin}/user-protected/change-username`;
    let revalidated = false;

    $(el_window).find('.change-username-btn').on('click', async function (e) {
        $(el_window).find('.form-success-msg, .form-error-msg').hide();
        const new_username = $(el_window).find('.new-username').val();
        const password = $(el_window).find('.change-username-password').val();
        const oidc_only = !!(window.user && window.user.oidc_only);

        if ( ! new_username ) {
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }
        if ( oidc_only && !revalidated && !password ) {
            $(el_window).find('.change-username-btn').addClass('disabled');
            openRevalidatePopup(null, async (err) => {
                if ( err ) {
                    onError(err.message || 'Re-validation required.');
                    return;
                }
                const res = await doSubmit();
                const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
                if ( res.ok ) onSuccess();
                else onError(data.message || 'Request failed');
            });
            return;
        }
        $(el_window).find('.form-error-msg').hide();
        $(el_window).find('.change-username-btn').addClass('disabled');
        $(el_window).find('.new-username, .change-username-password').attr('disabled', true);

        let res = await doSubmit(password);
        const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));

        if ( res.ok ) {
            onSuccess();
            return;
        }
        if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
            openRevalidatePopup(data.revalidate_url, async () => {
                const r = await doSubmit();
                if ( r.ok ) onSuccess();
                else r.json().then((d) => onError(d.message || 'Request failed')).catch(() => onError('Request failed'));
            });
            return;
        }
        onError(data.message || 'Request failed');
    });

    function openRevalidatePopup (revalidateUrl, onDone) {
        const url = revalidateUrl || (window.user && window.user.oidc_revalidate_url);
        if ( ! url ) {
            onDone && onDone(new Error('No revalidate URL'));
            return null;
        }
        let doneCalled = false;
        const hint = $(el_window).find('.change-username-oidc-hint');
        hint.text(i18n('revalidate_sign_in_popup') || 'Sign in with your linked account in the popup.').show();
        const popup = window.open(url, 'puter-revalidate', 'width=500,height=600');
        const onMessage = (ev) => {
            if ( (ev.origin !== window.gui_origin) && (ev.origin !== window.location.origin) ) return;
            if ( !ev.data || ev.data.type !== 'puter-revalidate-done' ) return;
            if ( doneCalled ) return;
            doneCalled = true;
            window.removeEventListener('message', onMessage);
            revalidated = true;
            hint.hide();
            $(el_window).find('.change-username-revalidated-msg').text(i18n('revalidated') || 'Re-validated.').show();
            $(el_window).find('.change-username-revalidate-btn').hide();
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

    $(el_window).find('.change-username-revalidate-btn').on('click', function () {
        openRevalidatePopup();
    });

    function doSubmit (password) {
        const new_username = $(el_window).find('.new-username').val();
        const body = { new_username };
        if ( password !== undefined && password !== '' ) body.password = password;
        // Do not send Authorization: user-protected endpoints use session cookie (hasHttpPowers)
        return fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }

    function onSuccess () {
        const new_username = $(el_window).find('.new-username').val();
        $(el_window).find('.form-success-msg').html(i18n('username_changed'));
        $(el_window).find('.form-success-msg').fadeIn();
        $(el_window).find('input').val('');
        update_username_in_gui(new_username);
        window.user.username = new_username;
        $(el_window).find('.change-username-btn').removeClass('disabled');
        $(el_window).find('.new-username, .change-username-password').attr('disabled', false);
    }

    function onError (message) {
        $(el_window).find('.form-error-msg').html(html_encode(message));
        $(el_window).find('.form-error-msg').fadeIn();
        $(el_window).find('.change-username-btn').removeClass('disabled');
        $(el_window).find('.new-username, .change-username-password').attr('disabled', false);
    }
}

export default UIWindowChangeUsername;