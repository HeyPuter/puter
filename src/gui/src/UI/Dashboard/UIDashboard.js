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
import launch_app from '../../helpers/launch_app.js';

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
    TabApps,
    TabFiles,
    '-',
    TabUsage,
    TabAccount,
    TabSecurity,
];

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
            // Sidebar header with logo and collapse toggle
            h += '<div class="dashboard-sidebar-header">';
                h += `<div class="dashboard-sidebar-logo"><img src="${window.icons['logo.svg']}" alt="Puter"><span>Puter</span></div>`;
                h += '<button class="dashboard-sidebar-collapse-toggle">';
                    h += `<img class="sidebar-toggle-close" src="${window.icons['sidebar-close.svg']}">`;
                    h += `<img class="sidebar-toggle-open" src="${window.icons['sidebar-open.svg']}">`;
                h += '</button>';
            h += '</div>';
            // Navigation items container
            h += '<div class="dashboard-sidebar-nav">';
            for ( let i = 0; i < tabs.length; i++ ) {
                const tab = tabs[i];
                if ( tab === '-' ) {
                    h += '<hr class="dashboard-sidebar-separator">';
                    continue;
                }
                const isActive = i === 0 ? ' active' : '';
                const isBeta = tab.label === 'Apps';
                h += `<div class="dashboard-sidebar-item${isActive} ${isBeta ? 'beta' : ''}" data-section="${tab.id}" data-tooltip="${html_encode(tab.label)}">`;
                    h += tab.icon;
                    h += tab.label;
                h += '</div>';
            }
            // Pinned apps section (inside nav, right after the built-in items)
            h += '<hr class="dashboard-sidebar-separator dashboard-pinned-separator">';
            h += '<div class="dashboard-pinned-apps"></div>';
            h += '</div>';

            // User options button at bottom
            h += '<div class="dashboard-user-options">';
                h += '<div class="dashboard-user-btn">';
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
            if ( tab === '-' ) continue;
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

    // Restore sidebar collapsed state
    if ( localStorage.getItem('dashboard-sidebar-collapsed') === '1' ) {
        $el_window.find('.dashboard-sidebar').addClass('collapsed');
    }

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

    // =========================================================================
    // Pinned apps in sidebar
    // =========================================================================
    let pinnedApps = [];
    let reorderDragName = null;
    // Track apps running in Puter windows: Map<appName, Set<windowElement>>
    const runningApps = new Map();

    function renderPinnedApp (app) {
        const $item = $(`<div class="dashboard-sidebar-item dashboard-pinned-app" draggable="true" data-app-name="${html_encode(app.name)}" title="${html_encode(app.title || app.name)}" data-tooltip="${html_encode(app.title || app.name)}">`)
            .append(`<img src="${html_encode(app.iconUrl || window.icons['app.svg'])}" class="dashboard-pinned-icon" alt="">`)
            .append(document.createTextNode(app.title || app.name));
        $el_window.find('.dashboard-pinned-apps').append($item);
    }

    function updatePinnedSeparator () {
        const hasPinned = pinnedApps.length > 0;
        const hasRunning = $el_window.find('.dashboard-running-app').length > 0;
        $el_window.find('.dashboard-pinned-separator').toggleClass('visible', hasPinned || hasRunning);
    }

    function savePinnedApps () {
        puter.kv.set('dashboard_pinned_apps', JSON.stringify(pinnedApps));
    }

    function updateSidebarAppStates () {
        // Update running/active indicators on all sidebar app items
        $el_window.find('.dashboard-pinned-app, .dashboard-running-app').each(function () {
            const $el = $(this);
            const appName = $el.attr('data-app-name');
            const windows = runningApps.get(appName);
            const isRunning = !!(windows && windows.size > 0);
            $el.toggleClass('sidebar-app-running', isRunning);

            // Check if any window of this app has visible focus
            let isActive = false;
            if ( isRunning ) {
                windows.forEach(win => {
                    if ( $(win).css('visibility') !== 'hidden' ) {
                        isActive = true;
                    }
                });
            }
            $el.toggleClass('sidebar-app-active', isActive);

            // Show close button on active (running + visible) apps
            if ( isActive ) {
                if ( ! $el.find('.sidebar-app-close-btn').length ) {
                    $el.append('<span class="sidebar-app-close-btn" title="Close">&times;</span>');
                }
            } else {
                $el.find('.sidebar-app-close-btn').remove();
            }
        });
    }

    function addRunningApp (appName, windowEl, iconUrl, title) {
        if ( ! runningApps.has(appName) ) {
            runningApps.set(appName, new Set());
        }
        runningApps.get(appName).add(windowEl);

        // Listen for window removal directly
        $(windowEl).on('remove', function () {
            removeRunningApp(appName, windowEl);
        });

        // If app is not permanently pinned, add a temporary sidebar entry
        const isPinned = pinnedApps.some(p => p.name === appName);
        const hasRunningEntry = $el_window.find(`.dashboard-running-app[data-app-name="${appName}"]`).length > 0;
        if ( !isPinned && !hasRunningEntry ) {
            const icon = iconUrl || window.icons['app.svg'];
            const label = title || appName;
            const $item = $(`<div class="dashboard-sidebar-item dashboard-running-app" data-app-name="${html_encode(appName)}" title="${html_encode(label)}">`)
                .append(`<img src="${html_encode(icon)}" class="dashboard-pinned-icon" alt="">`)
                .append(document.createTextNode(label));
            $el_window.find('.dashboard-pinned-apps').append($item);
        }
        updatePinnedSeparator();
        updateSidebarAppStates();
    }

    function removeRunningApp (appName, windowEl) {
        const windows = runningApps.get(appName);
        if ( windows ) {
            windows.delete(windowEl);
            if ( windows.size === 0 ) {
                runningApps.delete(appName);
                // Remove temporary sidebar entry (only if not permanently pinned)
                const isPinned = pinnedApps.some(p => p.name === appName);
                if ( ! isPinned ) {
                    $el_window.find(`.dashboard-running-app[data-app-name="${appName}"]`).remove();
                }
            }
        }
        updatePinnedSeparator();
        updateSidebarAppStates();

        // If no more running apps, switch to Apps tab
        if ( runningApps.size === 0 ) {
            const $appsTab = $el_window.find('.dashboard-sidebar-item[data-section="apps"]');
            if ( $appsTab.length ) {
                $appsTab.trigger('click');
            }
        }
    }

    // Expose function for TabApps and others to open an app in a Puter window
    window.dashboard_open_app_in_window = async function (appName, appIconUrl, appTitle) {
        // Check if app is already running — reveal and focus it
        const existingWindows = runningApps.get(appName);
        if ( existingWindows && existingWindows.size > 0 ) {
            hideAllAppWindows();
            showAppWindows(appName);
            return;
        }

        // Hide other app windows before launching new one
        hideAllAppWindows();

        const process = await launch_app({
            name: appName,
            update_window_url: false,
            window_options: {
                left: 250,
                top: 0,
                width: window.innerWidth - 250,
                height: window.innerHeight,
            },
        });

        // Track the running app once the window element is available
        if ( process && process.references && process.references.el_win ) {
            let winEl = await process.references.el_win;
            if ( winEl instanceof $ ) winEl = winEl[0];
            addRunningApp(appName, winEl, appIconUrl, appTitle);
        }
    };

    // Load pinned apps
    (async () => {
        try {
            const saved = await puter.kv.get('dashboard_pinned_apps');
            if ( saved ) {
                pinnedApps = JSON.parse(saved);
                for ( const app of pinnedApps ) {
                    renderPinnedApp(app);
                }
                updatePinnedSeparator();
            }
        } catch (_) {
            // KV not available
        }
    })();

    // Drag over sidebar — show drop indicator
    const sidebarEl = $el_window.find('.dashboard-sidebar')[0];

    sidebarEl.addEventListener('dragover', function (e) {
        // During internal reorder, still allow drop but skip sidebar styling
        if ( reorderDragName ) {
            e.preventDefault();
            return;
        }
        if ( ! e.dataTransfer.types.includes('application/x-puter-app') ) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.classList.add('drag-over');
    });

    sidebarEl.addEventListener('dragleave', function (e) {
        if ( ! this.contains(e.relatedTarget) ) {
            this.classList.remove('drag-over');
        }
    });

    // Drop app on sidebar (external app from Apps tab)
    sidebarEl.addEventListener('drop', function (e) {
        // Skip during internal reorder — handled by pinned-app drop handler
        if ( reorderDragName ) return;
        e.preventDefault();
        this.classList.remove('drag-over');

        const raw = e.dataTransfer.getData('application/x-puter-app');
        if ( ! raw ) return;

        let app;
        try {
 app = JSON.parse(raw);
}
        catch (_) {
 return;
}

        // Don't add duplicates
        if ( pinnedApps.some(p => p.name === app.name) ) return;

        pinnedApps.push({ name: app.name, title: app.title, iconUrl: app.iconUrl });
        renderPinnedApp(app);
        updatePinnedSeparator();
        savePinnedApps();
    });

    // Expose pin function for use by other tabs (e.g. Apps context menu)
    window.dashboard_pin_app = function (app) {
        if ( pinnedApps.some(p => p.name === app.name) ) return;
        pinnedApps.push({ name: app.name, title: app.title, iconUrl: app.iconUrl });
        renderPinnedApp(app);
        updatePinnedSeparator();
        savePinnedApps();
    };

    // Close button on active sidebar app
    $el_window.on('click', '.sidebar-app-close-btn', function (e) {
        e.stopPropagation();
        const appName = $(this).closest('.dashboard-sidebar-item').attr('data-app-name');
        const windows = runningApps.get(appName);
        if ( windows ) {
            Array.from(windows).forEach(win => $(win).close());
        }
    });

    // Click pinned or running app in sidebar — Alt+click opens in new tab
    $el_window.on('click', '.dashboard-pinned-app, .dashboard-running-app', function (e) {
        e.stopPropagation();
        const appName = $(this).attr('data-app-name');
        if ( ! appName ) return;

        // Alt+click opens in new browser tab
        if ( e.altKey ) {
            window.open(`/app/${ appName}`, '_blank');
            return;
        }

        // If app is running, reveal and focus the existing window
        const existingWindows = runningApps.get(appName);
        if ( existingWindows && existingWindows.size > 0 ) {
            hideAllAppWindows();
            showAppWindows(appName);
            return;
        }

        // Otherwise open in window (default behavior)
        const iconUrl = $(this).find('.dashboard-pinned-icon').attr('src');
        const title = $(this).attr('title') || appName;
        window.dashboard_open_app_in_window(appName, iconUrl, title);
    });

    // Right-click pinned or running app in sidebar
    $el_window.on('contextmenu', '.dashboard-pinned-app, .dashboard-running-app', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const $item = $(this);
        const appName = $item.attr('data-app-name');
        const iconUrl = $item.find('.dashboard-pinned-icon').attr('src');
        const title = $item.attr('title') || appName;
        const isPinned = pinnedApps.some(p => p.name === appName);
        const isRunning = runningApps.has(appName) && runningApps.get(appName).size > 0;

        const items = [
            {
                html: 'Open in Window (default)',
                onClick: () => {
                    window.dashboard_open_app_in_window(appName, iconUrl, title);
                },
            },
            {
                html: 'Open in Tab',
                onClick: () => {
                    window.open(`/app/${appName}`, '_blank');
                },
            },
        ];

        if ( isRunning || isPinned ) {
            items.push('-');
        }

        if ( isRunning ) {
            items.push({
                html: 'Close',
                onClick: () => {
                    const windows = runningApps.get(appName);
                    if ( windows ) {
                        Array.from(windows).forEach(win => $(win).close());
                    }
                },
            });
        }

        if ( isPinned ) {
            items.push({
                html: 'Remove from sidebar',
                onClick: () => {
                    pinnedApps = pinnedApps.filter(p => p.name !== appName);
                    $item.remove();
                    updatePinnedSeparator();
                    savePinnedApps();
                },
            });
        }

        UIContextMenu({
            position: { top: e.clientY, left: e.clientX },
            items,
        });
    });

    // =========================================================================
    // Drag-to-reorder pinned apps
    // =========================================================================
    const pinnedContainer = $el_window.find('.dashboard-pinned-apps')[0];

    function getPinnedAppFromEvent (e) {
        return e.target.closest('.dashboard-pinned-app');
    }

    pinnedContainer.addEventListener('dragstart', function (e) {
        const item = getPinnedAppFromEvent(e);
        if ( ! item ) return;
        reorderDragName = item.getAttribute('data-app-name');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-pinned-reorder', reorderDragName);
        item.classList.add('dragging');
    });

    pinnedContainer.addEventListener('dragend', function (e) {
        const item = getPinnedAppFromEvent(e);
        if ( item ) item.classList.remove('dragging');
        reorderDragName = null;
        pinnedContainer.querySelectorAll('.dashboard-pinned-app').forEach(el => {
            el.classList.remove('drag-reorder-above', 'drag-reorder-below');
        });
    });

    pinnedContainer.addEventListener('dragover', function (e) {
        if ( ! reorderDragName ) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const item = getPinnedAppFromEvent(e);
        if ( ! item ) return;

        // Clear all indicators
        pinnedContainer.querySelectorAll('.dashboard-pinned-app').forEach(el => {
            el.classList.remove('drag-reorder-above', 'drag-reorder-below');
        });

        // Show indicator based on cursor position relative to element midpoint
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if ( e.clientY < midY ) {
            item.classList.add('drag-reorder-above');
        } else {
            item.classList.add('drag-reorder-below');
        }
    });

    pinnedContainer.addEventListener('drop', function (e) {
        if ( ! reorderDragName ) return;
        e.preventDefault();
        e.stopPropagation();
        sidebarEl.classList.remove('drag-over');

        const item = getPinnedAppFromEvent(e);
        if ( ! item ) return;

        const targetName = item.getAttribute('data-app-name');
        if ( targetName === reorderDragName ) return;

        // Determine insert position
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        // Reorder the pinnedApps array
        const dragIndex = pinnedApps.findIndex(p => p.name === reorderDragName);
        const [draggedApp] = pinnedApps.splice(dragIndex, 1);
        let targetIndex = pinnedApps.findIndex(p => p.name === targetName);
        if ( ! insertBefore ) targetIndex++;
        pinnedApps.splice(targetIndex, 0, draggedApp);

        // Re-render all pinned apps in new order
        $el_window.find('.dashboard-pinned-apps').empty();
        for ( const app of pinnedApps ) {
            renderPinnedApp(app);
        }
        savePinnedApps();

        // Clean up
        reorderDragName = null;
    });

    // =========================================================================
    // Socket initialization
    // In dashboard mode, UIDesktop is never loaded, so we create the socket here.
    // This runs inside the function (not at module level) to ensure window.gui_origin
    // and window.auth_token are already set.
    // =========================================================================
    window.socket = io(`${window.gui_origin}/`, {
        auth: {
            auth_token: window.auth_token,
        },
        transports: ['websocket', 'polling'],
        withCredentials: true,
    });

    window.socket.on('error', (error) => {
        console.error('Dashboard Socket Error:', error);
    });

    window.socket.on('connect', function () {
        window.socket.emit('puter_is_actually_open');
    });

    window.socket.on('reconnect', function () {
        console.log('Dashboard Socket: Reconnected', window.socket.id);
    });

    window.socket.on('disconnect', () => {
        console.log('Dashboard Socket: Disconnected');
    });

    window.socket.on('reconnect_attempt', (attempt) => {
        console.log('Dashboard Socket: Reconnection Attempt', attempt);
    });

    window.socket.on('reconnect_error', (error) => {
        console.log('Dashboard Socket: Reconnection Error', error);
    });

    window.socket.on('reconnect_failed', () => {
        console.log('Dashboard Socket: Reconnection Failed');
    });

    // Upload/download progress tracking
    window.socket.on('upload.progress', (msg) => {
        if ( window.progress_tracker[msg.operation_id] ) {
            window.progress_tracker[msg.operation_id].cloud_uploaded += msg.loaded_diff;
            if ( window.progress_tracker[msg.operation_id][msg.item_upload_id] ) {
                window.progress_tracker[msg.operation_id][msg.item_upload_id].cloud_uploaded = msg.loaded;
            }
        }
    });

    window.socket.on('download.progress', (msg) => {
        if ( window.progress_tracker[msg.operation_id] ) {
            if ( window.progress_tracker[msg.operation_id][msg.item_upload_id] ) {
                window.progress_tracker[msg.operation_id][msg.item_upload_id].downloaded = msg.loaded;
                window.progress_tracker[msg.operation_id][msg.item_upload_id].total = msg.total;
            }
        }
    });

    // Trash status updates
    window.socket.on('trash.is_empty', async (msg) => {
        // Update sidebar Trash icon
        const trashIcon = msg.is_empty ? window.icons['trash.svg'] : window.icons['trash-full.svg'];
        $('.directories [data-folder=\'Trash\'] img').attr('src', trashIcon);

        // If currently viewing trash and it's empty, clear the file list
        const dashboard = window.dashboard_object;
        if ( msg.is_empty && dashboard && dashboard.currentPath === window.trash_path ) {
            $('.files-tab .files').empty();
        }
    });

    // =========================================================================
    // Item event handlers
    // Incremental DOM updates using UIDashboardFileItem for item creation and
    // direct jQuery manipulation for removals/updates. Mirrors UIDesktop's
    // approach but adapted for Dashboard's list-view structure.
    // =========================================================================

    window.socket.on('item.moved', async (resp) => {
        if ( resp.original_client_socket_id === window.socket.id ) return;

        // Fade out old item from view
        $(`.item[data-uid='${resp.uid}']`).fadeOut(150, function () {
            $(this).remove();
        });

        // Create new item at destination if user is viewing that directory
        if ( window.UIDashboardFileItem ) {
            window.UIDashboardFileItem(resp);
        }
    });

    window.socket.on('item.removed', async (item) => {
        if ( item.original_client_socket_id === window.socket.id ) return;
        if ( item.descendants_only ) return;

        $(`.item[data-path='${html_encode(item.path)}']`).fadeOut(150, function () {
            $(this).remove();
        });
    });

    window.socket.on('item.renamed', async (item) => {
        if ( item.original_client_socket_id === window.socket.id ) return;

        const $el = $(`.item[data-uid='${item.uid}']`);
        if ( $el.length === 0 ) return;

        // Update data attributes
        $el.attr('data-name', html_encode(item.name));
        $el.attr('data-path', html_encode(item.path));

        // Update displayed name
        $el.find('.item-name').text(item.name);
        $el.find('.item-name-editor').val(item.name);
    });

    window.socket.on('item.updated', async (item) => {
        const $el = $(`.item[data-uid='${item.uid}']`);
        if ( $el.length === 0 ) return;

        // Update data attributes
        $el.attr('data-name', html_encode(item.name));
        $el.attr('data-path', html_encode(item.path));
        $el.attr('data-size', item.size);
        $el.attr('data-modified', item.modified);
        $el.attr('data-type', html_encode(item.type));

        // Update displayed name
        $el.find('.item-name').text(item.name);
        $el.find('.item-name-editor').val(item.name);

        if (
            window.dashboard_object?.currentView === 'grid'
            && typeof item.thumbnail === 'string'
            && item.thumbnail.length > 0
        ) {
            $el.find('.item-icon img').attr('src', item.thumbnail);
        }
    });

    window.socket.on('item.added', async (item) => {
        if ( _.isEmpty(item) ) return;
        if ( item.original_client_socket_id === window.socket.id ) return;

        if ( window.UIDashboardFileItem ) {
            window.UIDashboardFileItem(item);
        }
    });

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

    // Hide all running app windows (used when switching to dashboard tabs)
    function hideAllAppWindows () {
        runningApps.forEach((windows) => {
            windows.forEach(win => {
                $(win).css('visibility', 'hidden');
            });
        });
        updateSidebarAppStates();
    }

    // Show all windows for a specific app
    function showAppWindows (appName) {
        const windows = runningApps.get(appName);
        if ( ! windows ) return;
        windows.forEach(win => {
            $(win).css('visibility', 'visible');
            $(win).focusWindow();
        });
        updateSidebarAppStates();
    }

    // Sidebar item click handler
    $el_window.on('click', '.dashboard-sidebar-item', function () {
        const $this = $(this);
        const section = $this.attr('data-section');

        // If this is a tab navigation item (not a pinned/running app), hide app windows
        if ( section ) {
            hideAllAppWindows();
        }

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

    // Desktop sidebar collapse toggle
    $el_window.on('click', '.dashboard-sidebar-collapse-toggle', function () {
        const $sidebar = $el_window.find('.dashboard-sidebar');
        $sidebar.toggleClass('collapsed');
        localStorage.setItem('dashboard-sidebar-collapsed', $sidebar.hasClass('collapsed') ? '1' : '0');
    });

    // Sidebar collapsed tooltips
    const $tooltip = $('<div class="dashboard-sidebar-tooltip"></div>').appendTo('body');
    $el_window.on('mouseenter', '.dashboard-sidebar-item[data-tooltip]', function () {
        if ( ! $el_window.find('.dashboard-sidebar').hasClass('collapsed') ) return;
        const rect = this.getBoundingClientRect();
        $tooltip.text($(this).attr('data-tooltip'));
        $tooltip.css({
            top: rect.top + rect.height / 2 - $tooltip.outerHeight() / 2,
            left: rect.right + 8,
        });
        $tooltip.addClass('visible');
    });
    $el_window.on('mouseleave', '.dashboard-sidebar-item[data-tooltip]', function () {
        $tooltip.removeClass('visible');
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
                        await window.update_auth_data(l_user.auth_token, l_user);
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
