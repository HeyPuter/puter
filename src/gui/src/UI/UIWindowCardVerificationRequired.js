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

import UIWindow from './UIWindow.js';

// Credit-card verification dialog (Stripe SetupIntent). Three states in one window:
//   1. Loading → POST /card-verification/setup returns a client_secret and a
//      publishable key (or short-circuits when the user is already verified).
//   2. Card entry → a Stripe Payment Element; stripe.confirmSetup() runs the
//      SetupIntent client-side, then POST /card-verification/confirm validates
//      it server-side (card fingerprint reuse, etc.).
//   3. Unavailable → setup failed; retry and log-out affordances, not a dead end.
// Stripe.js is loaded lazily from the CDN only when this dialog actually opens.
// Used as a hard gate for low-reputation signups (after phone verification), so
// by default it has no close button.

const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

let stripe_js_promise = null;
const loadStripeJs = () => {
    if (window.Stripe) return Promise.resolve();
    if (!stripe_js_promise) {
        stripe_js_promise = window.loadScript(STRIPE_JS_URL);
        stripe_js_promise.catch((error) => {
            // Don't cache the failure — the retry button re-attempts the load.
            stripe_js_promise = null;
            console.debug('Stripe.js unavailable:', error);
        });
    }
    return stripe_js_promise;
};

