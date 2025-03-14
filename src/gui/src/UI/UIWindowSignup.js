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
import CaptchaView from './Components/CaptchaView.js'
import { isCaptchaRequired } from '../helpers/captchaHelper.js'

function UIWindowSignup(options){
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? true;
    options.has_head = options.has_head ?? true;
    options.send_confirmation_code  = options.send_confirmation_code ?? false;
    options.show_close_button = options.show_close_button ?? true;

    return new Promise(async (resolve) => {
        const internal_id = window.uuidv4();
        
        // Check if captcha is required for signup
        const captchaRequired = await isCaptchaRequired('signup');
        console.log('Signup captcha required:', captchaRequired);
        
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
                    // captcha placeholder - will be replaced with actual captcha component
                    h += `<div class="captcha-container"></div>`;
                    // captcha-specific error message
                    h += `<div class="captcha-error-msg" style="color: #e74c3c; font-size: 12px; margin-top: 5px; display: none;" aria-live="polite"></div>`;
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

        // Initialize the captcha component with the required state
        const captchaContainer = $(el_window).find('.captcha-container')[0];
        const captcha = CaptchaView({ 
            container: captchaContainer,
            required: captchaRequired
        });

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

        // Function to show captcha-specific error
        const showCaptchaError = (message) => {
            // Hide the general error message if shown
            $(el_window).find('.signup-error-msg').hide();
            
            // Show captcha-specific error
            const captchaError = $(el_window).find('.captcha-error-msg');
            captchaError.html(message);
            captchaError.fadeIn();
            
            // Add visual indication of error to captcha container
            $(captchaContainer).addClass('error');
            $(captchaContainer).css('border', '1px solid #e74c3c');
            $(captchaContainer).css('border-radius', '4px');
            $(captchaContainer).css('padding', '10px');
            
            // Focus on the captcha input for better UX
            setTimeout(() => {
                const captchaInput = $(captchaContainer).find('.captcha-input');
                if (captchaInput.length) {
                    captchaInput.focus();
                }
            }, 100);
        };

        // Function to clear captcha errors
        const clearCaptchaError = () => {
            $(el_window).find('.captcha-error-msg').hide();
            $(captchaContainer).removeClass('error');
            $(captchaContainer).css('border', '');
            $(captchaContainer).css('padding', '');
        };

        $(el_window).find('.signup-btn').on('click', function(e){
            // Clear previous error states
            $(el_window).find('.signup-error-msg').hide();
            clearCaptchaError();

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

            // Get captcha token and answer if required
            let captchaToken = null;
            let captchaAnswer = null;
            
            if (captcha.isRequired()) {
                captchaToken = captcha.getToken();
                captchaAnswer = captcha.getAnswer();
                
                // Check if the captcha component is properly loaded
                if (!captcha || !captchaContainer) {
                    $(el_window).find('.signup-error-msg').html(i18n('captcha_system_error') || 'Verification system error. Please refresh the page.');
                    $(el_window).find('.signup-error-msg').fadeIn();
                    return;
                }
                
                // Check if captcha token exists
                if (!captchaToken) {
                    showCaptchaError(i18n('captcha_load_error') || 'Could not load verification code. Please refresh the page or try again later.');
                    return;
                }
                
                // Check if the answer is provided
                if (!captchaAnswer) {
                    showCaptchaError(i18n('captcha_required'));
                    return;
                }
                
                // Check if answer meets minimum length requirement
                if (captchaAnswer.trim().length < 3) {
                    showCaptchaError(i18n('captcha_too_short') || 'Verification code answer is too short.');
                    return;
                }
                
                // Check if answer meets maximum length requirement
                if (captchaAnswer.trim().length > 12) {
                    showCaptchaError(i18n('captcha_too_long') || 'Verification code answer is too long.');
                    return;
                }
            }
            
            //xyzname
            let p102xyzname = $(el_window).find('.p102xyzname').val();

            // disable 'Create Account' button
            $(el_window).find('.signup-btn').prop('disabled', true);

            let headers = {};
            if(window.custom_headers)
                headers = window.custom_headers;

            // Include captcha in request only if required
            const requestData = {
                username: username,
                referral_code: window.referral_code,
                email: email,
                password: password,
                referrer: options.referrer ?? window.referrerStr,
                send_confirmation_code: options.send_confirmation_code,
                p102xyzname: p102xyzname,
                ...(captchaToken && captchaAnswer ? {
                    captchaToken: captchaToken,
                    captchaAnswer: captchaAnswer
                } : {})
            };

            $.ajax({
                url: window.gui_origin + "/signup",
                type: 'POST',
                async: true,
                headers: headers,
                contentType: "application/json",
                data: JSON.stringify(requestData),
                success: async function (data){
                    window.update_auth_data(data.token, data.user)
                    
                    //send out the login event
                    if(options.reload_on_success){
                        window.onbeforeunload = null;
                        // Replace with a clean URL to prevent sensitive data leakage
                        const cleanUrl = window.location.origin + window.location.pathname;
                        window.location.replace(cleanUrl);
                    }else if(options.send_confirmation_code){
                        $(el_window).close();
                        let is_verified = await UIWindowEmailConfirmationRequired({stay_on_top: true, has_head: true});
                        resolve(is_verified);
                    }else{
                        resolve(true);
                    }
                },
                error: function (err){
                    // re-enable 'Create Account' button so user can try again
                    $(el_window).find('.signup-btn').prop('disabled', false);

                    // Process error response
                    const errorText = err.responseText || '';
                    const errorStatus = err.status || 0;
                    
                    // Handle JSON error response
                    try {
                        // Try to parse error as JSON
                        const errorJson = JSON.parse(errorText);
                        
                        // Check for specific error codes
                        if (errorJson.code === 'captcha_required') {
                            // If captcha is now required but wasn't before, update the component
                            if (!captcha.isRequired()) {
                                captcha.setRequired(true);
                                showCaptchaError(i18n('captcha_now_required') || 'Verification is now required. Please complete the verification below.');
                            } else {
                                showCaptchaError(i18n('captcha_required') || 'Please enter the verification code');
                            }
                            return;
                        } 
                        
                        if (errorJson.code === 'captcha_invalid' || errorJson.code === 'captcha_error') {
                            showCaptchaError(i18n('captcha_invalid') || 'Invalid verification code');
                            // Refresh the captcha if it's invalid
                            captcha.reset();
                            return;
                        }
                        
                        // If it's a message in the JSON, use that
                        if (errorJson.message) {
                            $(el_window).find('.signup-error-msg').html(errorJson.message);
                            $(el_window).find('.signup-error-msg').fadeIn();
                            return;
                        }
                    } catch (e) {
                        // Not JSON, continue with text analysis
                    }
                    
                    // Check for specific captcha errors using more robust detection for text responses
                    if (
                        errorText.includes('captcha_required') || 
                        errorText.includes('Captcha verification required') ||
                        (errorText.includes('captcha') && errorText.includes('required'))
                    ) {
                        showCaptchaError(i18n('captcha_required'));
                        return;
                    } 
                    
                    if (
                        errorText.includes('captcha_invalid') || 
                        errorText.includes('Invalid captcha') ||
                        (errorText.includes('captcha') && (errorText.includes('invalid') || errorText.includes('incorrect')))
                    ) {
                        showCaptchaError(i18n('captcha_invalid'));
                        // Refresh the captcha if it's invalid
                        captcha.reset();
                        return;
                    }
                    
                    // Handle timeout specifically
                    if (errorJson?.code === 'response_timeout' || errorText.includes('timeout')) {
                        $(el_window).find('.signup-error-msg').html(i18n('server_timeout') || 'The server took too long to respond. Please try again.');
                        $(el_window).find('.signup-error-msg').fadeIn();
                        return;
                    }

                    // Default general error handling
                    $(el_window).find('.signup-error-msg').html(errorText || i18n('signup_error') || 'An error occurred during signup. Please try again.');
                    $(el_window).find('.signup-error-msg').fadeIn();
                },
                timeout: 30000 // Add a reasonable timeout
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