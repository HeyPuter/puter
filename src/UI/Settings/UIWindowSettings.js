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
import UIWindowChangeEmail from './UIWindowChangeEmail.js'
import UIWindowChangeUsername from '../UIWindowChangeUsername.js'
import changeLanguage from "../../i18n/i18nChangeLanguage.js"
import UIWindowConfirmUserDeletion from './UIWindowConfirmUserDeletion.js';
import AboutTab from './UITabAbout.js';
import UsageTab from './UITabUsage.js';
import UIWindowThemeDialog from '../UIWindowThemeDialog.js';
import UIWindowManageSessions from '../UIWindowManageSessions.js';

async function UIWindowSettings(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        const tabs = [
            AboutTab,
            UsageTab,
            // AccountTab,
            // PersonalizationTab,
            // LanguageTab,
            // ClockTab,
        ];

        let h = '';

        h += `<div class="settings-container">`;
        h += `<div class="settings">`;
            // side bar
            h += `<div class="settings-sidebar disable-user-select">`;
            tabs.forEach((tab, i) => {
                h += `<div class="settings-sidebar-item disable-user-select ${i === 0 ? 'active' : ''}" data-settings="${tab.id}" style="background-image: url(${icons[tab.icon]});">${i18n(tab.title_i18n_key)}</div>`;
            });
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="account" style="background-image: url(${icons['user.svg']});">${i18n('account')}</div>`;
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="personalization" style="background-image: url(${icons['palette-outline.svg']});">${i18n('personalization')}</div>`;
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="language" style="background-image: url(${icons['language.svg']});">${i18n('language')}</div>`;
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="clock" style="background-image: url(${icons['clock.svg']});">${i18n('clock')}</div>`;
            h += `</div>`;

            // content
            h += `<div class="settings-content-container">`;

            tabs.forEach((tab, i) => {
                h += `<div class="settings-content ${i === 0 ? 'active' : ''}" data-settings="${tab.id}">
                        ${tab.html()}
                    </div>`;
            });

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
                                h += `<span class="user-email" style="display:block; margin-top:5px;">${user.email}</span>`;
                            h += `</div>`;
                            h += `<div style="flex-grow:1;">`;
                                h += `<button class="button change-email" style="margin-bottom: 10px; float:right;">${i18n('change_email')}</button>`;
                            h += `</div>`;
                        h += `</div>`;
                    }

                    // session manager
                    h += `<div class="settings-card">`;
                        h += `<strong>${i18n('sessions')}</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button manage-sessions" style="float:right;">${i18n('manage_sessions')}</button>`;
                        h += `</div>`;
                    h += `</div>`;

                    // 'Delete Account' button
                    h += `<div class="settings-card settings-card-danger">`;
                        h += `<strong style="display: inline-block;">${i18n("delete_account")}</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button button-danger delete-account" style="float:right;">${i18n("delete_account")}</button>`;
                        h += `</div>`;
                    h += `</div>`;

                h += `</div>`;

                // Personalization
                h += `<div class="settings-content" data-settings="personalization">`;
                    h += `<h1>${i18n('personalization')}</h1>`;
                    // change password button
                    h += `<div class="settings-card">`;
                        h += `<strong>${i18n('ui_colors')}</strong>`;
                        h += `<div style="flex-grow:1;">`;
                            h += `<button class="button change-ui-colors" style="float:right;">${i18n('change_ui_colors')}</button>`;
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
                     h += `<h1>${i18n('clock')}</h1>`;
                     h += `<div style="display: flex;align-items: center">`
                        h += `<span>${i18n('visibility')}:</span>`
                        h += `<select class="change-clock-visible" style="margin-left: 10px;flex: 1">`
                            h += `<option value="auto">${i18n('clock_visible_auto')}</option>`
                            h += `<option value="hide">${i18n('clock_visible_hide')}</option>`
                            h += `<option value="show">${i18n('clock_visible_show')}</option>`
                        h += `</select>`
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
        const $el_window = $(el_window);
        tabs.forEach(tab => tab.init($el_window));

        $(el_window).find('.change-password').on('click', function (e) {
            UIWindowChangePassword({
                window_options:{
                    parent_uuid: $(el_window).attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        })

        $(el_window).find('.change-email').on('click', function (e) {
            console.log('change email', $(el_window).attr('data-element_uuid'));
            UIWindowChangeEmail({
                window_options:{
                    parent_uuid: $(el_window).attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        })

        $(el_window).find('.delete-account').on('click', function (e) {
            UIWindowConfirmUserDeletion({
                window_options:{
                    parent_uuid: $(el_window).attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        })

        $(el_window).find('.change-username').on('click', function (e) {
            UIWindowChangeUsername({
                window_options:{
                    parent_uuid: $(el_window).attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        })

        $(el_window).find('.change-ui-colors').on('click', function (e) {
            UIWindowThemeDialog({
                window_options:{
                    parent_uuid: $(el_window).attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
        })

        $(el_window).find('.manage-sessions').on('click', function (e) {
            UIWindowManageSessions({
                window_options:{
                    parent_uuid: $(el_window).attr('data-element_uuid'),
                    disable_parent_window: true,
                    parent_center: true,
                }
            });
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

        $(el_window).on('change', 'select.change-clock-visible', function(e){
            const $this = $(this);  
            const value = $this.val();

            window.change_clock_visible(value);
        })

        window.change_clock_visible();

        resolve(el_window);
    });
}


export default UIWindowSettings