function UIWindowCardVerificationRequired(options) {
    return new Promise(async (resolve) => {
        options = options ?? {};
        options.window_options = options.window_options ?? {};
        let is_setting_up = false;
        let is_submitting = false;
        let stripe = null;
        let elements = null;
        let payment_element = null;
        // Set once stripe.confirmSetup() succeeds client-side; lets a retry
        // skip straight to the server confirmation if that call failed.
        let confirmed_setup_intent_id = null;

        const spinner =
            '<svg style="width:20px; margin-top: 5px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#fff" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#eee" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>';
        const dark_spinner =
            '<svg style="width:24px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#212121" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#212121" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>';
        const verify_btn_txt = 'Verify Card';
        const retry_btn_txt = 'Try Again';

        let h = '';
        if (options.show_close_button !== false) {
            h +=
                '<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>';
        }
        h +=
            '<div style="-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #3e5362; max-width: 350px; margin: 0 auto;">';
        h += `<img src="${html_encode(window.icons['card.svg'] ?? window.icons['shield.svg'])}" style="display:block; margin:10px auto 10px; width:50px;">`;
        h +=
            '<h3 style="text-align:center; font-weight: 500; font-size: 20px;">Verify Your Card</h3>';
        h += '<div class="error"></div>';

        // -- Loading: setup call in flight, Stripe.js loading --
        h += `<div class="card-step card-step-loading" style="text-align:center; padding:20px;">${dark_spinner}</div>`;

        // -- Card entry: Stripe Payment Element (hidden until setup succeeds) --
        h += '<form class="card-step card-step-form" style="display:none;">';
        h +=
            '<p style="text-align:center; padding: 0 20px; font-size:13px;">Verify a card to continue. You will <b><i>not</i></b> be charged.</p>';
        // Offer a friendly human fallback so verification is never a dead end —
        // worded as help, not as an accusation.
        h += `<p style="text-align:center; font-size:12px; line-height:1.4; color:#8a99a8; margin:6px auto 14px; max-width:320px;">Need help? Email <a href="mailto:support@puter.com" style="color:#3b82f6; text-decoration:none;">support@puter.com</a> and we'll assist you creating your account.</p>`;
        h += '<div class="card-payment-element"></div>';
        h += `<button type="submit" class="button button-block button-primary card-verify-btn" style="margin-top:15px;">${verify_btn_txt}</button>`;
        h += '</form>';

        // -- Unavailable: setup failed (hidden unless it does) --
        h +=
            '<div class="card-step card-step-unavailable" style="display:none;">';
        h +=
            '<p style="text-align:center; padding: 0 20px;">Card verification is temporarily unavailable. Please try again in a few minutes.</p>';
        h += `<button type="button" class="button button-block button-primary card-retry-btn" style="margin-top:10px;">${retry_btn_txt}</button>`;
        if (!options.logout_in_footer) {
            h +=
                '<div style="text-align:center; padding:10px; font-size:14px; margin-top:10px;">';
            h += `<span class="card-log-out" style="cursor:pointer;">${i18n('log_out')}</span>`;
            h += '</div>';
        }
        h += '</div>';

        if (options.logout_in_footer) {
            h +=
                '<div style="text-align:center; padding:14px 10px 4px; margin-top:6px; border-top:1px solid #e9eef3; font-size:14px;">';
            h += `<span class="card-log-out" style="cursor:pointer;">${i18n('log_out')}</span>`;
            h += '</div>';
        }
        h += '</div>';

        const el_window = await UIWindow({
            title: null,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_draggable: options.is_draggable ?? true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: options.stay_on_top ?? false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: true,
            close_on_backdrop_click: false,
            width: 390,
            dominant: true,
            ...options.window_options,
            window_class: 'window-card-verification',
            window_css: {
                height: 'initial',
                // Dominant windows pin to 15vh from the top; with a tall Stripe
                // iframe that drops the log-out below the viewport. Sit higher so
                // the dialog always ends above the browser's bottom edge.
                top: '5vh',
            },
            body_css: {
                // border-box so max-height includes the padding — keeps the math
                // exact: 5vh top + 85vh body = 90vh, always within the viewport.
                'box-sizing': 'border-box',
                padding: '30px',
                width: 'initial',
                height: 'initial',
                // The Stripe Payment Element can run tall; cap the dialog to the
                // viewport and let the body scroll instead of overflowing it.
                'max-height': '85vh',
                'overflow-y': 'auto',
                'background-color': 'rgb(247 251 255)',
                'backdrop-filter': 'blur(3px)',
            },
        });

        const showError = (msg) => {
            $(el_window).find('.error').html(html_encode(msg)).fadeIn();
        };
        const clearError = () => {
            $(el_window).find('.error').hide();
        };
        const showStep = (name) => {
            $(el_window).find('.card-step').hide();
            $(el_window).find(`.card-step-${name}`).show();
        };

        const finish = () => {
            $(el_window).close();
            window.refresh_user_data(window.auth_token);
            resolve(true);
        };

        const mountPaymentElement = async (publishable_key, client_secret) => {
            await loadStripeJs();
            stripe = window.Stripe(publishable_key);
            elements = stripe.elements({ clientSecret: client_secret });
            if (payment_element) {
                payment_element.destroy();
            }
            payment_element = elements.create('payment');
            payment_element.mount(
                $(el_window).find('.card-payment-element').get(0),
            );
        };

        // -- Setup: fetch a client_secret and mount the Payment Element. Also
        //    the restart path after a rejected card (a succeeded SetupIntent is
        //    spent, so trying another card needs a fresh client_secret). --
        const startSetup = async (setup_options = {}) => {
            if (is_setting_up) return;
            is_setting_up = true;
            // After a rejection the error explains why the flow restarted, so
            // keep it on screen through the new setup call.
            if (!setup_options.keep_error) clearError();
            showStep('loading');

            // Same device fingerprint signal signup sends, so the abuse
            // extension can cap card-verification setups per device across
            // accounts. Best effort — a failure/timeout just omits it.
            let fingerprint = null;
            try {
                fingerprint = await window.getDeviceFingerprint?.();
            } catch (_) {}

            $.ajax({
                url: `${window.api_origin}/card-verification/setup`,
                type: 'POST',
                async: true,
                data: JSON.stringify(fingerprint ? { fingerprint } : {}),
                contentType: 'application/json',
                headers: { Authorization: `Bearer ${window.auth_token}` },
                statusCode: { 401: (xhr) => window.handle401(xhr) },
                success: async function (res) {
                    // Already verified, or the feature was disabled server-side
                    // (kill switch) — either way the gate is satisfied.
                    if (res.card_verified) {
                        finish();
                        return;
                    }
                    confirmed_setup_intent_id = null;
                    try {
                        await mountPaymentElement(
                            res.publishable_key,
                            res.client_secret,
                        );
                        $(el_window)
                            .find('.card-verify-btn')
                            .prop('disabled', false)
                            .html(verify_btn_txt);
                        showStep('form');
                    } catch (e) {
                        console.debug(
                            'Could not mount the payment element:',
                            e,
                        );
                        showStep('unavailable');
                    }
                },
                error: function (xhr) {
                    // The backend forwards an opaque abuse `reason`; a device we
                    // couldn't verify is a contact-support case, not a transient
                    // outage, so message it specifically.
                    if (xhr.responseJSON?.reason === 'device_unverifiable') {
                        showError(
                            "We couldn't verify your device. Please email support@puter.com for help.",
                        );
                    } else if (xhr.responseJSON?.error) {
                        showError(xhr.responseJSON.error);
                    }
                    showStep('unavailable');
                },
                complete: function () {
                    is_setting_up = false;
                },
            });
        };

        $(el_window)
            .find('.card-retry-btn')
            .on('click', function () {
                startSetup();
            });

        // -- Confirm: run the SetupIntent client-side, then verify it server-side --
        $(el_window)
            .find('.card-verify-btn')
            .on('click submit', async function (e) {
                e.preventDefault();
                e.stopPropagation();

                if (is_submitting) return;
                is_submitting = true;
                clearError();
                $(el_window)
                    .find('.card-verify-btn')
                    .prop('disabled', true)
                    .html(spinner);

                // Skipped when a previous attempt already confirmed the SetupIntent
                // but the server call failed — retrying re-uses the confirmed intent.
                if (!confirmed_setup_intent_id) {
                    let result;
                    try {
                        result = await stripe.confirmSetup({
                            elements,
                            redirect: 'if_required',
                        });
                    } catch (error) {
                        result = { error };
                    }
                    if (result.error) {
                        showError(
                            result.error.message ??
                                'Could not verify your card.',
                        );
                        $(el_window)
                            .find('.card-verify-btn')
                            .prop('disabled', false)
                            .html(verify_btn_txt);
                        is_submitting = false;
                        return;
                    }
                    confirmed_setup_intent_id = result.setupIntent.id;
                }

                $.ajax({
                    url: `${window.api_origin}/card-verification/confirm`,
                    type: 'POST',
                    data: JSON.stringify({
                        setup_intent_id: confirmed_setup_intent_id,
                    }),
                    async: true,
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${window.auth_token}` },
                    statusCode: { 401: (xhr) => window.handle401(xhr) },
                    success: function (res) {
                        if (res.card_verified) {
                            finish();
                            return;
                        }
                        // Rejected. The succeeded SetupIntent is spent, so restart
                        // with a fresh setup call to let the user try another card.
                        confirmed_setup_intent_id = null;
                        if (res.reason === 'card_already_used') {
                            showError(
                                'This card has already been used to verify other accounts. Please try a different card.',
                            );
                        } else {
                            showError(
                                "We couldn't verify this card. Please try a different card.",
                            );
                        }
                        startSetup({ keep_error: true });
                    },
                    error: function (xhr) {
                        // Transient failure — the SetupIntent already succeeded
                        // client-side, so keep it and let the user retry the
                        // server confirmation.
                        showError(
                            xhr.responseJSON?.error ??
                                'Could not verify your card. Please try again.',
                        );
                        $(el_window)
                            .find('.card-verify-btn')
                            .prop('disabled', false)
                            .html(verify_btn_txt);
                    },
                    complete: function () {
                        is_submitting = false;
                    },
                });
            });

        // logout
        $(el_window)
            .find('.card-log-out')
            .on('click', function () {
                window.logout();
                $(el_window).close();
            });

        startSetup();
    });
}

def(UIWindowCardVerificationRequired, 'ui.UIConfirmCard');

export default UIWindowCardVerificationRequired;
