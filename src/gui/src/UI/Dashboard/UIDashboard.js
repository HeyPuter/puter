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

import UIWindow from '../UIWindow.js';
import UIContextMenu from '../UIContextMenu.js';
import UIWindowSettings from '../Settings/UIWindowSettings.js';
import UIAlert from '../UIAlert.js';

async function UIDashboard (options) {
    options = options ?? {};

    let h = '';

    h += '<div class="dashboard">';
    
        // Mobile sidebar toggle
        h += '<button class="dashboard-sidebar-toggle">';
            h += '<span></span><span></span><span></span>';
        h += '</button>';
        
        // Sidebar
        h += '<div class="dashboard-sidebar">';
            // Navigation items container
            h += '<div class="dashboard-sidebar-nav">';
                h += `<div class="dashboard-sidebar-item active" data-section="files">`;
                h += `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
                h += `My Files</div>`;
                h += `<div class="dashboard-sidebar-item" data-section="apps">`;
                h += `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
                h += `My Apps</div>`;
            h += '</div>';
            
            // User options button at bottom
            h += '<div class="dashboard-user-options">';
                h += `<div class="dashboard-user-btn">`;
                    h += `<div class="dashboard-user-avatar" style="background-image: url(${window.user?.profile?.picture || window.icons['profile.svg']})"></div>`;
                    h += `<span class="dashboard-user-name">${html_encode(window.user?.username || 'User')}</span>`;
                    h += `<svg class="dashboard-user-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
                h += `</div>`;
            h += '</div>';
        h += '</div>';

        // Main content area
        h += '<div class="dashboard-content">';
            h += '<div class="dashboard-section active" data-section="files">';
                h += '<h2>My Files</h2>';
                h += '<p>Your files will appear here.</p>';
            h += '</div>';
            h += '<div class="dashboard-section" data-section="apps">';
                h += '<h2>My Apps</h2>';
                h += '<p>Your apps will appear here.</p>';
            h += '</div>';
        h += '</div>';

    h += '</div>';

    const el_window = await UIWindow({
        title: 'Dashboard',
        app: 'dashboard',
        single_instance: true,
        is_fullpage: true,
        is_resizable: false,
        is_maximized: true,
        has_head: false,
        body_content: h,
        window_class: 'window-dashboard',
        body_css: {
            height: '100%',
            overflow: 'hidden',
        },
    });

    const $el_window = $(el_window);

    // Sidebar item click handler
    $el_window.on('click', '.dashboard-sidebar-item', function () {
        const $this = $(this);
        const section = $this.attr('data-section');
        
        // Update active sidebar item
        $el_window.find('.dashboard-sidebar-item').removeClass('active');
        $this.addClass('active');
        
        // Update active content section
        $el_window.find('.dashboard-section').removeClass('active');
        $el_window.find(`.dashboard-section[data-section="${section}"]`).addClass('active');

        // Close sidebar on mobile after selection
        $el_window.find('.dashboard-sidebar').removeClass('open');
        $el_window.find('.dashboard-sidebar-toggle').removeClass('open');
    });

    // Mobile toggle handler
    $el_window.on('click', '.dashboard-sidebar-toggle', function () {
        $(this).toggleClass('open');
        $el_window.find('.dashboard-sidebar').toggleClass('open');
    });

    // User options button click handler
    $el_window.on('click', '.dashboard-user-btn', function (e) {
        const $btn = $(this);
        const pos = this.getBoundingClientRect();
        
        // Don't open if already open
        if ($('.context-menu[data-id="dashboard-user-menu"]').length > 0) {
            return;
        }

        const menuItems = [
            // Settings
            {
                html: i18n('settings'),
                icon: `<svg style="width:13px; height:13px;margin-bottom:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
                onClick: function () {
                    UIWindowSettings();
                }
            },
            '-',
            // Log out
            {
                html: i18n('log_out'),
                icon: `<svg style="width:13px; height:13px;margin-bottom:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
                onClick: async function () {
                    // Check for open windows
                    if ($('.window-app').length > 0) {
                        const alert_resp = await UIAlert({
                            message: `<p>${i18n('confirm_open_apps_log_out')}</p>`,
                            buttons: [
                                {
                                    label: i18n('close_all_windows_and_log_out'),
                                    value: 'close_and_log_out',
                                    type: 'primary',
                                },
                                {
                                    label: i18n('cancel'),
                                },
                            ],
                        });
                        if (alert_resp === 'close_and_log_out') {
                            window.logout();
                        }
                    } else {
                        window.logout();
                    }
                }
            }
        ];

        UIContextMenu({
            id: 'dashboard-user-menu',
            parent_element: $btn[0],
            position: { 
                top: pos.top - 8,
                left: pos.left
            },
            items: menuItems
        });
    });

    return el_window;
}

export default UIDashboard;