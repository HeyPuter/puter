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
import UIAlert from './UIAlert.js';

function UIWindowEmailConfirmationRequired (options) {
    return new Promise(async (resolve) => {
        options = options ?? {};
        let final_code = '';
        let is_checking_code = false;

        const submit_btn_txt = 'Confirm Email';

        let h = '';
        h += '<div class="qr-code-window-close-btn generic-close-window-button"> &times; </div>';
        h += '<div style="-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: #3e5362;">';
        h += `<img src="${html_encode(window.icons['mail.svg'])}" style="display:block; margin:10px auto 10px;">`;
        h += `<h3 style="text-align:center; font-weight: 500; font-size: 20px;">${i18n('confirm_your_email_address')}</h3>`;
        h += '<form>';
        h += `<p style="text-align:center; padding: 0 20px;">To continue, please enter the 6-digit confirmation code sent to <strong style="font-weight: 500;">${window.user.email}</strong></p>`;
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
        h += `<button type="submit" class="button button-block button-primary email-confirm-btn" style="margin-top:10px;" disabled>${submit_btn_txt}</button>`;
        h += '</form>';
        h += '<div style="text-align:center; padding:10px; font-size:14px; margin-top:10px;">';
        h += `<span class="send-conf-email">${i18n('resend_confirmation_code')}</span>`;
        if ( options.logout_in_footer ) {
            h += ' &bull; ';
            h += `<span class="conf-email-log-out">${i18n('log_out')}</span>`;
        }
        h += '</div>';
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
            width: 390,
            dominant: true,
            onAppend: function (el_window) {
                $(el_window).find('.digit-input').first().focus();
            },
            window_class: 'window-confirm-email-using-code',
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

        $(el_window).find('.digit-input').first().focus();

        $(el_window).find('.email-confirm-btn').on('click submit', function (e) {
            e.preventDefault();
            e.stopPropagation();

            $(el_window).find('.email-confirm-btn').prop('disabled', true);
            $(el_window).find('.digit-input').prop('disabled', true);
            $(el_window).find('.error').hide();

            // Check if already checking code to prevent multiple requests
            if ( is_checking_code )
            {
                return;
            }
            // Confirm button
            is_checking_code = true;

            // set animation
            $(el_window).find('.email-confirm-btn').html('<svg style="width:20px; margin-top: 5px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#fff" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#eee" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>');

            setTimeout(() => {
                $.ajax({
                    url: `${window.api_origin }/confirm-email`,
                    type: 'POST',
                    data: JSON.stringify({
                        code: final_code,
                    }),
                    async: true,
                    contentType: 'application/json',
                    headers: {
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                    statusCode: {
                        401: function () {
                            window.logout();
                        },
                    },
                    success: function (res) {
                        if ( res.email_confirmed ) {
                            $(el_window).close();
                            window.refresh_user_data(window.auth_token);
                            resolve(true);
                        } else {
                            $(el_window).find('.error').html('Invalid confirmation code.');
                            $(el_window).find('.error').fadeIn();
                            $(el_window).find('.digit-input').val('');
                            $(el_window).find('.digit-input').first().focus();
                            $(el_window).find('.email-confirm-btn').prop('disabled', false);
                            $(el_window).find('.digit-input').prop('disabled', false);
                            $(el_window).find('.email-confirm-btn').html(submit_btn_txt);
                        }
                    },
                    error: function (res) {
                        $(el_window).find('.error').html(html_encode(res.responseJSON.error));
                        $(el_window).find('.error').fadeIn();
                        $(el_window).find('.digit-input').val('');
                        $(el_window).find('.digit-input').first().focus();
                        $(el_window).find('.email-confirm-btn').prop('disabled', false);
                        $(el_window).find('.digit-input').prop('disabled', false);
                        $(el_window).find('.email-confirm-btn').html(submit_btn_txt);
                    },
                    complete: function () {
                        is_checking_code = false;
                    },
                });
            }, 1000);
        });

        // send email confirmation
        $(el_window).find('.send-conf-email').on('click', function (e) {
            $.ajax({
                url: `${window.api_origin }/send-confirm-email`,
                type: 'POST',
                async: true,
                contentType: 'application/json',
                headers: {
                    'Authorization': `Bearer ${window.auth_token}`,
                },
                statusCode: {
                    401: function () {
                        window.logout();
                    },
                },
                success: async function (res) {
                    await UIAlert({
                        message: `A new confirmation code has been sent to <strong>${window.user.email}</strong>.`,
                        body_icon: window.icons['c-check.svg'],
                        stay_on_top: true,
                        backdrop: true,
                    });
                    $(el_window).find('.digit-input').first().focus();
                },
                complete: function () {
                },
            });
        });

        // logout
        $(el_window).find('.conf-email-log-out').on('click', function (e) {
            window.logout();
            $(el_window).close();
        });

        // Elements
        const numberCodeForm = document.querySelector('[data-number-code-form]');
        const numberCodeInputs = [...numberCodeForm.querySelectorAll('[data-number-code-input]')];

        // Event listeners
        numberCodeForm.addEventListener('input', ({ target }) => {
            if ( ! target.value.length ) {
                return target.value = null;
            }
            const inputLength = target.value.length;
            let currentIndex = Number(target.dataset.numberCodeInput);
            if ( inputLength === 2 ) {
                const inputValues = target.value.split('');
                target.value = inputValues[0];
            }
            else if ( inputLength > 1 ) {
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

            // Concatenate all inputs into one string to create the final code
            final_code = '';
            for ( let i = 0; i < numberCodeInputs.length; i++ ) {
                final_code += numberCodeInputs[i].value;
            }
            // Automatically submit if 6 digits entered
            if ( final_code.length === 6 ) {
                $(el_window).find('.email-confirm-btn').prop('disabled', false);
                $(el_window).find('.digit-input').prop('disabled', false);
                $(el_window).find('.email-confirm-btn').trigger('click');
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
                if ( hasPreviousIndex ) {
                    numberCodeInputs[previousIndex].focus();
                }
                e.preventDefault();
                break;

            case 'ArrowRight':
            case 'ArrowDown':
                if ( hasNextIndex ) {
                    numberCodeInputs[nextIndex].focus();
                }
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

def(UIWindowEmailConfirmationRequired, 'ui.UIConfirmEmail');

export default UIWindowEmailConfirmationRequired;