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

function getTimeGreeting () {
    const hour = new Date().getHours();
    if ( hour < 12 ) return 'Good morning';
    if ( hour < 17 ) return 'Good afternoon';
    return 'Good evening';
}

function buildRecentAppsHTML () {
    let h = '';
    
    if ( window.launch_apps?.recent?.length > 0 ) {
        h += '<div class="bento-recent-apps-grid">';
        // Show up to 6 recent apps
        const recentApps = window.launch_apps.recent.slice(0, 6);
        for ( const app_info of recentApps ) {
            h += `<div class="bento-recent-app" data-app-name="${html_encode(app_info.name)}">`;
            h += `<img class="bento-recent-app-icon" src="${html_encode(app_info.icon || window.icons['app.svg'])}">`;
            h += `<span class="bento-recent-app-title">${html_encode(app_info.title)}</span>`;
            h += '</div>';
        }
        h += '</div>';
    } else {
        h += '<div class="bento-recent-apps-empty">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">';
        h += '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>';
        h += '<rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>';
        h += '</svg>';
        h += '<p>No recent apps yet</p>';
        h += '<span>Apps you use will appear here</span>';
        h += '</div>';
    }
    
    return h;
}

const TabHome = {
    id: 'home',
    label: 'Home',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,

    html () {
        const username = window.user?.username || 'User';
        const greeting = getTimeGreeting();
        
        let h = '';
        h += '<div class="bento-container">';
        
        // Welcome card (square)
        h += '<div class="bento-card bento-welcome">';
        h += '<div class="bento-welcome-inner">';
        h += '<div class="bento-welcome-pattern"></div>';
        h += `<div class="bento-welcome-content">`;
        h += `<span class="bento-greeting">${greeting},</span>`;
        h += `<h1 class="bento-username">${html_encode(username)}</h1>`;
        h += '<p class="bento-tagline">Your personal cloud computer</p>';
        h += '</div>';
        h += '</div>';
        h += '</div>';
        
        // Recent apps card (rectangle)
        h += '<div class="bento-card bento-recent">';
        h += '<div class="bento-card-header">';
        h += '<h2>Recent Apps</h2>';
        h += '</div>';
        h += '<div class="bento-recent-apps-container">';
        h += buildRecentAppsHTML();
        h += '</div>';
        h += '</div>';
        
        h += '</div>';
        return h;
    },

    init ($el_window) {
        this.loadRecentApps($el_window);

        // Handle app clicks
        $el_window.on('click', '.bento-recent-app', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const appName = $(this).attr('data-app-name');
            if ( appName ) {
                window.open(`/app/${appName}`, '_blank');
            }
        });
    },

    async loadRecentApps ($el_window) {
        if ( !window.launch_apps?.recent?.length ) {
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
        $el_window.find('.bento-recent-apps-container').html(buildRecentAppsHTML());
    },

    onActivate ($el_window) {
        this.loadRecentApps($el_window);
    },
};

export default TabHome;

