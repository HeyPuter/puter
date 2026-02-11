/* eslint-disable no-invalid-this */
/* eslint-disable @stylistic/indent */
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
import UIAlert from '../UIAlert.js';
import UIWindowSaveAccount from '../UIWindowSaveAccount.js';
import UIWindowLogin from '../UIWindowLogin.js';
import UIWindowFeedback from '../UIWindowFeedback.js';

/**
 * Creates and displays the Dashboard window.
 *
 * @param {Object} [options] - Configuration options for the dashboard
 * @returns {Promise<HTMLElement>} The dashboard window element
 *
 * @fires dashboard-will-open - Dispatched on window before dashboard renders.
 *   Extensions can use this to add custom tabs. The event detail contains { tabs: [] }
 *   where tabs is an array that extensions can push new tab objects to.
 *   Tab objects should have: id, label, icon (SVG string), html() function,
 *   and optionally init($el_window) and onActivate($el_window) methods.
 *
 * @fires dashboard-ready - Dispatched on window when dashboard is fully initialized and ready.
 *   The event detail contains { window: $el_window } where $el_window is the jQuery-wrapped
 *   dashboard window element. Extensions can listen for this event to add custom functionality.
 */

// Import tab modules
import TabHome from './TabHome.js';
import TabFiles from './TabFiles.js';
import TabApps from './TabApps.js';
import TabUsage from './TabUsage.js';
import TabAccount from './TabAccount.js';
import TabSecurity from './TabSecurity.js';

// Registry of built-in tabs
const builtinTabs = [
    TabHome,
    // TabApps,
    TabFiles,
    TabUsage,
    TabAccount,
    TabSecurity,
];

// Dynamically load dashboard CSS if not already loaded
if ( ! document.querySelector('link[href*="dashboard.css"]') ) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/dashboard.css';
    document.head.appendChild(link);
}

