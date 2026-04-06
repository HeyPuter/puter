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

        h += `<div class="myapps-tile" data-app-name="${html_encode(app.name)}" data-app-uid="${html_encode(app.uid || '')}" data-app-icon="${html_encode(iconUrl)}" title="${html_encode(title)}" draggable="true">`;
        h += '<div class="myapps-tile-icon">';
        h += `<img src="${html_encode(iconUrl)}" alt="" draggable="false">`;
        h += '</div>';
        h += `<span class="myapps-tile-label">${html_encode(title)}</span>`;
        h += '</div>';
    }
    h += '</div>';
    return h;
}

function sortApps (apps, mode, customOrder) {
    const sorted = [...apps];
    switch ( mode ) {
        case 'name-asc':
            sorted.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''));
            break;
        case 'name-desc':
            sorted.sort((a, b) => (b.title || b.name || '').localeCompare(a.title || a.name || ''));
            break;
        case 'recent':
            // Keep original order — recent/recommended apps come first from API
            break;
        case 'date-added':
            sorted.sort((a, b) => {
                const da = a.installed_at || '';
                const db = b.installed_at || '';
                return db.localeCompare(da);
            });
            break;
        case 'custom':
            if ( customOrder && customOrder.length > 0 ) {
                const orderMap = new Map();
                customOrder.forEach((name, i) => orderMap.set(name, i));
                sorted.sort((a, b) => {
                    const ia = orderMap.has(a.name) ? orderMap.get(a.name) : Infinity;
                    const ib = orderMap.has(b.name) ? orderMap.get(b.name) : Infinity;
                    return ia - ib;
                });
            }
            break;
    }
    return sorted;
}

