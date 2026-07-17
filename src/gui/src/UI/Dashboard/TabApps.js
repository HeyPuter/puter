import UIContextMenu from '../UIContextMenu.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';

/** Lowercase app names that must not offer Uninstall in the My Apps tile context menu. */
const APP_NAMES_NO_UNINSTALL = new Set([
    'dev-center',
    'app-center',
    'editor',
    'camera',
    'recorder',
    'memos',
    'music-player',
    'ai',
]);

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

// External apps (not owned by a Puter user) can report an opaque app-… id
// as their title (uid === name === title); in that case show the hostname
// of index_url instead, and open the app's website (index_url) on click —
// matching the Home tab.
function resolveTileDisplay (app) {
    let title = (app.title || app.name || '').trim();
    let targetLink = '';

    const appUid = app.uid || app.uuid;
    if (
        app.external &&
        app.name === app.title &&
        app.name === appUid &&
        app.index_url
    ) {
        title = new URL(app.index_url).hostname;
        targetLink = app.index_url;
    }

    return { title, targetLink };
}

function buildTileHtml (app) {
    const { title, targetLink } = resolveTileDisplay(app);
    const iconUrl = app.iconUrl || window.icons['app.svg'];

    let h = `<div class="myapps-tile" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(title)}" data-app-uid="${html_encode(app.uid || '')}" data-target-link="${html_encode(targetLink)}" title="${html_encode(title)}">`;
    h += '<div class="myapps-tile-icon">';
    h += `<img src="${html_encode(iconUrl)}" alt="" draggable="false">`;
    h += '</div>';
    h += `<span class="myapps-tile-label">${html_encode(title)}</span>`;
    h += '</div>';
    return h;
}

function buildNoAppsHtml () {
    let h = '<div class="myapps-empty">';
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">';
    h += '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>';
    h += '<rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>';
    h += '</svg>';
    h += '<p>No apps installed yet</p>';
    h += '</div>';
    return h;
}

// iOS-home-screen-style pager: fixed cols × rows pages in a horizontal
// scroll-snap scroller, with page dots below and hover arrows for mouse users.
function buildPagerHtml (apps, layout) {
    const pageCount = Math.ceil(apps.length / layout.perPage);

    let h = `<div class="myapps-pager myapps-pager-loading" style="--myapps-cols: ${layout.cols}">`;

    h += '<div class="myapps-pager-scroller">';
    for ( let p = 0; p < pageCount; p++ ) {
        h += '<div class="myapps-page">';
        for ( const app of apps.slice(p * layout.perPage, (p + 1) * layout.perPage) ) {
            h += buildTileHtml(app);
        }
        h += '</div>';
    }
    h += '</div>';

    h += '<button class="myapps-pager-arrow myapps-pager-arrow-prev" aria-label="Previous page">';
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    h += '</button>';
    h += '<button class="myapps-pager-arrow myapps-pager-arrow-next" aria-label="Next page">';
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    h += '</button>';

    h += `<div class="myapps-pager-dots${pageCount < 2 ? ' myapps-pager-dots-hidden' : ''}" aria-label="App pages">`;
    for ( let p = 0; p < pageCount; p++ ) {
        h += `<button class="myapps-pager-dot" data-page="${p}" aria-label="Page ${p + 1} of ${pageCount}"></button>`;
    }
    h += '</div>';

    h += '</div>';
    return h;
}

function showUninstallModal ({ appName, appTitle, appUid, self, $el_window }) {
    const displayName = (appTitle || appName || '').trim();
    const $overlay = $(`
        <div class="myapps-modal-overlay">
            <div class="myapps-modal">
                <h3>Uninstall ${html_encode(displayName)}?</h3>
                <p>This will revoke all permissions for this app.</p>
                <div class="myapps-modal-buttons">
                    <button class="myapps-modal-btn myapps-modal-cancel">Cancel</button>
                    <button class="myapps-modal-btn myapps-modal-confirm">Uninstall</button>
                </div>
            </div>
        </div>
    `);

    $el_window.append($overlay);

    const close = () => {
        $overlay.remove();
        $(document).off('keydown.uninstall-modal');
    };

    $overlay.on('click', '.myapps-modal-cancel', close);
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] ) close();
    });
    $(document).on('keydown.uninstall-modal', function (e) {
        if ( e.key === 'Escape' ) close();
    });

    $overlay.on('click', '.myapps-modal-confirm', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true).text('Uninstalling…');

        try {
            await puter.perms.revokeApp(appUid, '*');
            self._apps = self._apps.filter(a => a.name !== appName);
            self.renderApps($el_window, { preservePage: true });
        } catch ( err ) {
            console.error('Failed to uninstall app:', err);
        }
        close();
    });
}