async function UIDashboard (options) {
    // eslint-disable-next-line no-unused-vars
    options = options ?? {};

    // Create mutable tabs array from built-in tabs
    const tabs = [...builtinTabs];

    // Dispatch 'dashboard-will-open' event to allow extensions to add tabs
    window.dispatchEvent(new CustomEvent('dashboard-will-open', { detail: { tabs } }));

    let h = '';

    h += '<div class="dashboard">';

        // Mobile sidebar toggle
        h += '<button class="dashboard-sidebar-toggle">';
            h += '<span></span><span></span><span></span>';
        h += '</button>';

        // Sidebar
        h += '<div class="dashboard-sidebar hide-scrollbar">';
            // Navigation items container
            h += '<div class="dashboard-sidebar-nav">';
            for ( let i = 0; i < tabs.length; i++ ) {
                const tab = tabs[i];
                const isActive = i === 0 ? ' active' : '';
                const isBeta = tab.label === 'Files';
                h += `<div class="dashboard-sidebar-item${isActive} ${isBeta ? 'beta' : ''}" data-section="${tab.id}">`;
                    h += tab.icon;
                    h += tab.label;
                h += '</div>';
            }
            h += '</div>';

            // User options button at bottom
            h += '<div class="dashboard-user-options hide-scrollbar">';
                h += '<div class="dashboard-user-btn hide-scrollbar">';
                    h += `<div class="dashboard-user-avatar profile-pic" style="background-image: url(${window.user?.profile?.picture || window.icons['profile.svg']})"></div>`;
                    h += `<span class="dashboard-user-name">${window.html_encode(window.user?.username || 'User')}</span>`;
                    h += '<svg class="dashboard-user-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
                h += '</div>';
            h += '</div>';
        h += '</div>';

        // Main content area
        h += '<div class="dashboard-content">';
        for ( let i = 0; i < tabs.length; i++ ) {
            const tab = tabs[i];
            const isActive = i === 0 ? ' active' : '';
            h += `<div class="dashboard-section dashboard-section-${tab.id}${isActive}" data-section="${tab.id}">`;
            h += tab.html();
            h += '</div>';
        }
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
        stay_on_top: false,
        window_class: 'window-dashboard',
        body_css: {
            height: '100%',
            overflow: 'hidden',
        },
    });

    const $el_window = $(el_window);

    // Set initial file path BEFORE tabs are initialized (so TabFiles.init() can use it)
    if ( window.dashboard_initial_route?.tab === 'files' && window.dashboard_initial_route?.path ) {
        window.dashboard_initial_file_path = window.dashboard_initial_route.path;
    }

    // Initialize all tabs
    for ( const tab of tabs ) {
        if ( tab.init ) {
            tab.init($el_window);
        }
    }

    // Dispatch 'dashboard-ready' event for extensions
    window.dispatchEvent(new CustomEvent('dashboard-ready', { detail: { window: $el_window } }));

    // Apply initial route from URL - activate the correct tab
    if ( window.dashboard_initial_route ) {
        const route = window.dashboard_initial_route;

        // Activate the correct tab if not home
        if ( route.tab && route.tab !== 'home' ) {
            const tabId = route.tab;
            const $targetTab = $el_window.find(`.dashboard-sidebar-item[data-section="${tabId}"]`);

            // Only switch if the tab exists
            if ( $targetTab.length > 0 ) {
                $el_window.find('.dashboard-sidebar-item').removeClass('active');
                $targetTab.addClass('active');
                $el_window.find('.dashboard-section').removeClass('active');
                $el_window.find(`.dashboard-section[data-section="${tabId}"]`).addClass('active');

                document.querySelector('.dashboard-content').setAttribute('class', 'dashboard-content');
                document.querySelector('.dashboard-content').classList.add(tabId);

                // Call onActivate if exists
                const tab = tabs.find(t => t.id === tabId);
                if ( tab?.onActivate ) {
                    tab.onActivate($el_window);
                }
            }
        }
    }

    // Handle browser back/forward navigation
    // This handler is called for both hashchange (manual hash changes) and popstate (back/forward)
    const handleRouteChange = () => {
        const route = window.parseDashboardRoute();
        const tab = route.tab;
        const filePath = route.path;

        // Switch to correct tab
        const $targetTab = $el_window.find(`.dashboard-sidebar-item[data-section="${tab}"]`);
        if ( tab === 'home' ) {
            // Home tab
            $el_window.find('.dashboard-sidebar-item').removeClass('active');
            $el_window.find('.dashboard-sidebar-item').first().addClass('active');
            $el_window.find('.dashboard-section').removeClass('active');
            $el_window.find('.dashboard-section').first().addClass('active');
            document.querySelector('.dashboard-content').setAttribute('class', 'dashboard-content');
        } else if ( $targetTab.length > 0 ) {
            $el_window.find('.dashboard-sidebar-item').removeClass('active');
            $targetTab.addClass('active');
            $el_window.find('.dashboard-section').removeClass('active');
            $el_window.find(`.dashboard-section[data-section="${tab}"]`).addClass('active');
            document.querySelector('.dashboard-content').setAttribute('class', 'dashboard-content');
            document.querySelector('.dashboard-content').classList.add(tab);
        }

        // If files tab with path, navigate without adding to history
        if ( tab === 'files' && filePath ) {
            const filesTab = tabs.find(t => t.id === 'files');
            if ( filesTab?.renderDirectory ) {
                filesTab.renderDirectory(filePath, { skipUrlUpdate: true, skipNavHistory: true });
            }
        }
    };

    // Listen for both hashchange and popstate to handle all navigation scenarios
    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('popstate', handleRouteChange);

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

        // Call onActivate for the tab if it exists
        const tab = tabs.find(t => t.id === section);
        if ( tab && tab.onActivate ) {
            tab.onActivate($el_window);
        }

        document.querySelector('.dashboard-content').setAttribute('class', 'dashboard-content');
        document.querySelector('.dashboard-content').classList.add(section);

        // Update hash to reflect current tab
        // Note: Files tab updates its own hash with full path via onActivate, so skip it here
        if ( section !== 'files' ) {
            const newHash = section === 'home' ? '' : section;
            history.replaceState(null, '', newHash ? `#${newHash}` : window.location.pathname);
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

    // Close sidebar when clicking outside
    $el_window.on('mousedown touchstart', function (e) {
        if ( !$(e.target).closest('.dashboard-sidebar').length
            && !$(e.target).closest('.dashboard-sidebar-toggle').length
            && $el_window.find('.dashboard-sidebar').hasClass('open') ) {
            $el_window.find('.dashboard-sidebar').removeClass('open');
            $el_window.find('.dashboard-sidebar-toggle').removeClass('open');
        }
    });

    // User options button click handler
    $el_window.on('click', '.dashboard-user-btn', function () {
        const $btn = $(this);
        const $chevron = $btn.find('.dashboard-user-chevron');
        const pos = this.getBoundingClientRect();

        // Don't open if already open
        if ( $('.context-menu[data-id="dashboard-user-menu"]').length > 0 ) {
            return;
        }

        // Rotate chevron to point upwards
        $chevron.addClass('open');

        let items = [];

        // Save Session (if temp user)
        if ( window.user.is_temp ) {
            items.push({
                html: i18n('save_session'),
                icon: '<svg style="margin-bottom: -4px; width: 16px; height: 16px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M45.521,39.04L27.527,5.134c-1.021-1.948-3.427-2.699-5.375-1.679-.717,.376-1.303,.961-1.679,1.679L2.479,39.04c-.676,1.264-.635,2.791,.108,4.017,.716,1.207,2.017,1.946,3.42,1.943H41.993c1.403,.003,2.704-.736,3.42-1.943,.743-1.226,.784-2.753,.108-4.017ZM23.032,15h1.937c.565,0,1.017,.467,1,1.031l-.438,14c-.017,.54-.459,.969-1,.969h-1.062c-.54,0-.983-.429-1-.969l-.438-14c-.018-.564,.435-1.031,1-1.031Zm.968,25c-1.657,0-3-1.343-3-3s1.343-3,3-3,3,1.343,3,3-1.343,3-3,3Z" fill="var(--dashboard-warning-icon)"/></svg>',
                onClick: async function () {
                    UIWindowSaveAccount({
                        send_confirmation_code: false,
                        default_username: window.user.username,
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: true,
                            parent_center: true,
                            stay_on_top: true,
                            has_head: false,
                        },
                    });
                },
            });
            items.push('-');
        }

        // Logged in users
        if ( window.logged_in_users.length > 0 ) {
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
                        if ( l_user.username === window.user.username ) {
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
                            has_head: false,
                            backdrop: true,
                            close_on_backdrop_click: true,
                            parent_center: true,
                        },
                    });
                },
            });

            items.push('-');
        }

        // Build final menu items
        const menuItems = [
            ...items,
            // Developer
            {
                html: 'Developers<svg style="width: 11px; height: 11px; margin-left:2px; margin-bottom:-1px;" height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg"><path d="m26 28h-20a2.0027 2.0027 0 0 1 -2-2v-20a2.0027 2.0027 0 0 1 2-2h10v2h-10v20h20v-10h2v10a2.0027 2.0027 0 0 1 -2 2z"/><path d="m20 2v2h6.586l-8.586 8.586 1.414 1.414 8.586-8.586v6.586h2v-10z"/><path d="m0 0h32v32h-32z" fill="none"/></svg>',
                html_active: 'Developers<svg style="width: 11px; height: 11px; margin-left:2px; margin-bottom:-1px;" height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg"><path d="m26 28h-20a2.0027 2.0027 0 0 1 -2-2v-20a2.0027 2.0027 0 0 1 2-2h10v2h-10v20h20v-10h2v10a2.0027 2.0027 0 0 1 -2 2z" style="fill: rgb(255, 255, 255);"/><path d="m20 2v2h6.586l-8.586 8.586 1.414 1.414 8.586-8.586v6.586h2v-10z" style="fill: rgb(255, 255, 255);"/><path d="m0 0h32v32h-32z" fill="none"/></svg>',
                onClick: function () {
                    window.open('https://developer.puter.com', '_blank');
                },
            },
            // Contact Us
            {
                html: i18n('contact_us'),
                onClick: async function () {
                    UIWindowFeedback({
                        window_options: {
                            backdrop: true,
                            close_on_backdrop_click: true,
                            parent_center: true,
                            stay_on_top: true,
                            has_head: false,
                        },
                    });
                },
            },
            '-',
            // Log out
            {
                html: i18n('log_out'),
                onClick: async function () {
                    // Check for open windows
                    if ( $('.window-app').length > 0 ) {
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
                        if ( alert_resp === 'close_and_log_out' ) {
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
                left: pos.left,
            },
            items: menuItems,
            onClose: () => {
                // Rotate chevron back to point downwards
                $chevron.removeClass('open');
            },
        });
    });

    return el_window;
}

export default UIDashboard;
