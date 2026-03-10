/**
 * Copyright (C) 2026-present Puter Technologies Inc.
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
import Placeholder from '../../util/Placeholder.js';
import TeePromise from '../../util/TeePromise.js';
import PasswordEntry from '../Components/PasswordEntry.js';
import UIWindow from '../UIWindow.js';

async function UIWindowDisable2FA (options) {
    options = options ?? {};

    const promise = new TeePromise();
    let disabled_successfully = false;

    const password_entry = new PasswordEntry({});
    const place_password_entry = Placeholder();

    const internal_id = window.uuidv4();
    let h = '';
    h += '<div class="disable-2fa" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
    h += '<div class="form-error-msg"></div>';
    h += '<div class="form-success-msg"></div>';
    h += '<div style="overflow: hidden; margin-top: 10px; margin-bottom: 20px;">';
    h += `<p style="margin:0;font-size:14px;color:#333;">${i18n('disable_2fa_instructions')}</p>`;
    h += '</div>';
    h += '<div class="disable-2fa-auth-row" style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">';
    h += '<div class="disable-2fa-password-wrap">';
    h += `<label>${i18n('account_password')}</label>`;
    h += `${place_password_entry.html}`;
    h += '</div>';
    h += '<div class="disable-2fa-oidc-wrap" style="display:none;">';
    h += '<p class="disable-2fa-oidc-flow-notice" style="margin:0;font-size:12px;color:#666;"></p>';
    h += '<span class="disable-2fa-revalidated-msg" style="display:none;"></span>';
    h += '</div>';
    h += '<p class="disable-2fa-oidc-hint" style="margin-top:6px;font-size:12px;color:#666;display:none;"></p>';
    h += '</div>';
    h += `<button class="disable-2fa-btn button button-primary button-block button-normal">${i18n('disable_2fa')}</button>`;
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('disable_2fa'),
        app: 'disable-2fa',
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
        on_before_exit: async () => {
            if ( ! disabled_successfully ) {
                promise.resolve(false);
            }
            return true;
        },
        onAppend: function (this_window) {
            $(this_window).find('.disable-2fa-password-wrap input').get(0)?.focus({ preventScroll: true });
            const oidc_only = !!(window.user && window.user.oidc_only);
            const authRow = $(this_window).find('.disable-2fa-auth-row');
            if ( oidc_only ) {
                authRow.find('.disable-2fa-password-wrap').hide();
                const oidcWrap = authRow.find('.disable-2fa-oidc-wrap').show();
                oidcWrap.find('.disable-2fa-oidc-flow-notice').text(
                    i18n('revalidate_flow_notice') ||
                    'You will be asked to sign in with your linked account when you continue.',
                );
            } else {
                authRow.find('.disable-2fa-oidc-wrap').hide();
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

    password_entry.attach(place_password_entry);

    const origin = window.gui_origin || window.api_origin || '';
    const apiUrl = `${origin}/user-protected/disable-2fa`;
    let revalidated = false;

    const hint = $(el_window).find('.disable-2fa-oidc-hint');
    const REVALIDATE_POPUP_TEXT = i18n('revalidate_sign_in_popup') || 'Sign in with your linked account in the popup.';

    const myOpenRevalidatePopup = async (revalidateUrl) => {
        revalidateUrl = revalidateUrl || (window.user && window.user.oidc_revalidate_url);
        $(el_window).find('.disable-2fa-btn').addClass('disabled');
        hint.text(REVALIDATE_POPUP_TEXT).show();
        try {
            await openRevalidatePopup(revalidateUrl);
        } catch (e) {
            onError(e.message || 'Authentication failed');
            return;
        } finally {
            hint.hide();
        }
        $(el_window).find('.disable-2fa-revalidated-msg').text(i18n('revalidated') || 'Re-validated.').show();
    };

    $(el_window).find('.disable-2fa-btn').on('click', async function (e) {
        $(el_window).find('.form-success-msg, .form-error-msg').hide();

        const password = password_entry.get('value');
        const oidc_only = !!(window.user && window.user.oidc_only);

        if ( !oidc_only && !password ) {
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }

        if ( oidc_only && !revalidated && !password ) {
            await myOpenRevalidatePopup();

            const res = await doSubmit({ password: undefined });
            const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
            if ( res.ok ) onSuccess();
            else onError(data.message || 'Request failed');
            return;
        }
        $(el_window).find('.form-error-msg').hide();
        $(el_window).find('.disable-2fa-btn').addClass('disabled');
        $(el_window).find('.disable-2fa-password-wrap input').attr('disabled', true);

        let res = await doSubmit({ password });
        const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));

        if ( res.ok ) {
            onSuccess();
            return;
        }
        if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
            await myOpenRevalidatePopup(data.revalidate_url);
            const r = await doSubmit({ password: undefined });
            if ( r.ok ) onSuccess();
            else r.json().then((d) => onError(d.message || 'Request failed')).catch(() => onError('Request failed'));
            return;
        }
        onError(data.message || 'Request failed');
    });

    function doSubmit ({ password }) {
        return fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: password !== undefined && password !== '' ? password : undefined,
            }),
        });
    }

    function onError (message) {
        $(el_window).find('.form-error-msg').html(html_encode(message));
        $(el_window).find('.form-error-msg').fadeIn();
        $(el_window).find('.disable-2fa-btn').removeClass('disabled');
        $(el_window).find('.disable-2fa-password-wrap input').attr('disabled', false);
    }

    function onSuccess () {
        disabled_successfully = true;
        $(el_window).find('.form-success-msg').html(i18n('two_factor_disabled'));
        $(el_window).find('.form-success-msg').fadeIn();
        if ( window.user ) window.user.otp = false;
        $(el_window).find('.disable-2fa-btn').removeClass('disabled');
        $(el_window).find('.disable-2fa-password-wrap input').attr('disabled', false);
        promise.resolve(true);
        $(el_window).close();
    }

    return { promise };
}

export default UIWindowDisable2FA;
