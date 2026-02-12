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

import Placeholder from '../../util/Placeholder.js';
import PasswordEntry from '../Components/PasswordEntry.js';
import UIWindow from '../UIWindow.js';

// TODO: DRY: We could specify a validator and endpoint instead of writing
// a DOM tree and event handlers for each of these. (low priority)
async function UIWindowChangeEmail (options) {
    options = options ?? {};

    const password_entry = new PasswordEntry({});
    const place_password_entry = Placeholder();

    const internal_id = window.uuidv4();
    let h = '';
    h += '<div class="change-email" style="padding: 20px; border-bottom: 1px solid #ced7e1;">';
    // error msg
    h += '<div class="form-error-msg"></div>';
    // success msg
    h += '<div class="form-success-msg"></div>';
    // new email
    h += '<div style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">';
    h += `<label for="confirm-new-email-${internal_id}">${i18n('new_email')}</label>`;
    h += `<input id="confirm-new-email-${internal_id}" type="text" name="new-email" class="new-email" autocomplete="off" />`;
    h += '</div>';
    // password / OIDC revalidate
    h += '<div class="change-email-auth-row" style="overflow: hidden; margin-top: 10px; margin-bottom: 30px;">';
    h += '<div class="change-email-password-wrap">';
    h += `<label>${i18n('account_password')}</label>`;
    h += `${place_password_entry.html}`;
    h += '</div>';
    h += '<div class="change-email-oidc-wrap" style="display:none;">';
    h += '<button type="button" class="button change-email-revalidate-btn"></button>';
    h += '<span class="change-email-revalidated-msg" style="display:none;"></span>';
    h += '</div>';
    h += '<p class="change-email-oidc-hint" style="margin-top:6px;font-size:12px;color:#666;display:none;"></p>';
    h += '</div>';

    // Change Email
    h += `<button class="change-email-btn button button-primary button-block button-normal">${i18n('change_email')}</button>`;
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('change_email'),
        app: 'change-email',
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
            $(this_window).find('.new-email').get(0)?.focus({ preventScroll: true });
            const oidc_only = !!(window.user && window.user.oidc_only);
            const authRow = $(this_window).find('.change-email-auth-row');
            if ( oidc_only ) {
                authRow.find('.change-email-password-wrap').hide();
                const oidcWrap = authRow.find('.change-email-oidc-wrap').show();
                oidcWrap.find('.change-email-revalidate-btn').text(i18n('revalidate_with_google') || 'Re-validate with Google');
            } else {
                authRow.find('.change-email-oidc-wrap').hide();
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
    const apiUrl = `${origin}/user-protected/change-email`;
    let revalidated = false;

    $(el_window).find('.change-email-btn').on('click', async function (e) {
        $(el_window).find('.form-success-msg, .form-error-msg').hide();

        const new_email = $(el_window).find('.new-email').val();
        const password = password_entry.get('value');
        const oidc_only = !!(window.user && window.user.oidc_only);

        if ( ! new_email ) {
            $(el_window).find('.form-error-msg').html(i18n('all_fields_required'));
            $(el_window).find('.form-error-msg').fadeIn();
            return;
        }

        $(el_window).find('.form-error-msg').hide();
        $(el_window).find('.change-email-btn').addClass('disabled');
        $(el_window).find('.new-email').attr('disabled', true);

        const doSubmit = () => fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                new_email,
                password: password !== undefined && password !== '' ? password : undefined,
            }),
        });

        if ( oidc_only && !revalidated && !password ) {
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

        let res = await doSubmit();
        const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));

        if ( res.ok ) {
            onSuccess();
            return;
        }
        if ( data.code === 'oidc_revalidation_required' && data.revalidate_url ) {
            openRevalidatePopup(data.revalidate_url, async (err) => {
                if ( err ) {
                    onError(err.message || 'Re-validation required.');
                    return;
                }
                const r2 = await doSubmit();
                const d2 = r2.ok ? await r2.json().catch(() => ({})) : await r2.json().catch(() => ({}));
                if ( r2.ok ) onSuccess();
                else onError(d2.message || 'Request failed');
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
        const hint = $(el_window).find('.change-email-oidc-hint');
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
            $(el_window).find('.change-email-revalidated-msg').text(i18n('revalidated') || 'Re-validated.').show();
            $(el_window).find('.change-email-revalidate-btn').hide();
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

    $(el_window).find('.change-email-revalidate-btn').on('click', function () {
        openRevalidatePopup(null, (err) => {
            if ( err ) {
                $(el_window).find('.form-error-msg').html(html_encode(err.message || 'Re-validation required.'));
                $(el_window).find('.form-error-msg').fadeIn();
            }
        });
    });

    function onError (message) {
        $(el_window).find('.form-error-msg').html(html_encode(message));
        $(el_window).find('.form-error-msg').fadeIn();
        $(el_window).find('.change-email-btn').removeClass('disabled');
        $(el_window).find('.new-email').attr('disabled', false);
    }

    function onSuccess () {
        const new_email = $(el_window).find('.new-email').val();
        $(el_window).find('.form-success-msg').html(i18n('email_change_confirmation_sent'));
        $(el_window).find('.form-success-msg').fadeIn();
        $(el_window).find('input').val('');
        window.user.email = new_email;
        $(el_window).find('.change-email-btn').removeClass('disabled');
        $(el_window).find('.new-email').attr('disabled', false);
    }
}

export default UIWindowChangeEmail;