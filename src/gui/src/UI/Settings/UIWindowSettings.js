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

import Placeholder from '../../util/Placeholder.js';
import UIWindow from '../UIWindow.js';

def(Symbol('TSettingsTab'), 'ui.traits.TSettingsTab');

async function UIWindowSettings(options){
    return new Promise(async (resolve) => {
        options = options ?? {};

        const svc_settings = globalThis.services.get('settings');

        const tabs = svc_settings.get_tabs();
        const tab_placeholders = [];

        const savedSize = await puter.kv.get('settings_window_size').catch(() => null);

        const sidebarTitle = options.window_options?.is_fullpage
            ? `<div class="settings-sidebar-title">${i18n('settings')}</div>`
            : '';

        const sidebarItems = tabs.map((tab, i) => `
            <div class="settings-sidebar-item disable-context-menu disable-user-select ${i === 0 ? 'active' : ''}"
                 data-settings="${tab.id}"
                 style="background-image: url(${window.icons[tab.icon]}); --icon-url: url(${window.icons[tab.icon]});">
                ${i18n(tab.title_i18n_key)}
            </div>
        `).join('');

        const contentTabs = tabs.map((tab, i) => {
            let content;
            if (tab.factory || tab.dom) {
                tab_placeholders[i] = Placeholder();
                content = tab_placeholders[i].html;
            } else {
                content = tab.html();
            }
            return `
                <div class="settings-content ${i === 0 ? 'active' : ''}" data-settings="${tab.id}">
                    ${content}
                </div>
            `;
        }).join('');

        const h = `
            <div class="settings-container">
                <div class="settings">
                    <div class="settings-backdrop hidden-lg hidden-xl hidden-md"></div>
                    <button class="sidebar-toggle hidden-lg hidden-xl hidden-md">
                        <div class="sidebar-toggle-button">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </button>
                    <div class="settings-sidebar disable-user-select disable-context-menu">
                        ${sidebarTitle}
                        <div class="settings-sidebar-burger disable-context-menu disable-user-select"
                             style="background-image: url(${window.icons['menu']});"></div>
                        ${sidebarItems}
                    </div>
                    <div class="settings-content-container">
                        ${contentTabs}
                    </div>
                </div>
            </div>
        `;

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
            is_resizable: true,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            backdrop: false,
            width: savedSize?.width || 800,
            height: savedSize?.height || 'auto',
            minWidth: 480,
            minHeight: 500,
            dominant: true,
            show_in_taskbar: false,
            draggable_body: false,
            onAppend: function(this_window){
                // send event settings-window-opened
                window.dispatchEvent(new CustomEvent('settings-window-opened', { detail: { window: this_window } }));
            },
            window_class: 'window-settings',
            body_css: {
                width: 'initial',
                height: '100%',
                overflow: 'auto',
            },
            ...options?.window_options ?? {},
        });
        const $el_window = $(el_window);
        tabs.forEach((tab, i) => {
            tab.init && tab.init($el_window);
            if ( tab.factory ) {
                const component = tab.factory();
                component.attach(tab_placeholders[i]);
            }
            if ( tab.reinitialize ) {
                tab.reinitialize();
            }
            if ( tab.dom ) {
                tab_placeholders[i].replaceWith(tab.dom);
            }
        });

        // If options.tab is provided, open that tab
        if ( options.tab ) {
            const $tabToOpen = $el_window.find(`.settings-sidebar-item[data-settings="${options.tab}"]`);
            if ( $tabToOpen.length > 0 ) {
                setTimeout(() => {
                    $tabToOpen.trigger('click');
                }, 50);
            }
        }

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
            if ( tab?.on_show ) {
                tab.on_show($content);
            }

            // hide sidebar on mobile
            const $settings = $this.closest('.settings');
            $settings.find('.settings-sidebar').removeClass('active');
            $settings.find('.sidebar-toggle').removeClass('active');
            $settings.find('.settings-backdrop').removeClass('active');
        });

        $(el_window).on('click', '.sidebar-toggle', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const $settings = $(this).closest('.settings');
            const isActive = $settings.find('.settings-sidebar').hasClass('active');

            $settings.find('.settings-sidebar').toggleClass('active');
            $settings.find('.sidebar-toggle').toggleClass('active');
            $settings.find('.settings-backdrop').toggleClass('active');

            // Prevent body scroll when sidebar is open
            if ( !isActive ) {
                $('body').css('overflow', 'hidden');
            } else {
                $('body').css('overflow', '');
            }
        });

        $(el_window).on('click', '.settings-backdrop', function() {
            const $settings = $(this).closest('.settings');
            $settings.find('.settings-sidebar').removeClass('active');
            $settings.find('.sidebar-toggle').removeClass('active');
            $settings.find('.settings-backdrop').removeClass('active');
            $('body').css('overflow', '');
        });

        $(el_window).on('click', function(e) {
            const $target = $(e.target);
            if ( !$target.closest('.settings-sidebar').length &&
                !$target.closest('.sidebar-toggle').length &&
                !$target.closest('.settings-backdrop').length ) {
                const $settings = $(el_window).find('.settings');
                if ( $settings.find('.settings-sidebar').hasClass('active') ) {
                    $settings.find('.settings-sidebar').removeClass('active');
                    $settings.find('.sidebar-toggle').removeClass('active');
                    $settings.find('.settings-backdrop').removeClass('active');
                    $('body').css('overflow', '');
                }
            }
        });

        $(el_window).on('resizestop', function() {
            const width = $(el_window).width();
            const height = $(el_window).height();
            puter.kv.set('settings_window_size', { width, height });
        });

        const updateWindowSizeClasses = () => {
            const $settings = $el_window.find('.settings');
            const width = $el_window.width();

            $settings.removeClass('window-xs window-sm window-md');

            if (width < 576) {
                $settings.addClass('window-xs');
            } else if (width < 768) {
                $settings.addClass('window-sm');
            } else if (width < 992) {
                $settings.addClass('window-md');
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            updateWindowSizeClasses();
        });
        resizeObserver.observe(el_window);

        updateWindowSizeClasses();

        resolve(el_window);
    });
}

export default UIWindowSettings;