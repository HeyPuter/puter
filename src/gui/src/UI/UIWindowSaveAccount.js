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
import UIWindowEmailConfirmationRequired from './UIWindowEmailConfirmationRequired.js'

async function UIWindowSaveAccount(options){
    const internal_id = window.uuidv4();
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? false;
    options.send_confirmation_code = options.send_confirmation_code ?? false;

    return new Promise(async (resolve) => {
        let h = '';
        h += `<div>`;
            h += `<div class="generic-close-window-button disable-user-select" style="z-index:1;"> &times; </div>`;

            // success
            h += `<div class="save-account-success">`;
                h += `<img src="${html_encode(window.icons['c-check.svg'])}" style="width:50px; height:50px; display: block; margin:10px auto; margin-bottom: 30px;">`;
                h += `<p style="text-align:center; margin-bottom:30px;">${i18n('session_saved')}</p>`;
                h += `<button class="button button-action button-block save-account-success-ok-btn">${i18n('ok')}</button>`
            h+= `</div>`;
    
            // form
            h += `<div class="save-account-form" style="padding: 20px; border-bottom: 1px solid #ced7e1; width: 100%; box-sizing: border-box;">`;
                // title
                h += `<h1 class="signup-form-title" style="margin-bottom:0;">${i18n('create_account')}</h1>`;
                // description
                h += `<p class="create-account-desc">${options.message ?? i18n('save_session_c2a')}</p>`;
                // signup form
                h += `<form class="signup-form">`;
                    // error msg
                    h += `<div class="signup-error-msg"></div>`;
                    // username
                    h += `<div style="overflow: hidden;">`;
                        h += `<label for="username-${internal_id}">${i18n('username')}</label>`;
                        h += `<input id="username-${internal_id}" class="username" value="${options.default_username ?? ''}" type="text" autocomplete="username" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
                    h += `</div>`;
                    // email
                    h += `<div style="overflow: hidden; margin-top: 20px;">`;
                        h += `<label for="email-${internal_id}">${i18n('email')}</label>`;
                        h += `<input id="email-${internal_id}" class="email" type="email" autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
                    h += `</div>`;
                    // password
                    h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px;">`;
                        h += `<label for="password-${internal_id}">${i18n('password')}</label>`;
                        h += `<input id="password-${internal_id}" class="password" type="password" name="password" autocomplete="new-password" />`;
                    h += `</div>`;
                    // bot trap - if this value is submitted server will ignore the request
                    h += `<input type="text" name="p102xyzname" class="p102xyzname" value="">`;
                    // Create Account
                    h += `<button class="signup-btn button button-primary button-block button-normal">${i18n('create_account')}</button>`
                h += `</form>`;
            h += `</div>`;
        h += `</div>`;

        const el_window = await UIWindow({
            title: null,
            icon: null,
            uid: null,
            app: 'save-account',
            single_instance: true,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_draggable: true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            width: 350,
            dominant: true,
            show_in_taskbar: false,
            ...options.window_options,
            onAppend: function(this_window){
                if(options.default_username)
                    $(this_window).find('.email').get(0).focus({preventScroll:true});
                else
                    $(this_window).find('.username').get(0).focus({preventScroll:true});
            },
            window_class: 'window-save-account',
            window_css:{
                height: 'initial',
            },
            on_close: ()=>{
                resolve(false)
            },
            body_css: {
                width: 'initial',
                'background-color': 'rgba(231, 238, 245, .95)',
                'backdrop-filter': 'blur(3px)',
            }    
        })

        $(el_window).find('.signup-btn').on('click', function(e){
            // todo do some basic validation client-side

            //Username
            let username = $(el_window).find('.username').val();
        
            //Email
            let email = $(el_window).find('.email').val();
        
            //Password
            let password = $(el_window).find('.password').val();
            
            // disable 'Create Account' button
            $(el_window).find('.signup-btn').prop('disabled', true);

            // blur all inputs, blinking cursor is annoying when enter is pressed and form is submitted
            $(el_window).find('.username').blur();
            $(el_window).find('.email').blur();
            $(el_window).find('.password').blur();

            // disable form inputs
            $(el_window).find('input').prop('disabled', true);

            $.ajax({
                url: window.api_origin + "/save_account",
                type: 'POST',
                async: true,
                contentType: "application/json",
                data: JSON.stringify({ 
                    username: username, 
                    email: email, 
                    password: password,
                    referrer: options.referrer,
                    send_confirmation_code: options.send_confirmation_code,
                }),
                headers: {
                    "Authorization": "Bearer "+window.auth_token
                },        
                success: async function (data){
                    window.dispatchEvent(new CustomEvent('account-saved', { detail: { data: data} }));

                    window.update_auth_data(data.token, data.user)

                    //close this window
                    if(data.user.email_confirmation_required){
                        let is_verified = await UIWindowEmailConfirmationRequired({
                            stay_on_top: true, 
                            has_head: true
                        });
                        resolve(is_verified);
                    }else{
                        resolve(true);
                    }

                    $(el_window).find('.save-account-form').hide(100, ()=>{
                        $(el_window).find('.save-account-success').show(100);
                    })

                    $(el_window).find('input').prop('disabled', false);
                },
                error: function (err){
                    $(el_window).find('.signup-error-msg').html(html_encode(err.responseText));
                    $(el_window).find('.signup-error-msg').fadeIn();
                    // re-enable 'Create Account' button
                    $(el_window).find('.signup-btn').prop('disabled', false);
                    $(el_window).find('input').prop('disabled', false);
                }
            });
        })

        $(el_window).find('.signup-form').on('submit', function(e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        })
            
        $(el_window).find('.save-account-success-ok-btn').on('click', ()=>{
            $(el_window).close();
        })

        //remove login window
        $(el_window).find('.signup-c2a-clickable').parents('.window').close();
    })
}

def(UIWindowSaveAccount, 'ui.UISaveAccount');

export default UIWindowSaveAccount