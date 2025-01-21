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
import UIWindowLogin from './UIWindowLogin.js'
import UIWindowEmailConfirmationRequired from './UIWindowEmailConfirmationRequired.js'
import check_password_strength from '../helpers/check_password_strength.js'

function UIWindowSignup(options){
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? false;
    options.has_head = options.has_head ?? true;
    options.send_confirmation_code  = options.send_confirmation_code ?? false;

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();
        let h = '';
        h += `<div style="margin: 0 auto; max-width: 500px; min-width: 400px;">`;
            // logo
            h += `<img src="${window.icons['logo-white.svg']}" style="width: 40px; height: 40px; margin: 0 auto; display: block; padding: 15px; background-color: blue; border-radius: 5px;">`;
            // close button
            if(!options.has_head && options.show_close_button !== false)
                h += `<div class="generic-close-window-button"> &times; </div>`;

            // Form
            h += `<div style="padding: 20px; border-bottom: 1px solid #ced7e1;">`;
                // title
                h += `<h1 class="signup-form-title">${i18n('create_free_account')}</h1>`;
                // signup form
                h += `<form class="signup-form">`;
                    // error msg
                    h += `<div class="signup-error-msg"></div>`;
                    // username
                    h += `<div style="overflow: hidden;">`;
                        h += `<label for="username-${internal_id}">${i18n('username')}</label>`;
                        h += `<input id="username-${internal_id}" value="${html_encode(options.username ?? '')}" class="username" type="text" autocomplete="username" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
                    h += `</div>`;
                    // email
                    h += `<div style="overflow: hidden; margin-top: 20px;">`;
                        h += `<label for="email-${internal_id}">${i18n('email')}</label>`;
                        h += `<input id="email-${internal_id}" value="${html_encode(options.email ?? '')}" class="email" type="email" autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
                    h += `</div>`;
                    // password
                    h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">`;
                        h += `<label for="password-${internal_id}">${i18n('password')}</label>`;
                        h += `<input id="password-${internal_id}" class="password" type="password" name="password" autocomplete="new-password" />`;
                    h += `</div>`;
                    // bot trap - if this value is submitted server will ignore the request
                    h += `<input type="text" name="p102xyzname" class="p102xyzname" value="">`;

                    // terms and privacy
                    h += `<p class="signup-terms">${i18n('tos_fineprint', [], false)}</p>`;
                    // Create Account
                    h += `<button class="signup-btn button button-primary button-block button-normal">${i18n('create_free_account')}</button>`
                h += `</form>`;
            h += `</div>`;
            // login link
            // create account link
            h += `<div class="c2a-wrapper" style="padding:20px;">`;
                h += `<button class="login-c2a-clickable">${i18n('log_in')}</button>`;
            h += `</div>`;
        h += `</div>`;

        const el_window = await UIWindow({
            title: null,
            app: 'signup',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            draggable_body: false,
            has_head: true,
            selectable_body: false,
            allow_context_menu: false,
            is_draggable: false,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            ...options.window_options,
            // width: 350,
            dominant: false,
            center: true,
            onAppend: function(el_window){
                $(el_window).find(`.username`).get(0).focus({preventScroll:true});
            },
            window_class: 'window-signup',
            window_css:{
                height: 'initial',
            }, 
            body_css: {
                width: 'initial',
                'background-color': 'white',
                'backdrop-filter': 'blur(3px)',
                'display': 'flex',
                'flex-direction': 'column',
                'justify-content': 'center',
                'align-items': 'center',
                padding: '30px 10px 10px 10px',
            }
        })

        $(el_window).find('.login-c2a-clickable').on('click', async function(e){
            $('.login-c2a-clickable').parents('.window').close();
            const login = await UIWindowLogin({
                referrer: options.referrer, 
                reload_on_success: options.reload_on_success,
                window_options: options.window_options,
                show_close_button: options.show_close_button,
                send_confirmation_code: options.send_confirmation_code,
                show_password: false,
            });
            if(login)
                resolve(true);
        })

        $(el_window).find('.signup-btn').on('click', function(e){
            //Username
            let username = $(el_window).find('.username').val();

            if(!username){
                $(el_window).find('.signup-error-msg').html(i18n('username_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
        
            //Email
            let email = $(el_window).find('.email').val();

            // must have an email
            if(!email){
                $(el_window).find('.signup-error-msg').html(i18n('email_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
            // must be a valid email
            else if(!window.is_email(email)){
                $(el_window).find('.signup-error-msg').html(i18n('email_invalid'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }

            //Password
            let password = $(el_window).find('.password').val();

            // must have a password
            if(!password){
                $(el_window).find('.signup-error-msg').html(i18n('password_required'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }
            // check password strength
            const pass_strength = check_password_strength(password);
            if(!pass_strength.overallPass){
                $(el_window).find('.signup-error-msg').html(i18n('password_strength_error'));
                $(el_window).find('.signup-error-msg').fadeIn();
                return;
            }

            //xyzname
            let p102xyzname = $(el_window).find('.p102xyzname').val();

            // disable 'Create Account' button
            $(el_window).find('.signup-btn').prop('disabled', true);

            let headers = {};
            if(window.custom_headers)
                headers = window.custom_headers;

            $.ajax({
                url: window.gui_origin + "/signup",
                type: 'POST',
                async: true,
                headers: headers,
                contentType: "application/json",
                data: JSON.stringify({ 
                    username: username,
                    referral_code: window.referral_code,
                    email: email, 
                    password: password,
                    referrer: options.referrer ?? window.referrerStr,
                    send_confirmation_code: options.send_confirmation_code,
                    p102xyzname: p102xyzname,
                }),
                success: async function (data){
                    window.update_auth_data(data.token, data.user)
                    
                    //send out the login event
                    if(options.reload_on_success){
                        window.onbeforeunload = null;
                        window.location.replace('/');
                    }else if(options.send_confirmation_code){
                        $(el_window).close();
                        let is_verified = await UIWindowEmailConfirmationRequired({stay_on_top: true, has_head: true});
                        resolve(is_verified);
                    }else{
                        resolve(true);
                    }
                },
                error: function (err){
                    $(el_window).find('.signup-error-msg').html(err.responseText);
                    $(el_window).find('.signup-error-msg').fadeIn();
                    // re-enable 'Create Account' button so user can try again
                    $(el_window).find('.signup-btn').prop('disabled', false);
                }
            });
        })

        $(el_window).find('.signup-form').on('submit', function(e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        })
            
        //remove login window
        $('.signup-c2a-clickable').parents('.window').close();
    })
}

export default UIWindowSignup