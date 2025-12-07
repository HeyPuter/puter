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

function buildAppsSection () {
    let apps_str = '';
    if ( window.launch_apps?.recommended?.length > 0 ) {
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

const TabApps = {
    id: 'apps',
    label: 'My Apps',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,

    html () {
        return '<div class="dashboard-apps-container"></div>';
    },

    init ($el_window) {
        // Load apps initially
        this.loadApps($el_window);

        // Handle app clicks - open in new browser tab
        $el_window.on('click', '.dashboard-apps-container .start-app', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const appName = $(this).attr('data-app-name');
            if ( appName ) {
                const appUrl = `/app/${appName}`;
                window.open(appUrl, '_blank');
            }
        });
    },

    async loadApps ($el_window) {
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
    },

    onActivate ($el_window) {
        // Refresh apps when navigating to apps section
        this.loadApps($el_window);
    },
};

export default TabApps;