function showUninstallModal ({ appName, appUid, self, $el_window }) {
    const $overlay = $(`
        <div class="myapps-modal-overlay">
            <div class="myapps-modal">
                <h3>Uninstall ${html_encode(appName)}?</h3>
                <p>This will revoke all permissions for this app.</p>
                <label class="myapps-modal-checkbox">
                    <input type="checkbox" class="myapps-modal-delete-data">
                    Also remove all app data
                </label>
                <div class="myapps-modal-buttons">
                    <button class="myapps-modal-btn myapps-modal-cancel">Cancel</button>
                    <button class="myapps-modal-btn myapps-modal-confirm">Uninstall</button>
                </div>
            </div>
        </div>
    `);

    $el_window.append($overlay);

    const close = () => $overlay.remove();

    $overlay.on('click', '.myapps-modal-cancel', close);
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] ) close();
    });
    $(document).on('keydown.uninstall-modal', function (e) {
        if ( e.key === 'Escape' ) {
            close();
            $(document).off('keydown.uninstall-modal');
        }
    });

    $overlay.on('click', '.myapps-modal-confirm', async function () {
        const deleteData = $overlay.find('.myapps-modal-delete-data').is(':checked');
        const $btn = $(this);
        $btn.prop('disabled', true).text('Uninstalling…');

        try {
            await puter.perms.revokeApp(appUid, '*');
            if ( deleteData ) {
                await puter.kv.flush({ appUuid: appUid });
            }
            // Remove from internal state
            self._apps = self._apps.filter(a => a.name !== appName);
            if ( self._customOrder ) {
                self._customOrder = self._customOrder.filter(n => n !== appName);
                puter.kv.set('dashboard_apps_custom_order', JSON.stringify(self._customOrder));
            }
            // Remove tile from DOM
            $el_window.find(`.myapps-tile[data-app-name="${appName}"]`).remove();
            // Show empty state if no apps left
            if ( self._apps.length === 0 && self._renderApps ) {
                self._renderApps();
            }
        } catch ( err ) {
            console.error('Failed to uninstall app:', err);
        }
        close();
        $(document).off('keydown.uninstall-modal');
    });
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
    _sortMode: 'name-asc',
    _customOrder: null,
    _sortableActive: false,
    _isDragging: false,

    html () {
        let h = '<div class="dashboard-tab-content myapps-tab">';
        // Toolbar matching Files tab header bar
        h += '<div class="myapps-toolbar">';
        h += '<div class="myapps-search-wrap">';
        h += '<svg class="myapps-search-icon myapps-icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        h += '<svg class="myapps-search-icon myapps-icon-clear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        h += '<input type="text" class="myapps-search" placeholder="Search apps..." autocomplete="off" spellcheck="false">';
        h += '</div>';
        h += '<div class="myapps-toolbar-actions">';
        h += '<div class="myapps-sort-wrap">';
        h += '<button class="myapps-sort-btn" title="Sort apps">';
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>';
        h += '</button>';
        h += '<div class="myapps-sort-dropdown" style="display:none">';
        h += '<div class="myapps-sort-option active" data-sort="name-asc">Name (A-Z)</div>';
        h += '<div class="myapps-sort-option" data-sort="name-desc">Name (Z-A)</div>';
        h += '<div class="myapps-sort-option" data-sort="recent">Recently Used</div>';
        h += '<div class="myapps-sort-option" data-sort="date-added">Date Added</div>';
        h += '<div class="myapps-sort-option" data-sort="custom">Custom Order</div>';
        h += '</div>';
        h += '</div>';
        h += '</div>';
        h += '</div>';
        h += '<div class="myapps-container">';
        h += '</div>';
        // Context menu (hidden by default)
        h += '<div class="myapps-context-menu" style="display:none">';
        h += '<div class="myapps-context-menu-item" data-action="open-window">Open in Window (default)</div>';
        h += '<div class="myapps-context-menu-item" data-action="open-tab">Open in Tab</div>';
        h += '<div class="myapps-context-menu-divider"></div>';
        h += '<div class="myapps-context-menu-item" data-action="uninstall">Uninstall</div>';
        h += '</div>';
        h += '</div>';
        return h;
    },

    async init ($el_window) {
        // Load persisted sort preferences
        try {
            const [savedMode, savedOrder] = await Promise.all([
                puter.kv.get('dashboard_apps_sort_mode'),
                puter.kv.get('dashboard_apps_custom_order'),
            ]);
            if ( savedMode ) {
                this._sortMode = savedMode;
                $el_window.find('.myapps-sort-option').removeClass('active');
                $el_window.find(`.myapps-sort-option[data-sort="${savedMode}"]`).addClass('active');
            }
            if ( savedOrder ) {
                try {
                    this._customOrder = JSON.parse(savedOrder);
                }
                catch (_) {
                    this._customOrder = null;
                }
            }
        } catch (_) {
            // KV not available — use defaults
        }

        this.loadApps($el_window);

        const self = this;

        function enableSortable () {
            const $grid = $el_window.find('.myapps-grid');
            if ( $grid.length === 0 ) return;
            $grid.addClass('myapps-grid-custom');
            $grid.sortable({
                items: '.myapps-tile',
                tolerance: 'pointer',
                placeholder: 'myapps-tile-placeholder',
                revert: 80,
                distance: 5,
                start () {
                    self._isDragging = true;
                },
                stop () {
                    setTimeout(() => {
                        self._isDragging = false;
                    }, 50);
                },
                update () {
                    const orderedNames = [];
                    $grid.find('.myapps-tile').each(function () {
                        orderedNames.push($(this).attr('data-app-name'));
                    });
                    self._customOrder = orderedNames;
                    puter.kv.set('dashboard_apps_custom_order', JSON.stringify(orderedNames));
                },
            });
            self._sortableActive = true;
        }

        function disableSortable () {
            const $grid = $el_window.find('.myapps-grid');
            if ( $grid.length === 0 ) return;
            $grid.removeClass('myapps-grid-custom');
            if ( $grid.sortable('instance') ) {
                $grid.sortable('destroy');
            }
            self._sortableActive = false;
        }

        function renderApps () {
            if ( ! self._apps ) return;
            const $container = $el_window.find('.myapps-container');
            const query = $el_window.find('.myapps-search').val().toLowerCase().trim();
            let apps = sortApps(self._apps, self._sortMode, self._customOrder);

            if ( query ) {
                apps = apps.filter(app => {
                    const title = (app.title || '').toLowerCase();
                    const name = (app.name || '').toLowerCase();
                    return title.includes(query) || name.includes(query);
                });
            }

            $container.html(
                apps.length > 0
                    ? buildAppsGrid(apps)
                    : `<div class="myapps-empty"><p>${ query ? 'No apps match your search' : 'No apps installed yet' }</p></div>`,
            );
            revealWhenLoaded($container);

            // Enable/disable sortable based on mode and search state
            if ( self._sortMode === 'custom' && !query ) {
                enableSortable();
            } else {
                disableSortable();
            }
        }

        // Toggle search/clear icons and filter
        $el_window.on('input', '.myapps-search', function () {
            const query = $(this).val().trim();
            $el_window.find('.myapps-icon-search').toggle(!query);
            $el_window.find('.myapps-icon-clear').toggle(!!query);
            renderApps();
        });

        // Clear search on cross click
        $el_window.on('click', '.myapps-icon-clear', function () {
            const $input = $el_window.find('.myapps-search');
            $input.val('').focus();
            $el_window.find('.myapps-icon-search').show();
            $el_window.find('.myapps-icon-clear').hide();
            renderApps();
        });

        // Sort dropdown toggle
        $el_window.on('click', '.myapps-sort-btn', function (e) {
            e.stopPropagation();
            const $dropdown = $el_window.find('.myapps-sort-dropdown');
            $dropdown.toggle();
        });

        // Sort option click
        $el_window.on('click', '.myapps-sort-option', function (e) {
            e.stopPropagation();
            const mode = $(this).attr('data-sort');
            self._sortMode = mode;
            $el_window.find('.myapps-sort-option').removeClass('active');
            $(this).addClass('active');
            $el_window.find('.myapps-sort-dropdown').hide();
            puter.kv.set('dashboard_apps_sort_mode', mode);
            // Initialize custom order from current view if switching to custom for the first time
            if ( mode === 'custom' && !self._customOrder && self._apps ) {
                self._customOrder = self._apps.map(a => a.name);
                puter.kv.set('dashboard_apps_custom_order', JSON.stringify(self._customOrder));
            }
            renderApps();
        });

        // Close sort dropdown on outside click
        $(document).on('click', function () {
            $el_window.find('.myapps-sort-dropdown').hide();
        });

        // Handle app tile clicks — open in window by default, Alt+click opens in new tab
        $el_window.on('click', '.myapps-tile', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if ( self._isDragging ) return;
            const appName = $(this).attr('data-app-name');
            if ( ! appName ) return;
            if ( e.altKey ) {
                window.open(`/app/${ appName}`, '_blank');
                return;
            }
            if ( window.dashboard_open_app_in_window ) {
                const appIcon = $(this).attr('data-app-icon');
                const appTitle = $(this).attr('title');
                window.dashboard_open_app_in_window(appName, appIcon, appTitle);
            }
        });

        // Context menu on right-click
        $el_window.on('contextmenu', '.myapps-tile', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const $menu = $el_window.find('.myapps-context-menu');
            $menu.css({ top: `${e.clientY }px`, left: `${e.clientX }px` }).show();
            $menu.data('app-name', $(this).attr('data-app-name'));
            $menu.data('app-uid', $(this).attr('data-app-uid'));
            $menu.data('app-icon', $(this).attr('data-app-icon'));
            $menu.data('app-title', $(this).attr('title'));
        });

        // Context menu item click
        $el_window.on('click', '.myapps-context-menu-item', function () {
            const action = $(this).attr('data-action');
            const $menu = $el_window.find('.myapps-context-menu');
            const appName = $menu.data('app-name');
            const appUid = $menu.data('app-uid');
            if ( action === 'open-tab' ) {
                $menu.hide();
                window.open(`/app/${appName}`, '_blank');
                return;
            }
            if ( action === 'open-window' ) {
                $menu.hide();
                if ( window.dashboard_open_app_in_window ) {
                    window.dashboard_open_app_in_window(appName, $menu.data('app-icon'), $menu.data('app-title'));
                }
                return;
            }
            if ( action === 'uninstall' ) {
                $menu.hide();
                showUninstallModal({ appName, appUid, self, $el_window });
                return;
            }
            $menu.hide();
        });

        // Close context menu on outside click or Escape
        $(document).on('click', function () {
            $el_window.find('.myapps-context-menu').hide();
        });
        $(document).on('keydown', function (e) {
            if ( e.key === 'Escape' ) {
                $el_window.find('.myapps-context-menu').hide();
                $el_window.find('.myapps-sort-dropdown').hide();
            }
        });

        // Drag app tile to sidebar
        $el_window.on('dragstart', '.myapps-tile', function (e) {
            const $tile = $(this);
            const appData = JSON.stringify({
                name: $tile.attr('data-app-name'),
                title: $tile.attr('title'),
                iconUrl: $tile.attr('data-app-icon'),
            });
            e.originalEvent.dataTransfer.setData('application/x-puter-app', appData);
            e.originalEvent.dataTransfer.effectAllowed = 'copy';
        });

        this._renderApps = renderApps;
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
                merged.push({
                    ...app,
                    installed_at: app.installed_at || '',
                });
            }

            this._apps = merged;

            // Reconcile custom order with current app list
            if ( this._customOrder ) {
                const appNames = new Set(merged.map(a => a.name));
                // Remove apps no longer present
                this._customOrder = this._customOrder.filter(n => appNames.has(n));
                // Append new apps not yet in custom order
                const inOrder = new Set(this._customOrder);
                for ( const app of merged ) {
                    if ( ! inOrder.has(app.name) ) {
                        this._customOrder.push(app.name);
                    }
                }
            }

            if ( this._renderApps ) {
                this._renderApps();
            } else {
                $container.html(buildAppsGrid(sortApps(merged, this._sortMode, this._customOrder)));
                revealWhenLoaded($container);
            }
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
