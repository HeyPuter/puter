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
    
    if(options.reload_on_success === undefined)
        options.reload_on_success = true;
    
    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();

        const h = `
            <div class="auth-container">
                <div class="auth-logo-wrapper">
                    <img class="auth-logo" src="${window.icons['logo-white.svg']}">
                </div>
                <div class="auth-title">
                    <h1>${i18n('log_in')}</h1>
                </div>
                <div class="auth-form-wrapper">
                    <form class="auth-form login-form">
                        <div class="auth-error-msg login-error-msg"></div>
                        <div class="auth-form-group">
                            <label class="auth-label">${i18n('email_or_username')}</label>
                            <input type="text" class="auth-input email_or_username" ${options.email_or_username ? `value="${options.email_or_username}"` : ''} autocomplete="username"/>
                        </div>
                        <div class="auth-form-group">
                            <label class="auth-label">${i18n('password')}</label>
                            <input id="password-${internal_id}" class="auth-input password" type="${options.show_password ? 'text' : 'password'}" name="password" autocomplete="current-password"/>
                            <span class="auth-password-toggle" id="toggle-show-password-${internal_id}">
                                <img class="toggle-show-password-icon" src="${options.show_password ? window.icons['eye-closed.svg'] : window.icons['eye-open.svg']}">
                            </span>
                        </div>
                        <button type="submit" class="login-btn button button-primary button-block button-normal">${i18n('log_in')}</button>
                        <p class="auth-forgot-password"><span class="forgot-password-link">${i18n('forgot_pass_c2a')}</span></p>
                    </form>
                </div>
                ${(options.show_signup_button === undefined || options.show_signup_button) ? `
                    <div class="c2a-wrapper">
                        <button class="signup-c2a-clickable">${i18n('create_free_account')}</button>
                    </div>
                ` : ''}
            </div>
        `;
        
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
            width: 400,
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
            // Prevent default button behavior (important for async requests)
            e.preventDefault();
            
            // Clear previous error states
            $(el_window).find('.login-error-msg').hide();

            const email_username = $(el_window).find('.email_or_username').val();
            const password = $(el_window).find('.password').val();
            
            // Basic validation for email/username and password
            if(!email_username) {
                $(el_window).find('.login-error-msg').html(i18n('login_email_username_required'));
                $(el_window).find('.login-error-msg').fadeIn();
                return;
            }
            
            if(!password) {
                $(el_window).find('.login-error-msg').html(i18n('login_password_required'));
                $(el_window).find('.login-error-msg').fadeIn();
                return;
            }
            
            // Prepare data for the request
            let data;
            if(window.is_email(email_username)){
                data = JSON.stringify({ 
                    email: email_username, 
                    password: password,
                });
            } else {
                data = JSON.stringify({ 
                    username: email_username, 
                    password: password,
                });
            }
        
            let headers = {};
            if(window.custom_headers)
                headers = window.custom_headers;
    
            // Disable the login button to prevent multiple submissions
            $(el_window).find('.login-btn').prop('disabled', true);
    
            $.ajax({
                url: window.gui_origin + "/login",
                type: 'POST',
                async: true,
                headers: headers,
                contentType: "application/json",
                data: data,				
                success: async function (data){
                    // Keep the button disabled on success since we're redirecting or closing
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
                        sessionStorage.setItem('playChimeNextUpdate', 'yes');
                        window.onbeforeunload = null;
                        // Replace with a clean URL to prevent password leakage
                        const cleanUrl = window.location.origin + window.location.pathname;
                        window.location.replace(cleanUrl);
                    }else
                        resolve(true);
                    $(el_window).close();
                },
                error: function (err){                    
                    // First, ensure URL is clean in case of error (prevent password leakage)
                    if (window.location.search && (
                        window.location.search.includes('password=') || 
                        window.location.search.includes('username=') || 
                        window.location.search.includes('email=')
                    )) {
                        const cleanUrl = window.location.origin + window.location.pathname;
                        history.replaceState({}, document.title, cleanUrl);
                    }
                    
                    // Enable 'Log In' button
                    $(el_window).find('.login-btn').prop('disabled', false);
                    
                    // Handle captcha-specific errors
                    const errorText = err.responseText || '';
                    
                    // Try to parse error as JSON
                    try {
                        const errorJson = JSON.parse(errorText);
                        
                        // If it's a message in the JSON, use that
                        if (errorJson.message) {
                            $(el_window).find('.login-error-msg').html(errorJson.message);
                            $(el_window).find('.login-error-msg').fadeIn();
                            return;
                        }
                    } catch (e) {
                        // Not JSON, continue with text analysis
                    }
                    
                    // Fall back to original error handling
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
            
            // Instead of triggering the click event, process the login directly
            const email_username = $(el_window).find('.email_or_username').val();
            const password = $(el_window).find('.password').val();
            
            // Basic validation
            if(!email_username) {
                $(el_window).find('.login-error-msg').html(i18n('email_or_username_required') || 'Email or username is required');
                $(el_window).find('.login-error-msg').fadeIn();
                return false;
            }
            
            if(!password) {
                $(el_window).find('.login-error-msg').html(i18n('password_required') || 'Password is required');
                $(el_window).find('.login-error-msg').fadeIn();
                return false;
            }
            
            // Process login using the same function as the button click
            $(el_window).find('.login-btn').click();
            
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
