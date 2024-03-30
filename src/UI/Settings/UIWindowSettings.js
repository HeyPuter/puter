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
import changeLanguage from "../../i18n/i18nChangeLanguage.js"
import UIWindowConfirmUserDeletion from './UIWindowConfirmUserDeletion.js';
import UITabAbout from './UITabAbout.js';

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
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="clock" style="background-image: url(${icons['clock.svg']});">${i18n('clock')}</div>`;
            h += `</div>`;

            // content
            h += `<div class="settings-content-container">`;
            
                // About
                h += UITabAbout();

                // Usage
                h += `<div class="settings-content" data-settings="usage">`;
                    h += `<h1>Usage</h1>`;
                    h += `<div class="driver-usage">
                            <h3 style="margin-bottom: 5px; font-size: 14px;">${i18n('storage_usage')}</h3>
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
                    h += `<h1>${i18n('account')}</h1>`;
                    // change password button
                    h += `<div class="settings-card">`;
                        h += `<strong>${i18n('password')}</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button change-password" style="float:right;">${i18n('change_password')}</button>`;
                        h += `</div>`;
                    h += `</div>`;

                    // change username button
                    h += `<div class="settings-card">`;
                        h += `<div>`;
                            h += `<strong style="display:block;">${i18n('username')}</strong>`;
                            h += `<span class="username" style="display:block; margin-top:5px;">${user.username}</span>`;
                        h += `</div>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button change-username" style="float:right;">${i18n('change_username')}</button>`;
                        h += `</div>`
                    h += `</div>`;

                    // change email button
                    if(user.email){
                        h += `<div class="settings-card">`;
                            h += `<div>`;
                                h += `<strong style="display:block;">${i18n('email')}</strong>`;
                                h += `<span style="display:block; margin-top:5px;">${user.email}</span>`;
                            h += `</div>`;
                            h += `<div style="flex-grow:1;">`;
                                h += `<button class="button change-email" style="margin-bottom: 10px; float:right;">${i18n('change_email')}</button>`;
                            h += `</div>`;
                        h += `</div>`;
                    }

                    // 'Delete Account' button
                    h += `<div class="settings-card settings-card-danger">`;
                        h += `<strong style="display: inline-block;">${i18n("delete_account")}</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button button-danger delete-account" style="float:right;">${i18n("delete_account")}</button>`;
                        h += `</div>`;
                    h += `</div>`;

                h += `</div>`;

                // Language
                h += `<div class="settings-content" data-settings="language">`;
                    h += `<h1>${i18n('language')}</h1>`;
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

                // Clock
                h += `<div class="settings-content" data-settings="clock">`;
                     h += `<h1>Clock</h1>`;
                     h += `<div style="display: flex;align-items: center">`
                        h += `<span>${i18n('click_visable')}:</span>`
                        h += `<Select class="change-clock-visable" style="margin-left: 10px;flex: 1">`
                            h += `<option value="auto">${i18n('click_visable_auto')}</option>`
                            h += `<option value="hide">${i18n('click_visable_hide')}</option>`
                            h += `<option value="show">${i18n('click_visable_show')}</option>`
                        h += `</Select>`
                     h += `</div>`
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
                                <span style="font-size: 13px; margin-bottom: 3px;">${i18n('usage')}: ${monthly_usage} (${i18n('unlimited')})</span>
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
            UIWindowConfirmUserDeletion();
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

        $(el_window).on('change', 'select.change-clock-visable', function(e){
            const $this = $(this);  
            const value = $this.val();

            window.change_clock_visable(value);
        })

        window.change_clock_visable();

        resolve(el_window);
    });
}


export default UIWindowSettings