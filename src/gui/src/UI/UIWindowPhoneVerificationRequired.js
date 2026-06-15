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

// SMS phone verification dialog. Two steps in one window:
//   1. Enter a phone number → POST /send-confirm-phone (Prelude sends an SMS).
//   2. Enter the 6-digit code → POST /confirm-phone (Prelude validates it).
// The 6-digit code UX mirrors UIWindowEmailConfirmationRequired.js. Used as a
// hard gate for low-reputation signups, so by default it has no close button.
function UIWindowPhoneVerificationRequired (options) {
    return new Promise(async (resolve) => {
        options = options ?? {};
        options.window_options = options.window_options ?? {};
        let final_code = '';
        let is_checking_code = false;
        let is_sending = false;

        const spinner = '<svg style="width:20px; margin-top: 5px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#fff" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#eee" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>';
        const send_btn_txt = 'Send Code';
        const verify_btn_txt = 'Verify Phone';

        const phoneIcon =
            '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';

        let h = '';
        // Scoped styling for this dialog.
        h += `<style>
            .window-confirm-phone-using-code .phone-icon-badge {
                width: 56px; height: 56px; border-radius: 50%;
                background: #e8f1fe; display: flex; align-items: center;
                justify-content: center; margin: 4px auto 16px;
            }
            .window-confirm-phone-using-code .phone-title {
                text-align: center; font-weight: 600; font-size: 21px;
                margin: 0 0 8px;
            }
            .window-confirm-phone-using-code .phone-subtitle {
                text-align: center; color: #6b7c8c; font-size: 14px;
                line-height: 1.5; margin: 0 0 22px; padding: 0 8px;
            }
            .window-confirm-phone-using-code .phone-field-label {
                display: block; font-size: 12px; font-weight: 600;
                text-transform: uppercase; letter-spacing: .04em;
                color: #8a99a8; margin: 0 0 6px;
            }
            .window-confirm-phone-using-code .phone-input {
                width: 100%; box-sizing: border-box; padding: 12px 14px;
                font-size: 16px; color: #2c3e50;
                border: 1.5px solid #d4dde6; border-radius: 9px;
                outline: none; transition: border-color .15s, box-shadow .15s;
                background: #fff;
            }
            .window-confirm-phone-using-code .phone-input::placeholder { color: #aebac6; }
            .window-confirm-phone-using-code .phone-input:focus {
                border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15);
            }
            .window-confirm-phone-using-code .phone-send-btn,
            .window-confirm-phone-using-code .phone-verify-btn {
                margin-top: 18px; height: 42px; font-size: 15px; font-weight: 500;
            }
            .window-confirm-phone-using-code .phone-footer {
                text-align: center; font-size: 13px; margin-top: 18px;
                padding-top: 16px; border-top: 1px solid #e9eef3; color: #8a99a8;
            }
            .window-confirm-phone-using-code .phone-footer a {
                color: #3b82f6; cursor: pointer; text-decoration: none;
            }
            .window-confirm-phone-using-code .phone-footer a:hover { text-decoration: underline; }
            .window-confirm-phone-using-code .error {
                color: #c0392b; font-size: 13px; text-align: center; margin-bottom: 10px;
            }
        </style>`;
        if ( options.show_close_button !== false ) {
            h += '<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>';
        }
        h += '<div style="-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #3e5362; max-width: 330px; margin: 0 auto;">';
        h += `<div class="phone-icon-badge">${phoneIcon}</div>`;
        h += '<h3 class="phone-title">Verify your phone number</h3>';

        // -- Step 1: phone number --
        h += '<form class="phone-step phone-step-1">';
        h += '<p class="phone-subtitle">We\'ll text you a verification code to confirm it\'s really you.</p>';
        // Offer a friendly human fallback so verification is never a dead end —
        // worded as help, not as an accusation.
        h += `<p style="text-align:center; font-size:12px; line-height:1.4; color:#8a99a8; margin:-12px auto 18px; max-width:320px;">Need help? Email <a href="mailto:hi@puter.com" style="color:#3b82f6; text-decoration:none;">hi@puter.com</a> and we'll help you finish creating your account.</p>`;
        h += '<div class="error"></div>';
        h += '<label class="phone-field-label" for="phone-verif-input">Phone number</label>';
        h += '<input id="phone-verif-input" class="phone-input" type="tel" autocomplete="tel" placeholder="+1 (555) 123-4567" />';
        h += `<button type="submit" class="button button-block button-primary phone-send-btn">${send_btn_txt}</button>`;
        if ( options.logout_in_footer ) {
            h += `<div class="phone-footer"><a class="phone-log-out">${i18n('log_out')}</a></div>`;
        }
        h += '</form>';

        // -- Step 2: 6-digit code (hidden until a code is sent) --
        h += '<form class="phone-step phone-step-2" style="display:none;">';
        h += '<p class="phone-subtitle">Enter the 6-digit code sent to <strong style="font-weight: 600; color:#3e5362;" class="phone-target"></strong></p>';
        h += '<div class="error"></div>';
        h += `  <fieldset name="number-code" style="border: none; padding:0;" data-number-code-form>
                <input class="digit-input" type="number" min='0' max='9' name='number-code-0' data-number-code-input='0' required />
                <input class="digit-input" type="number" min='0' max='9' name='number-code-1' data-number-code-input='1' required />
                <input class="digit-input" type="number" min='0' max='9' name='number-code-2' data-number-code-input='2' required />
                <span class="email-confirm-code-hyphen">-</span>
                <input class="digit-input" type="number" min='0' max='9' name='number-code-3' data-number-code-input='3' required />
                <input class="digit-input" type="number" min='0' max='9' name='number-code-4' data-number-code-input='4' required />
                <input class="digit-input" type="number" min='0' max='9' name='number-code-5' data-number-code-input='5' required />
              </fieldset>`;
        h += `<button type="submit" class="button button-block button-primary phone-verify-btn" disabled>${verify_btn_txt}</button>`;
        h += '<div class="phone-footer">';
        h += '<a class="phone-resend-code">Re-send code</a> &nbsp;&bull;&nbsp; <a class="phone-change-number">Change number</a>';
        if ( options.logout_in_footer ) {
            h += ' &nbsp;&bull;&nbsp; ';
            h += `<a class="phone-log-out">${i18n('log_out')}</a>`;
        }
        h += '</div>';
        h += '</form>';
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
            onAppend: function (el_window) {
                $(el_window).find('.phone-input').first().focus();
            },
            window_class: 'window-confirm-phone-using-code',
            window_css: {
                height: 'initial',
            },
            body_css: {
                padding: '30px',
                width: 'initial',
                height: 'initial',
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

        // -- Step 1: send the code --
        const sendCode = () => {
            if ( is_sending ) return;
            clearError();
            const phone = $(el_window).find('.phone-input').val();
            if ( !phone || phone.trim().length < 5 ) {
                showError('Please enter a valid phone number.');
                return;
            }
            is_sending = true;
            $(el_window).find('.phone-send-btn').prop('disabled', true).html(spinner);

            $.ajax({
                url: `${window.api_origin}/send-confirm-phone`,
                type: 'POST',
                data: JSON.stringify({ phone }),
                async: true,
                contentType: 'application/json',
                headers: { 'Authorization': `Bearer ${window.auth_token}` },
                statusCode: { 401: (xhr) => window.handle401(xhr) },
                success: function () {
                    // Advance to the code-entry step.
                    $(el_window).find('.phone-target').text(phone);
                    $(el_window).find('.phone-step-1').hide();
                    $(el_window).find('.phone-step-2').show();
                    $(el_window).find('.digit-input').first().focus();
                },
                error: function (xhr) {
                    showError(
                        xhr.responseJSON?.error ??
                            'Could not send a code to that number.',
                    );
                },
                complete: function () {
                    is_sending = false;
                    $(el_window)
                        .find('.phone-send-btn')
                        .prop('disabled', false)
                        .html(send_btn_txt);
                },
            });
        };

        $(el_window).find('.phone-send-btn').on('click submit', function (e) {
            e.preventDefault();
            e.stopPropagation();
            sendCode();
        });

        // Re-send / change number on the code step.
        $(el_window).find('.phone-resend-code').on('click', function () {
            sendCode();
        });
        $(el_window).find('.phone-change-number').on('click', function () {
            clearError();
            $(el_window).find('.phone-step-2').hide();
            $(el_window).find('.phone-step-1').show();
            $(el_window).find('.phone-input').focus();
        });

        // -- Step 2: verify the code --
        $(el_window).find('.phone-verify-btn').on('click submit', function (e) {
            e.preventDefault();
            e.stopPropagation();

            $(el_window).find('.phone-verify-btn').prop('disabled', true);
            $(el_window).find('.digit-input').prop('disabled', true);
            clearError();

            if ( is_checking_code ) return;
            is_checking_code = true;

            $(el_window).find('.phone-verify-btn').html(spinner);

            setTimeout(() => {
                $.ajax({
                    url: `${window.api_origin}/confirm-phone`,
                    type: 'POST',
                    data: JSON.stringify({ code: final_code }),
                    async: true,
                    contentType: 'application/json',
                    headers: { 'Authorization': `Bearer ${window.auth_token}` },
                    statusCode: { 401: (xhr) => window.handle401(xhr) },
                    success: function (res) {
                        if ( res.phone_verified ) {
                            $(el_window).close();
                            window.refresh_user_data(window.auth_token);
                            resolve(true);
                        } else {
                            showError('Invalid verification code.');
                            $(el_window).find('.digit-input').val('');
                            $(el_window).find('.digit-input').first().focus();
                            $(el_window)
                                .find('.phone-verify-btn')
                                .prop('disabled', false)
                                .html(verify_btn_txt);
                            $(el_window)
                                .find('.digit-input')
                                .prop('disabled', false);
                        }
                    },
                    error: function (xhr) {
                        showError(
                            xhr.responseJSON?.error ?? 'Could not verify code.',
                        );
                        $(el_window).find('.digit-input').val('');
                        $(el_window).find('.digit-input').first().focus();
                        $(el_window)
                            .find('.phone-verify-btn')
                            .prop('disabled', false)
                            .html(verify_btn_txt);
                        $(el_window).find('.digit-input').prop('disabled', false);
                    },
                    complete: function () {
                        is_checking_code = false;
                    },
                });
            }, 1000);
        });

        // logout
        $(el_window).find('.phone-log-out').on('click', function () {
            window.logout();
            $(el_window).close();
        });

        // -- 6-digit input handling (mirrors the email confirmation dialog) --
        const numberCodeForm = el_window.querySelector('[data-number-code-form]');
        const numberCodeInputs = [
            ...numberCodeForm.querySelectorAll('[data-number-code-input]'),
        ];

        numberCodeForm.addEventListener('input', ({ target }) => {
            if ( !target.value.length ) {
                return (target.value = null);
            }
            const inputLength = target.value.length;
            let currentIndex = Number(target.dataset.numberCodeInput);
            if ( inputLength === 2 ) {
                const inputValues = target.value.split('');
                target.value = inputValues[0];
            } else if ( inputLength > 1 ) {
                const inputValues = target.value.split('');
                inputValues.forEach((value, valueIndex) => {
                    const nextValueIndex = currentIndex + valueIndex;
                    if ( nextValueIndex >= numberCodeInputs.length ) {
                        return;
                    }
                    numberCodeInputs[nextValueIndex].value = value;
                });
                currentIndex += inputValues.length - 2;
            }

            const nextIndex = currentIndex + 1;
            if ( nextIndex < numberCodeInputs.length ) {
                numberCodeInputs[nextIndex].focus();
            }

            final_code = '';
            for ( let i = 0; i < numberCodeInputs.length; i++ ) {
                final_code += numberCodeInputs[i].value;
            }
            if ( final_code.length === 6 ) {
                $(el_window).find('.phone-verify-btn').prop('disabled', false);
                $(el_window).find('.digit-input').prop('disabled', false);
                $(el_window).find('.phone-verify-btn').trigger('click');
            }
        });

        numberCodeForm.addEventListener('keydown', (e) => {
            const { code, target } = e;
            const currentIndex = Number(target.dataset.numberCodeInput);
            const previousIndex = currentIndex - 1;
            const nextIndex = currentIndex + 1;
            const hasPreviousIndex = previousIndex >= 0;
            const hasNextIndex = nextIndex <= numberCodeInputs.length - 1;

            switch ( code ) {
            case 'ArrowLeft':
            case 'ArrowUp':
                if ( hasPreviousIndex ) numberCodeInputs[previousIndex].focus();
                e.preventDefault();
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                if ( hasNextIndex ) numberCodeInputs[nextIndex].focus();
                e.preventDefault();
                break;
            case 'Backspace':
                if ( !e.target.value.length && hasPreviousIndex ) {
                    numberCodeInputs[previousIndex].value = null;
                    numberCodeInputs[previousIndex].focus();
                }
                break;
            default:
                break;
            }
        });
    });
}

def(UIWindowPhoneVerificationRequired, 'ui.UIConfirmPhone');

export default UIWindowPhoneVerificationRequired;
