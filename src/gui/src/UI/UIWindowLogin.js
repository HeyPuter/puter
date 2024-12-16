/**
 * Copyright (C) 2024 Puter Technologies Inc.
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
import UIWindowSignup from './UIWindowSignup.js'
import UIWindowRecoverPassword from './UIWindowRecoverPassword.js'
import TeePromise from '../util/TeePromise.js';
import UIComponentWindow from './UIComponentWindow.js';
import Flexer from './Components/Flexer.js';
import CodeEntryView from './Components/CodeEntryView.js';
import JustHTML from './Components/JustHTML.js';
import StepView from './Components/StepView.js';
import Button from './Components/Button.js';
import RecoveryCodeEntryView from './Components/RecoveryCodeEntryView.js';

async function UIWindowLogin(options){
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? false;
    options.has_head = options.has_head ?? true;
    options.send_confirmation_code = options.send_confirmation_code ?? false;
    options.show_password = options.show_password ?? false;

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();
        let h = ``;
        h += `<div style="max-width: 500px; min-width: 340px;">`;
            if(!options.has_head && options.show_close_button !== false)
                h += `<div class="generic-close-window-button"> &times; </div>`;
            h += `<div style="padding: 20px; border-bottom: 1px solid #ced7e1; width: 100%; box-sizing: border-box;">`;
                // title
                h += `<h1 class="login-form-title">${i18n('log_in')}</h1>`;
                // login form
                h += `<form class="login-form">`;
                    // error msg
                    h += `<div class="login-error-msg"></div>`;
                    // username/email
                    h += `<div style="overflow: hidden;">`;
                        h += `<label for="email_or_username-${internal_id}">${i18n('email_or_username')}</label>`;
                        h += `<input id="email_or_username-${internal_id}" class="email_or_username" type="text" name="email_or_username" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false" autocomplete="username"/>`;
                    h += `</div>`;
                    // password with conditional type based based on options.show_password
                    h += `<div style="overflow: hidden; margin-top: 20px; margin-bottom: 20px; position: relative;">`;
                    h += `<label for="password-${internal_id}">${i18n('password')}</label>`;
                    h += `<input id="password-${internal_id}" class="password" type="${options.show_password ? "text" : "password"}" name="password" autocomplete="current-password"/>`;
                    // show/hide icon
                    h += `<span style="position: absolute; right: 5%; top: 50%; cursor: pointer;" id="toggle-show-password-${internal_id}">
                                <img class="toggle-show-password-icon" src="${options.show_password ? window.icons["eye-closed.svg"] : window.icons["eye-open.svg"]}" width="20" height="20">
                            </span>`;
                    h += `</div>`;
                    // login
                    h += `<button class="login-btn button button-primary button-block button-normal">${i18n('log_in')}</button>`;
                    // password recovery
                    h += `<p style="text-align:center; margin-bottom: 0;"><span class="forgot-password-link">${i18n('forgot_pass_c2a')}</span></p>`;
                h += `</form>`;
            h += `</div>`;
            // create account link
            if(options.show_signup_button === undefined || options.show_signup_button){
                h += `<div class="c2a-wrapper" style="padding:20px;">`;
                    h += `<button class="signup-c2a-clickable">${i18n('create_free_account')}</button>`;
                h += `</div>`;
            }
        h += `</div>`;
        
        const el_window = await UIWindow({
            title: null,
            app: 'login',
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
            ...options.window_options,
            width: 350,
            dominant: true,
            on_close: ()=>{
                resolve(false)
            },
            onAppend: function(this_window){
                $(this_window).find(`.email_or_username`).get(0).focus({preventScroll:true});
            },
            window_class: 'window-login',
            window_css:{
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
            }    
        })

        $(el_window).find('.forgot-password-link').on('click', function(e){
            UIWindowRecoverPassword({
                window_options: {
                    backdrop: true,
                    stay_on_top: isMobile.phone,
                    close_on_backdrop_click: false,
                }
            });
        })

        $(el_window).find('.login-btn').on('click', function(e){
            const email_username = $(el_window).find('.email_or_username').val();
            const password = $(el_window).find('.password').val();
            let data;
        
            if(window.is_email(email_username)){
                data = JSON.stringify({ 
                    email: email_username, 
                    password: password
                })
            }else{
                data = JSON.stringify({ 
                    username: email_username, 
                    password: password
                })
            }
        
            $(el_window).find('.login-error-msg').hide();
        
            let headers = {};
            if(window.custom_headers)
                headers = window.custom_headers;
    
            $.ajax({
                url: window.gui_origin + "/login",
                type: 'POST',
                async: false,
                headers: headers,
                contentType: "application/json",
                data: data,				
                success: async function (data){
                    let p = Promise.resolve();
                    if ( data.next_step === 'otp' ) {
                        p = new TeePromise();
                        let code_entry;
                        let recovery_entry;
                        let win;
                        let stepper;
                        const otp_option = new Flexer({
                            children: [
                                new JustHTML({
                                    html: /*html*/`
                                        <h3 style="text-align:center; font-weight: 500; font-size: 20px;">${
                                            i18n('login2fa_otp_title')
                                        }</h3>
                                        <p style="text-align:center; padding: 0 20px;">${
                                            i18n('login2fa_otp_instructions')
                                        }</p>
                                    `
                                }),
                                new CodeEntryView({
                                    _ref: me => code_entry = me,
                                    async [`property.value`] (value, { component }) {
                                        let error_i18n_key = 'something_went_wrong';
                                        if ( ! value ) return;
                                        try {
                                            const resp = await fetch(`${window.gui_origin}/login/otp`, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({
                                                    token: data.otp_jwt_token,
                                                    code: value,
                                                }),
                                            });

                                            if ( resp.status === 429 ) {
                                                error_i18n_key = 'confirm_code_generic_too_many_requests';
                                                throw new Error('expected error');
                                            }

                                            const next_data = await resp.json();

                                            if ( ! next_data.proceed ) {
                                                error_i18n_key = 'confirm_code_generic_incorrect';
                                                throw new Error('expected error');
                                            }

                                            component.set('is_checking_code', false);

                                            data = next_data;

                                            $(win).close();
                                            p.resolve();
                                        } catch (e) {
                                            // keeping this log; useful in screenshots
                                            console.log('2FA Login Error', e);
                                            component.set('error', i18n(error_i18n_key));
                                            component.set('is_checking_code', false);
                                        }
                                    }
                                }),
                                new Button({
                                    label: i18n('login2fa_use_recovery_code'),
                                    style: 'link',
                                    on_click: async () => {
                                        stepper.next();
                                        code_entry.set('value', undefined);
                                        code_entry.set('error', undefined);
                                    }
                                })
                            ],
                            ['event.focus'] () {
                                code_entry.focus();
                            }
                        });
                        const recovery_option = new Flexer({
                            children: [
                                new JustHTML({
                                    html: /*html*/`
                                        <h3 style="text-align:center; font-weight: 500; font-size: 20px;">${
                                            i18n('login2fa_recovery_title')
                                        }</h3>
                                        <p style="text-align:center; padding: 0 20px;">${
                                            i18n('login2fa_recovery_instructions')
                                        }</p>
                                    `
                                }),
                                new RecoveryCodeEntryView({
                                    _ref: me => recovery_entry = me,
                                    async [`property.value`] (value, { component }) {
                                        let error_i18n_key = 'something_went_wrong';
                                        if ( ! value ) return;
                                        try {
                                            const resp = await fetch(`${window.api_origin}/login/recovery-code`, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({
                                                    token: data.otp_jwt_token,
                                                    code: value,
                                                }),
                                            });

                                            if ( resp.status === 429 ) {
                                                error_i18n_key = 'confirm_code_generic_too_many_requests';
                                                throw new Error('expected error');
                                            }

                                            const next_data = await resp.json();

                                            if ( ! next_data.proceed ) {
                                                error_i18n_key = 'confirm_code_generic_incorrect';
                                                throw new Error('expected error');
                                            }

                                            data = next_data;

                                            $(win).close();
                                            p.resolve();
                                        } catch (e) {
                                            // keeping this log; useful in screenshots
                                            console.log('2FA Recovery Error', e);
                                            component.set('error', i18n(error_i18n_key));
                                        }
                                    }
                                }),
                                new Button({
                                    label: i18n('login2fa_recovery_back'),
                                    style: 'link',
                                    on_click: async () => {
                                        stepper.back();
                                        recovery_entry.set('value', undefined);
                                        recovery_entry.set('error', undefined);
                                    }
                                })
                            ]
                        });
                        const component = stepper = new StepView({
                            children: [otp_option, recovery_option],
                        });
                        win = await UIComponentWindow({
                            component,
                            width: 500,
                            height: 410,
                            backdrop: true,
                            is_resizable: false,
                            is_draggable: true,
                            stay_on_top: true,
                            center: true,
                            window_class: 'window-login-2fa',
                            body_css: {
                                width: 'initial',
                                height: '100%',
                                'background-color': 'rgb(245 247 249)',
                                'backdrop-filter': 'blur(3px)',
                                padding: '20px',
                            },
                        });
                        component.focus();
                    }

                    await p;

                    window.update_auth_data(data.token, data.user);
                    
                    if(options.reload_on_success){
                        window.onbeforeunload = null;
                        window.location.replace('/');
                    }else
                        resolve(true);
                    $(el_window).close();
                },
                error: function (err){
                    const $errorMessage = $(el_window).find('.login-error-msg');
                    if (err.status === 404) {
                        // Don't include the whole 404 page
                        $errorMessage.html(`Error 404: "${window.gui_origin}/login" not found`);
                    } else if (err.responseText) {
                        $errorMessage.html(html_encode(err.responseText));
                    } else {
                        // No message was returned. *Probably* this means we couldn't reach the server.
                        // If this is a self-hosted instance, it's probably a configuration issue.
                        if (window.app_domain !== 'puter.com') {
                            $errorMessage.html(`<div style="text-align: left;">
                                <p>Error reaching "${window.gui_origin}/login". This is likely to be a configuration issue.</p>
                                <p>Make sure of the following:</p>
                                <ul style="padding-left: 2em;">
                                    <li><code>domain</code> in config.json is set to the domain you're using to access puter</li>
                                    <li>DNS resolves for the domain, and the <code>api.</code> subdomain on that domain</li>
                                    <li><code>http_port</code> is set to the port Puter is listening on (<code>auto</code> will use <code>4100</code> unless that port is in use)</li>
                                    <li><code>pub_port</code> is set to the external port (ex: <code>443</code> if you're using a reverse proxy that serves over https)</li>
                                </ul>
                            </div>`);
                        } else {
                            $errorMessage.html(`Failed to log in: Error ${html_encode(err.status)}`);
                        }
                    }
                    $(el_window).find('.login-error-msg').fadeIn();
                }
            });	
        })  

        $(el_window).find('.login-form').on('submit', function(e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        })

        $(el_window).find('.signup-c2a-clickable').on('click', async function(e){
            //destroy this window
            $(el_window).close();
            // create Signup window
            const signup = await UIWindowSignup({
                referrer: options.referrer,
                show_close_button: options.show_close_button,
                reload_on_success: options.reload_on_success,
                window_options: options.window_options,
                send_confirmation_code: options.send_confirmation_code,
            });
            if(signup)
                resolve(true);
        })

        $(el_window).find(`#toggle-show-password-${internal_id}`).on("click", function (e) {
            options.show_password = !options.show_password;
            // hide/show password and update icon
            $(el_window).find(".password").attr("type", options.show_password ? "text" : "password");
            $(el_window).find(".toggle-show-password-icon").attr("src", options.show_password ? window.icons["eye-closed.svg"] : window.icons["eye-open.svg"],
          )
      })
    }) 
}

export default UIWindowLogin
