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

import UIWindow from './UIWindow.js';
import UIWindowLogin from './UIWindowLogin.js';
import { authLogoHeader, wireAuthLogoHeader } from '../helpers/authLogoHeader.js';
import { isAttestedOrigin } from '../helpers/attestedOrigin.js';
import { get_auth_redirect_url, oidcStartUrl } from '../helpers/authRedirect.js';
import {
    MAGIC_LINK_CHANNEL,
    looksLikeEmail,
    oidcProviderForEmail,
    watchMagicLinkSignIn,
} from '../helpers/magicLinkSignIn.js';
import { OIDC_PROVIDER_ICONS } from '../util/openid.js';
import { offersFederatedSignIn } from '../util/popupAuth.js';

/**
 * The session the link's tab opened in this browser, if it is `userUuid`'s.
 * The cookie is shared, so this window only needs a GUI token for it.
 */
const adoptBrowserSession = async (userUuid) => {
    const tokenResp = await fetch(`${window.gui_origin}/get-gui-token`, { credentials: 'include' });
    if ( ! tokenResp.ok ) return null;
    const { token } = await tokenResp.json();
    const whoamiResp = await fetch(`${window.api_origin}/whoami?icon_size=64`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if ( ! whoamiResp.ok ) return null;
    const user = await whoamiResp.json();
    return user?.uuid === userUuid ? { token, user } : null;
};

/**
 * Email sign-in. An address its provider verifies (Gmail, Outlook) gets that
 * provider's button; any other gets a sign-in link by email. The link signs in
 * the tab it opens, and when that tab is in this browser this window signs in
 * with it, so a popup can still hand its opener a token.
 *
 * Resolves `true` once signed in, the password window's result when the user
 * switches to it, or `false` when closed.
 */
async function UIWindowMagicLinkSignIn (options) {
    options = options ?? {};
    if ( options.redirect_url === undefined ) {
        options.redirect_url = get_auth_redirect_url();
    }
    const opener_origin = window.embedded_in_popup && isAttestedOrigin(window.openerOrigin)
        ? window.openerOrigin
        : '';

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();
        let settled = false;
        let stop_watching = () => {};
        const settle = (value) => {
            if ( settled ) return;
            settled = true;
            stop_watching();
            resolve(value);
        };

        let h = '';
        h += '<div style="max-width:100%; width:100%; height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; align-items:stretch; padding:0; overflow:auto; color:var(--color-text);">';
        h += '<div class="logo-wrapper" style="display:flex; justify-content:center; padding:20px 20px 0 20px; margin-bottom: 0;">';
        h += authLogoHeader({
            logoSrc: window.icons['logo-white.svg'],
            openerOrigin: opener_origin,
            openerFallbackSrc: window.icons['website.svg'],
        });
        h += '</div>';
        h += '<div style="padding:10px 20px; text-align:center; margin-bottom:0;">';
        h += `<h1 class="login-form-title">${i18n('magic_link_title')}</h1>`;
        if ( opener_origin ) {
            h += `<p class="auth-opener-notice">${i18n('popup_opener_uses_puter', [new URL(opener_origin).hostname])}</p>`;
        }
        h += '</div>';
        h += '<div style="padding:20px; overflow-y:auto; overflow-x:hidden;">';
        h += '<form class="magic-link-form" style="width:100%; max-width: 400px; margin: 0 auto;">';
        h += '<div class="magic-link-error-msg" style="color:#e74c3c; display:none; margin-bottom:10px; line-height:15px; font-size:13px;"></div>';
        h += '<div style="position: relative; margin-bottom: 20px;">';
        h += `<label for="magic-link-email-${internal_id}" style="display:block; margin-bottom:5px;">${i18n('email')}</label>`;
        h += `<input id="magic-link-email-${internal_id}" class="magic-link-email" type="email" value="${html_encode(options.email ?? '')}" autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="off"/>`;
        h += '</div>';
        h += `<button type="submit" class="magic-link-send-btn button button-primary button-block button-normal">${i18n('magic_link_send')}</button>`;
        h += '<button type="button" class="magic-link-provider-btn oidc-btn button button-block button-normal" style="display:none; align-items:center; justify-content:center; gap:8px;"></button>';
        h += `<p class="signup-terms">${i18n('magic_link_tos_fineprint', [], false)}</p>`;
        h += '</form>';
        h += '<div class="magic-link-sent" style="display:none; width:100%; max-width:400px; margin:0 auto; line-height:20px; font-size:14px; text-align:center;"></div>';
        h += '</div>';
        h += '<div class="c2a-wrapper" style="padding:20px;">';
        h += `<button class="login-c2a-clickable magic-link-login-c2a">${i18n('magic_link_password_c2a')}</button>`;
        h += '</div>';
        h += '</div>';

        let switching_window = false;
        const el_window = await UIWindow({
            title: null,
            app: 'magic-link-sign-in',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_draggable: options.is_draggable ?? true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            show_close_button: options.show_close_button,
            ...options.window_options,
            width: 350,
            dominant: true,
            on_close: () => {
                if ( ! switching_window ) settle(false);
            },
            onAppend: function (this_window) {
                const $email = $(this_window).find('.magic-link-email');
                if ( ! $email.val() ) $email.get(0)?.focus({ preventScroll: true });
            },
            window_class: 'window-login',
            window_css: {
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                padding: '0',
                'background-color': 'rgb(255 255 255)',
                'backdrop-filter': 'blur(3px)',
                'display': 'flex',
                'flex-direction': 'column',
                'justify-content': 'center',
                'align-items': 'center',
            },
        });

        wireAuthLogoHeader(el_window);

        const $form = $(el_window).find('.magic-link-form');
        const $email = $(el_window).find('.magic-link-email');
        const $error = $(el_window).find('.magic-link-error-msg');
        const $send_btn = $(el_window).find('.magic-link-send-btn');
        const $provider_btn = $(el_window).find('.magic-link-provider-btn');

        const typed_email = () => String($email.val() ?? '').trim();
        const show_error = (html) => {
            $error.html(html).fadeIn();
        };

        // -- Routing: provider button or sign-in link --
        let providers = [];
        let routed_provider = null;
        const route = () => {
            routed_provider = oidcProviderForEmail(typed_email(), providers);
            if ( routed_provider ) {
                $provider_btn
                    .html(`${OIDC_PROVIDER_ICONS[routed_provider] ?? ''}${i18n(`sign_in_with_${routed_provider}`)}`)
                    .css('display', 'flex');
                $send_btn.hide();
            } else {
                $provider_btn.hide();
                $send_btn.show();
            }
        };
        $email.on('input', route);
        if ( offersFederatedSignIn({
            embeddedInPopup: !!window.embedded_in_popup,
            action: window.gui_action,
            crossOriginIsolated: window.url_query_params?.get('cross_origin_isolated') === 'true',
        }) ) {
            try {
                const resp = await fetch(`${window.api_origin}/auth/oidc/providers`);
                if ( resp.ok ) providers = (await resp.json()).providers ?? [];
            } catch ( _ ) {
                // No providers: every address gets a link.
            }
            route();
        }
        $provider_btn.on('click', () => {
            if ( ! routed_provider ) return;
            window.location.href = oidcStartUrl({
                provider: routed_provider,
                flow: 'login',
                referrer: options.referrer ?? window.referrerStr ?? window.openerOrigin,
                loginHint: typed_email(),
            });
        });

        // -- Sign-in link --
        const on_signed_in = async (user_uuid) => {
            const session = await adoptBrowserSession(user_uuid);
            if ( ! session ) return;
            await window.update_auth_data(session.token, session.user);
            if ( options.reload_on_success ) {
                window.onbeforeunload = null;
                window.location.replace(options.redirect_url || window.location.origin + window.location.pathname);
                return;
            }
            settle(true);
            $(el_window).close();
        };

        $form.on('submit', async (e) => {
            e.preventDefault();
            $error.hide();
            if ( routed_provider ) {
                $provider_btn.trigger('click');
                return;
            }
            const email = typed_email();
            if ( ! looksLikeEmail(email) ) {
                show_error(i18n('magic_link_invalid_email'));
                return;
            }
            $send_btn.prop('disabled', true);
            try {
                const resp = await fetch(`${window.gui_origin}/auth/magic-link/request`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        ...(opener_origin ? { app_origin: opener_origin } : {}),
                    }),
                });
                if ( resp.status === 429 ) {
                    show_error(i18n('magic_link_too_many_requests'));
                    return;
                }
                let body = null;
                try {
                    body = await resp.json();
                } catch ( _ ) {
                    // An empty or non-JSON answer falls through to the generic error.
                }
                if ( ! resp.ok || ! body?.request_id ) {
                    // A refused address comes back with text saying why.
                    show_error(resp.status === 400 && body?.message
                        ? html_encode(body.message)
                        : i18n('magic_link_request_failed'));
                    return;
                }
                stop_watching();
                stop_watching = watchMagicLinkSignIn({
                    requestId: body.request_id,
                    openChannel: () => new BroadcastChannel(MAGIC_LINK_CHANNEL),
                    onSignedIn: on_signed_in,
                });
                $form.hide();
                $(el_window).find('.magic-link-sent')
                    .html(`<p>${i18n('magic_link_sent_message', [email])}</p><p>${i18n('magic_link_sent_keep_open')}</p>`)
                    .show();
            } catch ( _ ) {
                show_error(i18n('magic_link_request_failed'));
            } finally {
                $send_btn.prop('disabled', false);
            }
        });

        $(el_window).find('.magic-link-login-c2a').on('click', async () => {
            const email = typed_email();
            stop_watching();
            switching_window = true;
            $(el_window).close();
            settle(await UIWindowLogin({
                referrer: options.referrer,
                reload_on_success: options.reload_on_success,
                redirect_url: options.redirect_url,
                window_options: options.window_options,
                show_close_button: options.show_close_button,
                send_confirmation_code: options.send_confirmation_code,
                ...(email ? { email_or_username: email } : {}),
            }));
        });
    });
}

export default UIWindowMagicLinkSignIn;
