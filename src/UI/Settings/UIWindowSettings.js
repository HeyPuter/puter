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
import AccountTab from './UITabAccount.js';
import PersonalizationTab from './UITabPersonalization.js';
import LanguageTab from './UITabLanguage.js';
import UIWindowThemeDialog from '../UIWindowThemeDialog.js';
import UIWindowManageSessions from '../UIWindowManageSessions.js';

async function UIWindowSettings(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        const tabs = [
            AboutTab,
            UsageTab,
            AccountTab,
            PersonalizationTab,
            LanguageTab,
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
                h += `<div class="settings-sidebar-item disable-user-select" data-settings="clock" style="background-image: url(${icons['clock.svg']});">${i18n('clock')}</div>`;
            h += `</div>`;

            // content
            h += `<div class="settings-content-container">`;

            tabs.forEach((tab, i) => {
                h += `<div class="settings-content ${i === 0 ? 'active' : ''}" data-settings="${tab.id}">
                        ${tab.html()}
                    </div>`;
            });

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

            // Run on_show handlers
            const tab = tabs.find((tab) => tab.id === settings);
            if (tab.on_show) {
                tab.on_show($content);
            }
        })

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