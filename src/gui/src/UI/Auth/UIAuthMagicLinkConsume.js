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

// The page a sign-in link opens. Spends the link (asking first when another
// browser requested it) and runs the second factor when the account has one.

import { appHostOf, consumeErrorMessage } from '../../helpers/magicLinkSignIn.js';
import openAuthFlow, {
    authHeadHtml,
    setAuthStatus,
    setFormBusy,
    submitButtonHtml,
    wireAuthHead,
} from './authFlow.js';
import { pushTwoFactorScreen } from './UIAuth2FA.js';

const TURNSTILE_SCRIPT_WAIT_MS = 10_000;

/**
 * A captcha token per call when the deployment runs Turnstile, else null.
 * New accounts need one, and a token is only good once.
 *
 * @param {HTMLElement} container
 * @returns {() => Promise<string | null>}
 */
const turnstileTokens = (container) => {
    const site_key = window.gui_params?.turnstileSiteKey;
    let widget_id = null;
    let pending = null;
    return async () => {
        if ( ! site_key ) return null;
        for ( let waited = 0; !window.turnstile && waited < TURNSTILE_SCRIPT_WAIT_MS; waited += 100 ) {
            await new Promise((r) => setTimeout(r, 100));
        }
        if ( ! window.turnstile ) return null;
        const token = new Promise((r) => {
            pending = r;
        });
        if ( widget_id === null ) {
            widget_id = window.turnstile.render(container, {
                sitekey: site_key,
                appearance: 'interaction-only',
                callback: (t) => pending?.(t),
                'error-callback': () => pending?.(null),
            });
        } else {
            window.turnstile.reset(widget_id);
        }
        return token;
    };
};

/**
 * @typedef {object} MagicLinkSignIn
 * @property {string} token The GUI token of the session the link opened.
 * @property {object} user
 * @property {string} request_id Names the sign-in to the window that asked for the link.
 * @property {string | null} app_origin The site the link was requested for.
 */

/**
 * Spends the sign-in link `link_token` on a page of its own.
 *
 * @param {string} link_token
 * @returns {Promise<MagicLinkSignIn | null>} Null when the user gives up.
 */
export default function UIAuthMagicLinkConsume (link_token) {
    const flow = openAuthFlow({ page: true, dismissable: false });

    let h = '<div class="dashboard-dialog-body auth-body">';
    h += authHeadHtml(flow, i18n('magic_link_consume_title', [], false));
    h += '<div class="dashboard-form-status" role="status" aria-live="polite"></div>';
    h += '<form class="auth-form magic-link-confirm" novalidate hidden>';
    h += '<p class="auth-subtitle magic-link-confirm-msg"></p>';
    h += submitButtonHtml(i18n('magic_link_confirm_continue', [], false), 'magic-link-confirm-btn');
    h += '</form>';
    h += '<div class="auth-turnstile magic-link-captcha"></div>';
    h += '</div>';
    h += '<div class="dashboard-dialog-footer auth-footer magic-link-done" hidden>';
    h += `<button type="button" class="auth-link magic-link-done-btn">${i18n('magic_link_back_to_puter')}</button>`;
    h += '</div>';

    const $screen = flow.push({ name: 'magic-link-consume', html: h });
    const $confirm = $screen.find('.magic-link-confirm');
    const $done = $screen.find('.magic-link-done');
    const next_captcha = turnstileTokens($screen.find('.magic-link-captcha').get(0));
    wireAuthHead($screen);
    setAuthStatus($screen, i18n('magic_link_signing_in', [], false), { kind: 'info' });

    const showError = (message) => {
        $confirm.prop('hidden', true);
        setAuthStatus($screen, 'text' in message ? message.text : i18n(message.key, [], false));
        $done.prop('hidden', false);
    };

    const consume = async (confirm, fingerprint) => {
        const captcha = await next_captcha();
        let resp;
        let body = null;
        try {
            resp = await fetch(`${window.gui_origin}/auth/magic-link/consume`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: link_token,
                    ...(confirm ? { confirm: true } : {}),
                    ...(captcha ? { 'cf-turnstile-response': captcha } : {}),
                    ...(fingerprint ? { fingerprint } : {}),
                }),
            });
            body = await resp.json();
        } catch {
            // A network failure or a non-JSON answer: the generic message.
        }
        if ( ! resp?.ok || ! body ) {
            showError(consumeErrorMessage(resp?.status ?? 0, body));
            return;
        }

        if ( body.next_step === 'confirm' ) {
            setAuthStatus($screen, '');
            const host = body.app_origin ? appHostOf(body.app_origin) : '';
            $screen.find('.magic-link-confirm-msg').html(host
                ? i18n('magic_link_confirm_message_app', [body.email, host])
                : i18n('magic_link_confirm_message', [body.email]));
            $confirm.prop('hidden', false);
            $done.prop('hidden', false);
            flow.focus();
            return;
        }

        let signed_in = body;
        if ( body.next_step === 'otp' ) {
            // The code screen runs its own busy state; Back returns here.
            flow.setBusy(false);
            signed_in = await pushTwoFactorScreen(flow, body.otp_jwt_token);
            if ( ! signed_in?.token ) {
                // Back from the code: the link is spent either way.
                showError({ key: 'auth_error_generic' });
                return;
            }
        }
        flow.finish({
            token: signed_in.token,
            user: signed_in.user,
            request_id: body.request_id,
            app_origin: body.app_origin ?? null,
        });
    };

    (async () => {
        let fingerprint = null;
        try {
            fingerprint = await window.getDeviceFingerprint?.();
        } catch {
            // Sign-in must never block or fail because of device signals.
        }

        $confirm.on('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ( flow.isBusy() ) return;
            flow.setBusy(true);
            setFormBusy($confirm, true);
            $done.prop('hidden', true);
            await consume(true, fingerprint);
            if ( flow.isClosed() ) return;
            setFormBusy($confirm, false);
            flow.setBusy(false);
        });
        $done.find('.magic-link-done-btn').on('click', () => {
            if ( flow.isBusy() ) return;
            flow.finish(null);
        });

        await consume(false, fingerprint);
    })();

    return flow.result;
}
