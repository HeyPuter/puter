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

import UIWindow from './UIWindow.js'
import UIAlert from './UIAlert.js'
import UIWindowLogin from './UIWindowLogin.js'
import check_password_strength from '../helpers/check_password_strength.js'

async function UIWindowNewPassword(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        const internal_id = window.uuidv4();
        let h = '';
        h += `<div class="change-password" style="padding: 20px; border-bottom: 1px solid #ced7e1;">`;
            // error msg
            h += `<div class="form-error-msg"></div>`;
            // new password
            h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">`;
                h += `<label for="new-password-${internal_id}">${i18n('new_password')}</label>`;
                h += `<input class="new-password" id="new-password-${internal_id}" type="password" name="new-password" autocomplete="off" />`;
            h += `</div>`;
            // confirm new password
            h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">`;
                h += `<label for="confirm-new-password-${internal_id}">${i18n('confirm_new_password')}</label>`;
                h += `<input class="confirm-new-password" id="confirm-new-password-${internal_id}" type="password" name="confirm-new-password" autocomplete="off" />`;
            h += `</div>`;

            // Change Password
            h += `<button class="change-password-btn button button-primary button-block button-normal">${i18n('set_new_password')}</button>`;
        h += `</div>`;

        const response = await fetch(window.api_origin + "/verify-pass-recovery-token", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: options.token,
            })
        });

        if( response.status !== 200 ) {
            if ( response.status === 429 ) {
                await UIAlert({
                    message: i18n('password_recovery_rate_limit', [], false),
                });
                return;
            }

            if ( response.status === 400 ) {
                await UIAlert({
                    message: i18n('password_recovery_token_invalid', [], false),
                });
                return;
            }

            await UIAlert({
                message: i18n('password_recovery_unknown_error', [], false),
            });
            return;
        }

        const response_data = await response.json();
        console.log('response_data', response_data);
        let time_remaining = response_data.time_remaining;


        const el_window = await UIWindow({
            title: 'Set New Password',
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
            onAppend: function(this_window){
                $(this_window).find(`.new-password`).get(0)?.focus({preventScroll:true});
            },
            window_class: 'window-publishWebsite',
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            }    
        })

        const expiration_clock = setInterval(() => {
            time_remaining -= 1;
            if( time_remaining <= 0 ) {
                clearInterval(expiration_clock);
                $(el_window).find('.change-password-btn').prop('disabled', true);
                $(el_window).find('.change-password-btn').html('Token Expired');
                return;
            }

            const svc_locale = globalThis.services.get('locale');
            const countdown = svc_locale.format_duration(time_remaining);

            $(el_window).find('.change-password-btn').html(`Set New Password (${countdown})`);
        }, 1000);
        el_window.on_close = () => {
            clearInterval(expiration_clock);
        };



        $(el_window).find('.change-password-btn').on('click', function(e){
            const new_password = $(el_window).find('.new-password').val();
            const confirm_new_password = $(el_window).find('.confirm-new-password').val();

            if(!new_password || !confirm_new_password){
                $(el_window).find('.form-error-msg').html('All fields are required.');
                $(el_window).find('.form-error-msg').fadeIn();
                return;
            }
            else if(new_password !== confirm_new_password){
                $(el_window).find('.form-error-msg').html('`New Password` and `Confirm New Password` do not match.');
                $(el_window).find('.form-error-msg').fadeIn();
                return;
            }

            // check password strength
            const pass_strength = check_password_strength(new_password);
            if(!pass_strength.overallPass){
                $(el_window).find('.form-error-msg').html(i18n('password_strength_error'));
                $(el_window).find('.form-error-msg').fadeIn();
                return;
            }
            
            $(el_window).find('.form-error-msg').hide();
        
            $.ajax({
                url: window.api_origin + "/set-pass-using-token",
                type: 'POST',
                async: true,
                contentType: "application/json",
                data: JSON.stringify({
                    password: new_password,
                    token: options.token,
                }),                    
                success: async function (data){
                    $(el_window).close();
                    await UIAlert({
                        message: 'Password changed successfully.',
                        body_icon: window.icons['c-check.svg'],
                        stay_on_top: true,
                        backdrop: true,
                        buttons:[
                            {
                                label: i18n('proceed_to_login'),
                                type: 'primary',
                            },
                        ],
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: false,
                        }
                    })
                    await UIWindowLogin({
                        reload_on_success: true,
                        window_options:{
                            has_head: false
                        }
                    });
                },
                error: function (err){
                    $(el_window).find('.form-error-msg').html(html_encode(err.responseText));
                    $(el_window).find('.form-error-msg').fadeIn();
                }
            });	
        })
    })
}

export default UIWindowNewPassword