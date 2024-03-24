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

import UIWindow from '../UIWindow.js'
import UIWindowChangePassword from '../UIWindowChangePassword.js'
// import UIWindowChangeEmail from './UIWindowChangeEmail.js'
// import UIWindowDeleteAccount from './UIWindowDeleteAccount.js'
import UIWindowChangeUsername from '../UIWindowChangeUsername.js'
import changeLanguage from "../../i18n/i18nchangeLanguage.js"


async function UIWindowSettings(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        let h = '';

        h += `<div class="settings-container">`;
        h += `<div class="settings">`;
            // side bar
            h += `<div class="settings-sidebar disable-user-select">`;
                h += `<div class="settings-sidebar-item disable-user-select active" data-settings="about" style="background-image: url(${icons['logo-outline.svg']});">${i18n('about')}</div>`;
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="usage" style="background-image: url(${icons['speedometer-outline.svg']});">${i18n('usage')}</div>`;
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="account" style="background-image: url(${icons['user.svg']});">${i18n('account')}</div>`;
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="language" style="background-image: url(${icons['language.svg']});">${i18n('language')}</div>`;
            h += `</div>`;

            // content
            h += `<div class="settings-content-container">`;
                // About
                h += `<div class="settings-content active" data-settings="about">`;
                    h += `<div class="about-container">`
                    h += `<div class="about" style="text-align: center;">
                            <a href="https://puter.com" target="_blank" class="logo"><img src="/images/logo.png"></a>
                            <p class="description">Puter is a privacy-first personal cloud to keep all your files, apps, and games in one
                                secure place, accessible from anywhere at any time.</p>
                            <p class="links">
                                <a href="mailto:hey@puter.com" target="_blank">hey@puter.com</a>
                                <span style="color: #CCC;">•</span>
                                <a href="https://docs.puter.com" target="_blank">Developers</a>
                                <span style="color: #CCC;">•</span>
                                <a href="https://status.puter.com" target="_blank">Status</a>
                                <span style="color: #CCC;">•</span>
                                <a href="https://puter.com/terms" target="_blank">Terms</a>
                                <span style="color: #CCC;">•</span>
                                <a href="https://puter.com/privacy" target="_blank">Privacy</a>
                                <span style="color: #CCC;">•</span>
                                <a href="#" class="show-credits">Credits</a>
                            </p>
                            <div class="social-links">
                                <a href="https://twitter.com/HeyPuter/" target="_blank">
                                    <svg viewBox="0 0 24 24" aria-hidden="true" style="opacity: 0.7;"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g></svg>
                                </a>
                                <a href="https://github.com/HeyPuter/" target="_blank">
                                    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48px" height="48px" viewBox="0 0 48 48">
                                        <g transform="translate(0, 0)">
                                            <path fill-rule="evenodd" clip-rule="evenodd" fill="#5a606b" d="M24,0.6c-13.3,0-24,10.7-24,24c0,10.6,6.9,19.6,16.4,22.8 c1.2,0.2,1.6-0.5,1.6-1.2c0-0.6,0-2.1,0-4.1c-6.7,1.5-8.1-3.2-8.1-3.2c-1.1-2.8-2.7-3.5-2.7-3.5c-2.2-1.5,0.2-1.5,0.2-1.5 c2.4,0.2,3.7,2.5,3.7,2.5c2.1,3.7,5.6,2.6,7,2c0.2-1.6,0.8-2.6,1.5-3.2c-5.3-0.6-10.9-2.7-10.9-11.9c0-2.6,0.9-4.8,2.5-6.4 c-0.2-0.6-1.1-3,0.2-6.4c0,0,2-0.6,6.6,2.5c1.9-0.5,4-0.8,6-0.8c2,0,4.1,0.3,6,0.8c4.6-3.1,6.6-2.5,6.6-2.5c1.3,3.3,0.5,5.7,0.2,6.4 c1.5,1.7,2.5,3.8,2.5,6.4c0,9.2-5.6,11.2-11,11.8c0.9,0.7,1.6,2.2,1.6,4.4c0,3.2,0,5.8,0,6.6c0,0.6,0.4,1.4,1.7,1.2 C41.1,44.2,48,35.2,48,24.6C48,11.3,37.3,0.6,24,0.6z">
                                            </path>
                                        </g>
                                    </svg>
                                </a>
                                <a href="https://discord.gg/PQcx7Teh8u" target="_blank">
                                    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48px" height="48px" viewBox="0 0 48 48"><g transform="translate(0, 0)"><path d="M19.837,20.3a2.562,2.562,0,0,0,0,5.106,2.562,2.562,0,0,0,0-5.106Zm8.4,0a2.562,2.562,0,1,0,2.346,2.553A2.45,2.45,0,0,0,28.232,20.3Z" fill="#444444" data-color="color-2"></path> <path d="M39.41,1H8.59A4.854,4.854,0,0,0,4,6V37a4.482,4.482,0,0,0,4.59,4.572H34.672l-1.219-4.255L36.4,40.054,39.18,42.63,44,47V6A4.854,4.854,0,0,0,39.41,1ZM30.532,31.038s-.828-.989-1.518-1.863a7.258,7.258,0,0,0,4.163-2.737A13.162,13.162,0,0,1,30.532,27.8a15.138,15.138,0,0,1-3.335.989,16.112,16.112,0,0,1-5.957-.023,19.307,19.307,0,0,1-3.381-.989,13.112,13.112,0,0,1-2.622-1.357,7.153,7.153,0,0,0,4.025,2.714c-.69.874-1.541,1.909-1.541,1.909-5.083-.161-7.015-3.5-7.015-3.5a30.8,30.8,0,0,1,3.312-13.409,11.374,11.374,0,0,1,6.463-2.415l.23.276a15.517,15.517,0,0,0-6.049,3.013s.506-.276,1.357-.667a17.272,17.272,0,0,1,5.221-1.449,2.266,2.266,0,0,1,.391-.046,19.461,19.461,0,0,1,4.646-.046A18.749,18.749,0,0,1,33.2,15.007a15.307,15.307,0,0,0-5.727-2.921l.322-.368a11.374,11.374,0,0,1,6.463,2.415A30.8,30.8,0,0,1,37.57,27.542S35.615,30.877,30.532,31.038Z" fill="#444444"></path></g></svg>            </a>
                                <a href="https://www.linkedin.com/company/puter/" target="_blank">
                                    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48px" height="48px" viewBox="0 0 48 48">
                                        <g transform="translate(0, 0)">
                                            <path fill="#5a606b" d="M46,0H2C0.9,0,0,0.9,0,2v44c0,1.1,0.9,2,2,2h44c1.1,0,2-0.9,2-2V2C48,0.9,47.1,0,46,0z M14.2,40.9H7.1V18 h7.1V40.9z M10.7,14.9c-2.3,0-4.1-1.8-4.1-4.1c0-2.3,1.8-4.1,4.1-4.1c2.3,0,4.1,1.8,4.1,4.1C14.8,13,13,14.9,10.7,14.9z M40.9,40.9 h-7.1V29.8c0-2.7,0-6.1-3.7-6.1c-3.7,0-4.3,2.9-4.3,5.9v11.3h-7.1V18h6.8v3.1h0.1c0.9-1.8,3.3-3.7,6.7-3.7c7.2,0,8.5,4.7,8.5,10.9 V40.9z">
                                            </path>
                                        </g>
                                    </svg>
                                </a>
                            </div>
                        </div>
                        <div class="version"></div>

                        <dialog class="credits">
                            <div class="credit-content">
                                <p style="margin: 0; font-size: 18px; text-align: center;">Open Source Software and Content</p>
                                <div style="max-height: 300px; overflow-y: scroll;">
                                    <ul style="padding-left: 25px; padding-top:15px;">
                                        <li>FileSaver.js <a target="_blank" href="https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md">license</a></li>
                                        <li>html-entities <a target="_blank" href="https://github.com/mdevils/html-entities/blob/master/LICENSE">license</a></li>
                                        <li>iro.js <a target="_blank" href="https://github.com/jaames/iro.js/blob/master/LICENSE.txt">license</a></li>
                                        <li>jQuery <a target="_blank" href="https://jquery.org/license/">license</a></li>
                                        <li>jQuery-dragster <a target="_blank" href="https://github.com/catmanjan/jquery-dragster/blob/master/LICENSE">license</a></li>
                                        <li>jQuery UI <a target="_blank" href="https://jquery.org/license/">license</a></li>
                                        <li>lodash <a target="_blank" href="https://lodash.com/license">license</a></li>
                                        <li>mime <a target="_blank" href="https://github.com/broofa/mime/blob/main/LICENSE">license</a></li>
                                        <li>qrcodejs <a target="_blank" href="https://github.com/davidshimjs/qrcodejs/blob/master/LICENSE">license</a></li>
                                        <li>Selection <a target="_blank" href="https://github.com/simonwep/selection/blob/master/LICENSE">license</a></li>
                                        <li>socket.io <a target="_blank" href="https://github.com/socketio/socket.io/blob/main/LICENSE">license</a></li>
                                        <li>Wallpaper by <a target="_blank" href="https://unsplash.com/@fakurian?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash">Milad Fakurian</a> on <a target="_blank" href="https://unsplash.com/photos/blue-orange-and-yellow-wallpaper-E8Ufcyxz514?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash">Unsplash</a></li>
                                    </ul>
                                </div>
                            </div>
                        </dialog>                    
                        `;
                    h += `</div>`;
                h += `</div>`;

                // Usage
                h += `<div class="settings-content" data-settings="usage">`;
                    h += `<h1>Usage</h1>`;
                    h += `<div class="driver-usage">
                            <h3 style="margin-bottom: 5px; font-size: 14px;">Storage Usage</h3>
                            <div style="font-size: 13px; margin-bottom: 3px;">
                                <span id="storage-used"></span>
                                <span> used of </span>
                                <span id="storage-capacity"></span>
                            </div>
                            <div id="storage-bar-wrapper">
                                <span id="storage-used-percent"></span>
                                <div id="storage-bar"></div>
                            </div>
                        </div>`
                h += `</div>`;

                // Account
                h += `<div class="settings-content" data-settings="account">`;
                    h += `<h1>Account</h1>`;
                    // change password button
                    h += `<div class="settings-card">`;
                        h += `<strong>Password</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button change-password" style="float:right;">Change Password</button>`;
                        h += `</div>`;
                    h += `</div>`;

                    // change email button
                    if(user.email){
                        h += `<div class="settings-card">`;
                            h += `<strong>${user.email}</strong>`;
                            h += `<div style="flex-grow:1;">`;
                                h += `<button class="button change-email" style="margin-bottom: 10px;">Change Email</button>`;
                            h += `</div>`;
                        h += `</div>`;
                    }

                    // change username button
                    h += `<div class="settings-card">`;
                        h += `<div>`;
                            h += `<strong style="display:block;">Username</strong>`;
                            h += `<span style="display:block; margin-top:5px;">${user.username}</span>`;
                        h += `</div>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button change-username" style="float:right;">Change Username</button>`;
                        h += `</div>`
                    h += `</div>`;

                    // delete account button
                    h += `<div class="settings-card settings-card-danger">`;
                        h += `<strong style="display: inline-block;">Delete Account</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button button-danger delete-account" style="float:right;">Delete Account</button>`;
                        h += `</div>`;
                    h += `</div>`;

                h += `</div>`;

                // Language
                h += `<div class="settings-content" data-settings="language">`;
                    h += `<h1>Language</h1>`;
                    // search
                    h += `<div class="search-container" style="margin-bottom: 10px;">`;
                        h += `<input type="text" class="search" placeholder="Search">`;
                    h += `</div>`;
                    // list of languages
                    const available_languages = listSupportedLanguages();
                    h += `<div class="language-list">`;
                        for (let lang of available_languages) {
                            h += `<div class="language-item ${window.locale === lang.code ? 'active': ''}" data-lang="${lang.code}" data-english-name="${html_encode(lang.english_name)}">${lang.name}</div>`;
                        }
                    h += `</div>`;

                h += `</div>`;

            h += `</div>`;
        h += `</div>`;
        h += `</div>`;

        h += ``;

        const el_window = await UIWindow({
            title: 'Settings',
            app: 'settings',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: false,
            width: 800,
            height: 500,
            height: 'auto',
            dominant: true,
            show_in_taskbar: false,
            draggable_body: false,
            onAppend: function(this_window){
            },
            window_class: 'window-settings',
            body_css: {
                width: 'initial',
                height: '100%',
                overflow: 'auto'
            }
        });

        $.ajax({
            url: api_origin + "/drivers/usage",
            type: 'GET',
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer " + auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                },
            },
            success: function (res) {
                let h = ''; // Initialize HTML string for driver usage bars
            
                // Loop through user services
                res.user.forEach(service => {
                    const { monthly_limit, monthly_usage } = service;
                    let usageDisplay = ``;
            
                    if (monthly_limit !== null) {
                        let usage_percentage = (monthly_usage / monthly_limit * 100).toFixed(0);
                        usage_percentage = usage_percentage > 100 ? 100 : usage_percentage; // Cap at 100%
                        usageDisplay = `
                            <div class="driver-usage" style="margin-bottom: 10px;">
                                <h3 style="margin-bottom: 5px; font-size: 14px;">${service.service['driver.interface']} (${service.service['driver.method']}):</h3>
                                <span style="font-size: 13px; margin-bottom: 3px;">${monthly_usage} used of ${monthly_limit}</span>
                                <div class="usage-progbar-wrapper" style="width: 100%;">
                                    <div class="usage-progbar" style="width: ${usage_percentage}%;"><span class="usage-progbar-percent">${usage_percentage}%</span></div>
                                </div>
                            </div>
                        `;
                    } 
                    else {
                        usageDisplay = `
                            <div class="driver-usage" style="margin-bottom: 10px;">
                                <h3 style="margin-bottom: 5px; font-size: 14px;">${service.service['driver.interface']} (${service.service['driver.method']}):</h3>
                                <span style="font-size: 13px; margin-bottom: 3px;">Usage: ${monthly_usage} (Unlimited)</span>
                            </div>
                        `;
                    }
                    h += usageDisplay;
                });
            
                // Append driver usage bars to the container
                $('.settings-content[data-settings="usage"]').append(`<div class="driver-usage-container">${h}</div>`);
            }
        })
        
        // df
        $.ajax({
            url: api_origin + "/df",
            type: 'GET',
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer " + auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                },
            },
            success: function (res) {
                let usage_percentage = (res.used / res.capacity * 100).toFixed(0);
                usage_percentage = usage_percentage > 100 ? 100 : usage_percentage;

                $('#storage-used').html(byte_format(res.used));
                $('#storage-capacity').html(byte_format(res.capacity));
                $('#storage-used-percent').html(usage_percentage + '%');
                $('#storage-bar').css('width', usage_percentage + '%');
                if (usage_percentage >= 100) {
                    $('#storage-bar').css({
                        'border-top-right-radius': '3px',
                        'border-bottom-right-radius': '3px',
                    });
                }
            }
        })

        // version
        $.ajax({
            url: api_origin + "/version",
            type: 'GET',
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer " + auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                },
            },
            success: function (res) {
                var d = new Date(0);
                $('.version').html('Version: ' + res.version + ' &bull; ' + 'Server: ' + res.location + ' &bull; ' + 'Deployed: ' + new Date(res.deploy_timestamp));
            }
        })

        $(el_window).find('.credits').on('click', function (e) {
            if($(e.target).hasClass('credits')){
                $('.credits').get(0).close();
            }
        });

        $(el_window).find('.show-credits').on('click', function (e) {
            $('.credits').get(0).showModal();
        })

        $(el_window).find('.change-password').on('click', function (e) {
            UIWindowChangePassword();
        })

        $(el_window).find('.change-email').on('click', function (e) {
            UIWindowChangeEmail();
        })

        $(el_window).find('.delete-account').on('click', function (e) {
            UIWindowDeleteAccount();
        })

        $(el_window).find('.change-username').on('click', function (e) {
            UIWindowChangeUsername();
        })

        $(el_window).on('click', '.settings-sidebar-item', function(){
            const $this = $(this);
            const settings = $this.attr('data-settings');
            const $container = $this.closest('.settings').find('.settings-content-container');
            const $content = $container.find(`.settings-content[data-settings="${settings}"]`);
            // add active class to sidebar item
            $this.siblings().removeClass('active');
            $this.addClass('active');
            // add active class to content
            $container.find('.settings-content').removeClass('active');
            $content.addClass('active');
            // if language, focus on search
            if(settings === 'language'){
                $content.find('.search').first().focus();
                // make sure all language items are visible
                $content.find('.language-item').show();
                // empty search
                $content.find('.search').val('');
            }
        })

        $(el_window).on('click', '.language-item', function(){
            const $this = $(this);
            const lang = $this.attr('data-lang');
            changeLanguage(lang);
            $this.siblings().removeClass('active');
            $this.addClass('active');
            // make sure all other language items are visible
            $this.closest('.language-list').find('.language-item').show();
        })
        
        $(el_window).on('input', '.search', function(){
            const $this = $(this);
            const search = $this.val().toLowerCase();
            const $container = $this.closest('.settings').find('.settings-content-container');
            const $content = $container.find('.settings-content.active');
            const $list = $content.find('.language-list');
            const $items = $list.find('.language-item');
            $items.each(function(){
                const $item = $(this);
                const lang = $item.attr('data-lang');
                const name = $item.text().toLowerCase();
                const english_name = $item.attr('data-english-name').toLowerCase();
                if(name.includes(search) || lang.includes(search) || english_name.includes(search)){
                    $item.show();
                }else{
                    $item.hide();
                }
            })
        });

        resolve(el_window);
    });
}


export default UIWindowSettings