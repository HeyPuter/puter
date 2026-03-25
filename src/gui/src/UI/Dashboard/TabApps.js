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

function buildAppsGrid (apps) {
    if ( !apps || apps.length === 0 ) {
        let h = '<div class="myapps-empty">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">';
        h += '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>';
        h += '<rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>';
        h += '</svg>';
        h += '<p>No apps installed yet</p>';
        h += '</div>';
        return h;
    }

    let h = '<div class="myapps-grid">';
    for ( const app of apps ) {
        const title = (app.title || app.name || '').trim();
        const iconUrl = app.iconUrl || window.icons['app.svg'];

        h += `<div class="myapps-tile" data-app-name="${html_encode(app.name)}" title="${html_encode(title)}">`;
        h += '<div class="myapps-tile-icon">';
        h += `<img src="${html_encode(iconUrl)}" alt="" draggable="false">`;
        h += '</div>';
        h += `<span class="myapps-tile-label">${html_encode(title)}</span>`;
        h += '</div>';
    }
    h += '</div>';
    return h;
}

const TabApps = {
    id: 'apps',
    label: 'Apps',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',

    _apps: null,

    html () {
        let h = '<div class="dashboard-tab-content myapps-tab">';
        h += '<div class="myapps-container">';
        h += '<div class="myapps-loading">Loading apps...</div>';
        h += '</div>';
        h += '</div>';
        return h;
    },

    init ($el_window) {
        this.loadApps($el_window);

        // Handle app tile clicks
        $el_window.on('click', '.myapps-tile', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const appName = $(this).attr('data-app-name');
            if ( appName ) {
                window.open(`/app/${appName}`, '_blank');
            }
        });
    },

    async loadApps ($el_window) {
        const $container = $el_window.find('.myapps-container');

        try {
            const res = await fetch(
                `${window.api_origin}/installedApps?orderBy=name&limit=100`,
                {
                    headers: {
                        'Authorization': `Bearer ${puter.authToken}`,
                    },
                    method: 'GET',
                },
            );
            const apps = await res.json();
            this._apps = apps;
            $container.html(buildAppsGrid(apps));
        } catch (e) {
            console.error('Failed to load installed apps:', e);
            $container.html('<div class="myapps-empty"><p>Failed to load apps</p></div>');
        }
    },

    onActivate ($el_window) {
        this.loadApps($el_window);
    },
};

export default TabApps;
