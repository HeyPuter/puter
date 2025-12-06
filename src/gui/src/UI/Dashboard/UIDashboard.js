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
import UIWindowSaveAccount from '../UIWindowSaveAccount.js';
import UIWindowLogin from '../UIWindowLogin.js';
import UIWindowFeedback from '../UIWindowFeedback.js';

function buildAppsSection () {
    let apps_str = '';

    // -------------------------------------------
    // Recent apps
    // -------------------------------------------
    if ( window.launch_apps?.recent?.length > 0 ) {
        apps_str += `<h3 class="dashboard-apps-heading">${i18n('recent')}</h3>`;
        apps_str += '<div class="dashboard-apps-grid">';
        for ( let index = 0; index < window.launch_recent_apps_count && index < window.launch_apps.recent.length; index++ ) {
            const app_info = window.launch_apps.recent[index];
            apps_str += `<div title="${html_encode(app_info.title)}" data-name="${html_encode(app_info.name)}" class="dashboard-app-card start-app-card">`;
            apps_str += `<div class="start-app" data-app-name="${html_encode(app_info.name)}" data-app-uuid="${html_encode(app_info.uuid)}" data-app-icon="${html_encode(app_info.icon)}" data-app-title="${html_encode(app_info.title)}">`;
            apps_str += `<img class="dashboard-app-icon" src="${html_encode(app_info.icon ? app_info.icon : window.icons['app.svg'])}">`;
            apps_str += `<span class="dashboard-app-title">${html_encode(app_info.title)}</span>`;
            apps_str += '</div>';
            apps_str += '</div>';
        }
        apps_str += '</div>';
    }

    // -------------------------------------------
    // Recommended apps
    // -------------------------------------------
    if ( window.launch_apps?.recommended?.length > 0 ) {
        apps_str += `<h3 class="dashboard-apps-heading" style="${window.launch_apps?.recent?.length > 0 ? 'margin-top: 32px;' : ''}">${i18n('recommended')}</h3>`;
        apps_str += '<div class="dashboard-apps-grid">';
        for ( let index = 0; index < window.launch_apps.recommended.length; index++ ) {
            const app_info = window.launch_apps.recommended[index];
            apps_str += `<div title="${html_encode(app_info.title)}" data-name="${html_encode(app_info.name)}" class="dashboard-app-card start-app-card">`;
            apps_str += `<div class="start-app" data-app-name="${html_encode(app_info.name)}" data-app-uuid="${html_encode(app_info.uuid)}" data-app-icon="${html_encode(app_info.icon)}" data-app-title="${html_encode(app_info.title)}">`;
            apps_str += `<img class="dashboard-app-icon" src="${html_encode(app_info.icon ? app_info.icon : window.icons['app.svg'])}">`;
            apps_str += `<span class="dashboard-app-title">${html_encode(app_info.title)}</span>`;
            apps_str += '</div>';
            apps_str += '</div>';
        }
        apps_str += '</div>';
    }

    // No apps message
    if ( (!window.launch_apps?.recent || window.launch_apps.recent.length === 0) && 
         (!window.launch_apps?.recommended || window.launch_apps.recommended.length === 0) ) {
        apps_str += '<p class="dashboard-no-apps">No apps available yet.</p>';
    }

    return apps_str;
}

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
                h += '<div class="dashboard-apps-container"></div>';
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

    // Function to load and refresh apps
    async function loadApps () {
        // If launch_apps is not populated yet, fetch from server
        if ( !window.launch_apps || !window.launch_apps.recent || window.launch_apps.recent.length === 0 ) {
            try {
                window.launch_apps = await $.ajax({
                    url: `${window.api_origin}/get-launch-apps?icon_size=64`,
                    type: 'GET',
                    async: true,
                    contentType: 'application/json',
                    headers: {
                        'Authorization': `Bearer ${window.auth_token}`,
                    },
                });
            } catch (e) {
                console.error('Failed to load launch apps:', e);
            }
        }
        // Populate the apps container
        $el_window.find('.dashboard-apps-container').html(buildAppsSection());
    }

    // Load apps initially
    loadApps();

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

        // Refresh apps when navigating to apps section
        if ( section === 'apps' ) {
            loadApps();
        }

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

        let items = [];

        // Save Session (if temp user)
        if (window.user.is_temp) {
            items.push({
                html: i18n('save_session'),
                icon: '<svg style="margin-bottom: -4px; width: 16px; height: 16px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M45.521,39.04L27.527,5.134c-1.021-1.948-3.427-2.699-5.375-1.679-.717,.376-1.303,.961-1.679,1.679L2.479,39.04c-.676,1.264-.635,2.791,.108,4.017,.716,1.207,2.017,1.946,3.42,1.943H41.993c1.403,.003,2.704-.736,3.42-1.943,.743-1.226,.784-2.753,.108-4.017ZM23.032,15h1.937c.565,0,1.017,.467,1,1.031l-.438,14c-.017,.54-.459,.969-1,.969h-1.062c-.54,0-.983-.429-1-.969l-.438-14c-.018-.564,.435-1.031,1-1.031Zm.968,25c-1.657,0-3-1.343-3-3s1.343-3,3-3,3,1.343,3,3-1.343,3-3,3Z" fill="#ffbb00"/></svg>',
                onClick: async function () {
                    UIWindowSaveAccount({
                        send_confirmation_code: false,
                        default_username: window.user.username,
                    });
                },
            });
            items.push('-');
        }

        // Logged in users
        if (window.logged_in_users.length > 0) {
            let users_arr = window.logged_in_users;

            // bring logged in user's item to top
            users_arr.sort(function (x, y) {
                return x.uuid === window.user.uuid ? -1 : y.uuid == window.user.uuid ? 1 : 0;
            });

            // create menu items for each user
            users_arr.forEach(l_user => {
                items.push({
                    html: l_user.username,
                    icon: l_user.username === window.user.username ? '✓' : '',
                    onClick: async function () {
                        if (l_user.username === window.user.username) {
                            return;
                        }
                        window.update_auth_data(l_user.auth_token, l_user);
                        location.reload();
                    },
                });
            });

            items.push('-');

            items.push({
                html: i18n('add_existing_account'),
                onClick: async function () {
                    await UIWindowLogin({
                        reload_on_success: true,
                        send_confirmation_code: false,
                        window_options: {
                            has_head: true,
                            stay_on_top: true,
                        },
                    });
                },
            });

            items.push('-');
        }

        // Build final menu items
        const menuItems = [
            ...items,
            // Settings
            {
                html: i18n('settings'),
                onClick: async function () {
                    UIWindowSettings();
                },
            },
            // Contact Us
            {
                html: i18n('contact_us'),
                onClick: async function () {
                    UIWindowFeedback();
                },
            },
            '-',
            // Log out
            {
                html: i18n('log_out'),
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
                },
            },
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