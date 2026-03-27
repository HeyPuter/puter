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

    let h = '<div class="myapps-grid myapps-grid-loading">';
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

function revealWhenLoaded ($container) {
    const $grid = $container.find('.myapps-grid-loading');
    if ( $grid.length === 0 ) return;

    const imgs = $grid.find('img').toArray();
    if ( imgs.length === 0 ) {
        $grid.removeClass('myapps-grid-loading');
        return;
    }

    let loaded = 0;
    const total = imgs.length;

    function onDone () {
        loaded++;
        if ( loaded >= total ) {
            $grid.removeClass('myapps-grid-loading');
        }
    }

    for ( const img of imgs ) {
        if ( img.complete ) {
            onDone();
        } else {
            img.addEventListener('load', onDone, { once: true });
            img.addEventListener('error', onDone, { once: true });
        }
    }
}

const TabApps = {
    id: 'apps',
    label: 'Apps',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',

    _apps: null,

    html () {
        let h = '<div class="dashboard-tab-content myapps-tab">';
        h += '<div class="myapps-search-wrap">';
        h += '<svg class="myapps-search-icon myapps-icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        h += '<svg class="myapps-search-icon myapps-icon-clear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        h += '<input type="text" class="myapps-search" placeholder="Search apps..." autocomplete="off" spellcheck="false">';
        h += '</div>';
        h += '<div class="myapps-container">';
        h += '<div class="myapps-loading">Loading apps...</div>';
        h += '</div>';
        h += '</div>';
        return h;
    },

    init ($el_window) {
        this.loadApps($el_window);

        const self = this;

        // Toggle search/clear icons and filter
        function updateSearch ($input) {
            const query = $input.val().toLowerCase().trim();
            const hasText = query.length > 0;
            $el_window.find('.myapps-icon-search').toggle(!hasText);
            $el_window.find('.myapps-icon-clear').toggle(hasText);

            if ( ! self._apps ) return;

            const $container = $el_window.find('.myapps-container');

            if ( ! query ) {
                $container.html(buildAppsGrid(self._apps));
                revealWhenLoaded($container);
                return;
            }

            const filtered = self._apps.filter(app => {
                const title = (app.title || '').toLowerCase();
                const name = (app.name || '').toLowerCase();
                return title.includes(query) || name.includes(query);
            });

            $container.html(
                filtered.length > 0
                    ? buildAppsGrid(filtered)
                    : '<div class="myapps-empty"><p>No apps match your search</p></div>',
            );
            revealWhenLoaded($container);
        }

        $el_window.on('input', '.myapps-search', function () {
            updateSearch($(this));
        });

        // Clear search on cross click
        $el_window.on('click', '.myapps-icon-clear', function () {
            const $input = $el_window.find('.myapps-search');
            $input.val('').focus();
            updateSearch($input);
        });

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
            // Fetch both APIs in parallel
            const [installedRes, launchRes] = await Promise.all([
                fetch(
                    `${window.api_origin}/installedApps?orderBy=name&limit=100`,
                    {
                        headers: { 'Authorization': `Bearer ${puter.authToken}` },
                        method: 'GET',
                    },
                ),
                fetch(
                    `${window.api_origin}/get-launch-apps?icon_size=64`,
                    {
                        headers: { 'Authorization': `Bearer ${window.auth_token}` },
                        method: 'GET',
                    },
                ),
            ]);

            const installedApps = await installedRes.json();
            const launchData = await launchRes.json();

            // Normalize launch apps (recommended + recent) to same shape
            const launchApps = [
                ...(launchData.recommended || []),
                ...(launchData.recent || []),
            ].map(app => ({
                name: app.name,
                title: app.title,
                iconUrl: app.icon || null,
            }));

            // Build seen set from launch apps
            const seen = new Set();
            const merged = [];

            for ( const app of launchApps ) {
                if ( seen.has(app.name) ) continue;
                seen.add(app.name);
                merged.push(app);
            }

            // Append installed apps that aren't already in the list
            for ( const app of installedApps ) {
                if ( seen.has(app.name) ) continue;
                seen.add(app.name);
                merged.push(app);
            }

            this._apps = merged;
            $container.html(buildAppsGrid(merged));
            revealWhenLoaded($container);
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