function revealWhenLoaded ($container) {
    const $pager = $container.find('.myapps-pager-loading');
    if ( $pager.length === 0 ) return;

    // Only the first page's icons gate the fade-in; the other pages are
    // offscreen and their icons can finish loading behind it.
    const imgs = $pager.find('.myapps-page').first().find('img').toArray();
    if ( imgs.length === 0 ) {
        $pager.removeClass('myapps-pager-loading');
        return;
    }

    let loaded = 0;
    const total = imgs.length;

    function onDone () {
        loaded++;
        if ( loaded >= total ) {
            $pager.removeClass('myapps-pager-loading');
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
    _layout: null,
    _page: 0,
    _pageCount: 0,

    html () {
        let h = '<div class="dashboard-tab-content myapps-tab">';
        h += '<div class="myapps-search-wrap">';
        h += '<div class="myapps-search-inner">';
        h += '<svg class="myapps-search-icon myapps-icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        h += '<svg class="myapps-search-icon myapps-icon-clear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        // type="search" (plus autocomplete/autofill opt-outs) keeps Chrome from
        // offering email/contact autofill suggestions on focus.
        h += '<input type="search" name="myapps-search" class="myapps-search" placeholder="Search apps..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-form-type="other" data-lpignore="true" data-1p-ignore>';
        h += '</div>';
        h += '</div>';
        h += '<div class="myapps-container">';
        h += '</div>';
        h += '</div>';
        return h;
    },

    init ($el_window) {
        this.loadApps($el_window);

        const self = this;

        $el_window.on('input', '.myapps-search', function () {
            self.updateSearchIcons($el_window);
            self.renderApps($el_window);
        });

        // Clear search on cross click
        $el_window.on('click', '.myapps-icon-clear', function () {
            $el_window.find('.myapps-search').val('').focus();
            self.updateSearchIcons($el_window);
            self.renderApps($el_window);
        });

        // Handle app tile clicks. External apps carry a target link (their
        // index_url) and open the app's website directly; everything else
        // opens the Puter app page — matching the Home tab.
        $el_window.on('click', '.myapps-tile', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const appName = $(this).attr('data-app-name');
            const targetLink = $(this).attr('data-target-link');
            if ( targetLink && targetLink !== '' ) {
                window.open(targetLink, '_blank');
            } else if ( appName ) {
                window.open(`/app/${appName}`, '_blank');
            }
        });

        // Context menu on right-click
        $el_window.on('contextmenu', '.myapps-tile', function (e) {
            const appName = $(this).attr('data-app-name');
            const appTitle = $(this).attr('data-app-title');
            const appUid = $(this).attr('data-app-uid');
            const nameLower = (appName || '').toLowerCase();
            const noUninstall = APP_NAMES_NO_UNINSTALL.has(nameLower);

            const items = noUninstall
                ? []
                : [
                    {
                        html: 'Uninstall',
                        onClick: () => {
                            showUninstallModal({
                                appName,
                                appTitle,
                                appUid,
                                self,
                                $el_window,
                            });
                        },
                    },
                ];

            if ( items.length === 0 ) return;

            e.preventDefault();
            e.stopPropagation();

            UIContextMenu({
                parent_element: $(this),
                position: { top: e.clientY, left: e.clientX },
                items,
            });
        });

        // -- Pager navigation --

        $el_window.on('click', '.myapps-pager-dot', function () {
            self.goToPage($el_window, parseInt($(this).attr('data-page'), 10), true);
        });

        $el_window.on('click', '.myapps-pager-arrow-prev', function () {
            self.goToPage($el_window, self._page - 1, true);
        });

        $el_window.on('click', '.myapps-pager-arrow-next', function () {
            self.goToPage($el_window, self._page + 1, true);
        });

        // Mouse wheel / two-finger vertical swipe flips one page per gesture.
        // Horizontal trackpad panning is left to the native scroller, whose
        // snap points already handle it.
        $el_window.on('wheel', '.myapps-pager-scroller', function (e) {
            const oe = e.originalEvent;
            if ( Math.abs(oe.deltaX) > Math.abs(oe.deltaY) ) return;
            if ( Math.abs(oe.deltaY) < 4 ) return;
            e.preventDefault();
            // Inertial scrolling keeps emitting events after the flip; treat
            // everything within 150ms of the last event as the same gesture.
            clearTimeout(self._wheelTimer);
            self._wheelTimer = setTimeout(() => {
                self._wheelActive = false;
            }, 150);
            if ( self._wheelActive ) return;
            self._wheelActive = true;
            self.goToPage($el_window, self._page + (oe.deltaY > 0 ? 1 : -1), true);
        });

        // Left/right arrow keys flip pages, including while the (empty) search
        // box holds focus — it's auto-focused on desktop, Launchpad-style.
        $(document).off('keydown.myapps-pager').on('keydown.myapps-pager', function (e) {
            if ( e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' ) return;
            if ( ! $el_window.find('.dashboard-section-apps').hasClass('active') ) return;
            if ( ! $el_window.is(':visible') ) return;
            if ( $el_window.find('.myapps-modal-overlay').length ) return;
            if ( $('.window').not($el_window[0]).filter(':visible').length ) return;
            const ae = document.activeElement;
            if ( ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable) ) {
                if ( ! ($(ae).hasClass('myapps-search') && ae.value === '') ) return;
            }
            e.preventDefault();
            self.goToPage($el_window, self._page + (e.key === 'ArrowRight' ? 1 : -1), true);
        });

        // Re-paginate when the container resizes (window resize, sidebar
        // collapse, tab becoming visible, on-screen keyboard, …).
        if ( self._resizeObserver ) self._resizeObserver.disconnect();
        self._resizeObserver = new ResizeObserver(() => {
            clearTimeout(self._resizeTimer);
            self._resizeTimer = setTimeout(() => {
                if ( ! self._apps ) return;
                const layout = self.computeLayout($el_window.find('.myapps-container'));
                if ( ! layout ) return;
                if ( self._layout && layout.cols === self._layout.cols && layout.rows === self._layout.rows ) {
                    // Same grid, new page width — just re-align the scroller.
                    self.goToPage($el_window, self._page, false);
                    return;
                }
                self.renderApps($el_window, { preservePage: true });
            }, 100);
        });
        self._resizeObserver.observe($el_window.find('.myapps-container')[0]);
    },

    updateSearchIcons ($el_window) {
        const hasText = String($el_window.find('.myapps-search').val() || '').trim().length > 0;
        $el_window.find('.myapps-icon-search').toggle(!hasText);
        $el_window.find('.myapps-icon-clear').toggle(hasText);
    },

    computeLayout ($container) {
        const el = $container[0];
        if ( ! el || el.clientWidth === 0 || el.clientHeight === 0 ) return null;

        const cs = getComputedStyle(el);
        const readVar = (name, fallback) => {
            const v = parseFloat(cs.getPropertyValue(name));
            return Number.isFinite(v) ? v : fallback;
        };
        const tileW = readVar('--myapps-tile-w', 100);
        const tileH = readVar('--myapps-tile-h', 78);
        const gapX = readVar('--myapps-gap-x', 32);
        const gapY = readVar('--myapps-gap-y', 32);
        const dotsH = readVar('--myapps-dots-h', 28);

        const width = el.clientWidth;
        const height = Math.max(tileH, el.clientHeight - dotsH);
        const cols = Math.max(1, Math.floor((width + gapX) / (tileW + gapX)));
        const rows = Math.max(1, Math.floor((height + gapY) / (tileH + gapY)));
        return { cols, rows, perPage: cols * rows };
    },

    // Central renderer: applies the current search query to _apps and rebuilds
    // the pager (or an empty state). Everything that changes what's shown —
    // load, search, uninstall, re-layout — funnels through here.
    renderApps ($el_window, { preservePage = false } = {}) {
        if ( ! this._apps ) return;

        const $container = $el_window.find('.myapps-container');
        const query = String($el_window.find('.myapps-search').val() || '').toLowerCase().trim();

        let list = this._apps;
        if ( query ) {
            // Match the same values the tiles expose as data-app-name,
            // data-app-title (the displayed title, e.g. the hostname for
            // website shortcuts), and data-app-uid.
            list = list.filter(app => {
                const title = resolveTileDisplay(app).title.toLowerCase();
                const rawTitle = (app.title || '').toLowerCase();
                const name = (app.name || '').toLowerCase();
                const uid = String(app.uid || app.uuid || '').toLowerCase();
                return title.includes(query) || rawTitle.includes(query)
                    || name.includes(query) || uid.includes(query);
            });
        }

        if ( list.length === 0 ) {
            this._layout = null;
            this._page = 0;
            this._pageCount = 0;
            $container.html(query
                ? '<div class="myapps-empty"><p>No apps match your search</p></div>'
                : buildNoAppsHtml());
            return;
        }

        const layout = this.computeLayout($container);
        if ( ! layout ) {
            // Not laid out yet (e.g. hidden while the window enters full-page
            // mode); the ResizeObserver re-renders once there's a size.
            return;
        }

        const anchorIndex = (preservePage && this._layout)
            ? this._page * this._layout.perPage
            : 0;

        this._layout = layout;
        this._pageCount = Math.ceil(list.length / layout.perPage);
        this._page = Math.min(Math.floor(anchorIndex / layout.perPage), this._pageCount - 1);

        $container.html(buildPagerHtml(list, layout));
        revealWhenLoaded($container);

        const scroller = $container.find('.myapps-pager-scroller')[0];
        if ( this._page > 0 ) {
            scroller.scrollLeft = this._page * scroller.clientWidth;
        }
        this.updatePagerUI($el_window);

        // Keep the active dot and arrows in sync with swipes/scrolls.
        const self = this;
        let ticking = false;
        scroller.addEventListener('scroll', () => {
            if ( ticking ) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                const pageW = scroller.clientWidth || 1;
                const idx = Math.round(Math.abs(scroller.scrollLeft) / pageW);
                const page = Math.max(0, Math.min(self._pageCount - 1, idx));
                if ( page !== self._page ) {
                    self._page = page;
                    self.updatePagerUI($el_window);
                }
            });
        }, { passive: true });
    },

    updatePagerUI ($el_window) {
        const $container = $el_window.find('.myapps-container');
        const page = this._page;
        $container.find('.myapps-pager-dot').each(function (i) {
            this.classList.toggle('active', i === page);
            if ( i === page ) {
                this.setAttribute('aria-current', 'true');
            } else {
                this.removeAttribute('aria-current');
            }
        });
        $container.find('.myapps-pager-arrow-prev')
            .toggleClass('myapps-pager-arrow-hidden', page <= 0);
        $container.find('.myapps-pager-arrow-next')
            .toggleClass('myapps-pager-arrow-hidden', page >= this._pageCount - 1);
    },

    goToPage ($el_window, index, smooth) {
        const scroller = $el_window.find('.myapps-pager-scroller')[0];
        if ( ! scroller || this._pageCount === 0 ) return;
        const page = Math.max(0, Math.min(this._pageCount - 1, index));
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        scroller.scrollTo({
            left: page * scroller.clientWidth,
            behavior: (smooth && !reduceMotion) ? 'smooth' : 'auto',
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
                    `${window.api_origin}/get-launch-apps?icon_size=128`,
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
                uid: app.uuid || app.uid || null,
                index_url: app.index_url || null,
                external: app.external ?? false,
                iconUrl: app.iconUrl || app.icon || null,
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
            this.renderApps($el_window);
        } catch (e) {
            console.error('Failed to load installed apps:', e);
            $container.html('<div class="myapps-empty"><p>Failed to load apps</p></div>');
        }
    },

    onActivate ($el_window) {
        this.loadApps($el_window);
        this.focusSearch($el_window);
    },

    // Focus the search box on desktop so users can type right away. Skips
    // touch-primary devices to avoid popping up the on-screen keyboard. On a
    // direct load (e.g. #apps in the URL) the dashboard window is briefly
    // hidden while it enters full-page mode, so .focus() would be a no-op;
    // retry on a short interval until the input is actually visible.
    focusSearch ($el_window, attempts = 12) {
        if ( isTouchPrimaryDevice() ) return;
        const $input = $el_window.find('.myapps-search');
        if ( $input.length && $input.is(':visible') ) {
            $input.focus();
        } else if ( attempts > 0 ) {
            setTimeout(() => this.focusSearch($el_window, attempts - 1), 30);
        }
    },
};

export default TabApps;
