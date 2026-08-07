import UIContextMenu from '../UIContextMenu.js';
import UIAlert from '../UIAlert.js';
import launch_app from '../../helpers/launch_app.js';
import revokeAppSessions from '../../helpers/revoke_app_sessions.js';
import { begin_dashboard_tile_launch, settle_dashboard_tile_launch } from '../UIWindow.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import { reconcileAppOrder, serializeAppOrder, mergeSavedOrder, APPS_ORDER_KV_KEY } from './appOrder.js';
import { parseRemovedApps, serializeRemovedApps, REMOVED_APPS_KV_KEY } from './removedApps.js';

/** Lowercase app names that must not offer Uninstall in the My Apps tile context menu. */
const APP_NAMES_NO_UNINSTALL = new Set([
    'dev-center',
    'app-center',
]);

/*
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

// -- Drag-to-reorder tuning --
const DRAG_START_DISTANCE = 5;      // px a pointer must travel before a drag begins
const MODE_LONGPRESS_MS = 500;      // hold on empty grid space before reorder mode engages
const MODE_LONGPRESS_CANCEL_DISTANCE = 10; // px of travel that reclassifies the hold as a swipe
const DRAG_EDGE_ZONE = 60;          // px from a scroller edge that arms a page flip
const DRAG_EDGE_DWELL_MS = 480;     // hold time at an edge before the page flips
const DRAG_FLIP_SETTLE_MS = 440;    // time to let a page flip's smooth-scroll settle
const DRAG_FLIP_ANIM_MS = 320;      // reflow animation duration (iOS-like, unhurried)
const DRAG_FLIP_EASING = 'cubic-bezier(0.34, 1.08, 0.64, 1)'; // gentle spring settle
const TILE_REMOVE_ANIM_MS = 180;    // uninstall shrink-out duration (keep in sync with .myapps-tile-removing)
const TILE_REMOVE_DELAY_MS = 500;   // pause between the uninstall modal closing and the shrink-out starting
// A tile only becomes the drop target once the dragged icon's centre is well
// inside it (this fraction is trimmed off every edge). The resulting deadzone
// around each tile is what stops items flickering back and forth at a boundary.
const DRAG_HIT_INSET = 0.28;

// How long a /app/<name> landing waits for the launching app's tile to be
// visible before giving up on the click→morph→open intro and launching with
// the plain fade (see beginDeepLinkLaunch). The wait covers the dashboard
// window, the app-list fetches, a possibly-deferred first render, and the
// grid's load-fade; the launch's own app-info fetch runs in parallel to it
// (initgui prefetches), so this wait is the only thing the intro can cost.
const DEEP_LINK_INTRO_DEADLINE_MS = 3000;
const DEEP_LINK_INTRO_POLL_MS = 50;
// Pacing for the intro itself. On a fast connection the grid reveal, the
// tile's click flourish, and the window's morph would land in the same
// breath and read as an unexplained flash — the beats spread them into a
// sequence the user can follow: see the grid (WHERE you are), see the tile
// acknowledge (WHAT is opening), see the window grow out of it. The grid
// beat runs from the start of the pager's 200ms load-fade (see
// .myapps-pager-loading); the click beat matches the round-trip feel of a
// real tile click, joining the window's morph while the icon ghost is
// still dissolving so the two halves stay one continuous motion.
const DEEP_LINK_INTRO_GRID_BEAT_MS = 500;
const DEEP_LINK_INTRO_CLICK_BEAT_MS = 300;
// When the tile lives on a later pager page, the intro TRAVELS there
// visibly (smooth scroll) instead of waking up on page N with no context —
// the journey itself tells the user where the app lives. Smooth scrollTo
// has no reliable completion event across engines, so like the drag code's
// DRAG_FLIP_SETTLE_MS this is an allowance: the scroll's ~450ms plus a
// rest so the landing reads before the tile pops.
const DEEP_LINK_INTRO_FLIP_SETTLE_MS = 620;
// The intro exists to teach ("windows are inflated tiles; minimize goes
// back to the grid"); once learned it would only be a tax on every
// bookmarked landing. After this many delivered — or deliberately skipped —
// intros the beats collapse and the sequence plays in one breath, exactly
// like a warm tile click. Counted per ACCOUNT in kv, not per device: the
// lesson lives in the user's head and the account is what follows them
// across devices (localStorage would also bleed between accounts on a
// shared browser). The animated page flip is exempt from the decay — see
// beginDeepLinkLaunch.
const DEEP_LINK_INTRO_TEACH_COUNT = 3;
const DEEP_LINK_INTRO_SEEN_KV_KEY = 'dashboard_deeplink_intros_seen';

// The kv counter arrives as whatever the store returns (a number, a numeric
// string, null on a failed or timed-out read); anything unparseable reads
// as zero so the intro's failure mode is to teach once more — never to
// never teach.
function parseIntroSeenCount (raw) {
    const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

// Cog on the reorder-mode toggle; _setReorderMode swaps it for "Done" while
// the mode is on.
const REORDER_BTN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

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
    // installedApps reports icon: null when an app has no icon at all; its
    // iconUrl would be a wasted fetch, so use the bundled default instead.
    // Strictly null — launch-list entries carry no icon key (undefined).
    const iconUrl = app.icon === null
        ? window.icons['app-default.svg']
        : (app.iconUrl || window.icons['app.svg']);

    let h = `<div class="myapps-tile" role="button" tabindex="-1" data-app-name="${html_encode(app.name)}" data-app-title="${html_encode(title)}" data-app-uid="${html_encode(app.uid || '')}" data-target-link="${html_encode(targetLink)}" title="${html_encode(title)}">`;
    h += '<div class="myapps-tile-icon">';
    h += `<img src="${html_encode(iconUrl)}" alt="" draggable="false">`;
    // iOS-style uninstall badge; only shown while reorder mode is on (CSS).
    // tabindex=-1 keeps it out of the grid's roving-tabindex tab order.
    if ( ! APP_NAMES_NO_UNINSTALL.has((app.name || '').toLowerCase()) ) {
        h += `<button type="button" class="myapps-tile-remove" tabindex="-1" aria-label="Uninstall ${html_encode(title)}">`;
        h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        h += '</button>';
    }
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
function buildPagerHtml (apps, layout, instant) {
    const pageCount = Math.ceil(apps.length / layout.perPage);

    let h = `<div class="myapps-pager${instant ? '' : ' myapps-pager-loading'}" style="--myapps-cols: ${layout.cols}">`;

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

    $overlay.on('click', '.myapps-modal-confirm', function () {
        // Optimistic uninstall: the modal closes at once, the tile shrinks
        // away, and the survivors slide into the closed-up grid; the revoke
        // settles in the background and a failure restores the tile with a
        // visible error.
        //
        // A load fetched before the revoke must not apply — it would
        // resurrect the pre-revoke grid. No refetch here either: the
        // optimistic splice below already shows the result, and
        // _setAppRemoved is what keeps later loads (and the next session)
        // from re-adding a recommended app's tile — the recommended launch
        // list is global and doesn't know about the revoke.
        // The saved order intentionally keeps the app's name:
        // reconcileAppOrder ignores it while the app is gone and
        // restores its position if it comes back.
        const removedIndex = self._apps.findIndex(a => a.name === appName);
        const removedApp = removedIndex === -1 ? null : self._apps[removedIndex];
        // A running instance would be stranded: the tile is a headless
        // app's only switcher, so once it's gone a minimized window could
        // never be restored OR quit. Close the app's windows first (close
        // also consumes the app's URL entry if it owns one).
        $(`.window[data-app="${html_encode(appName)}"]`).close();
        self._invalidateInFlightLoads();
        self._setAppRemoved(appName, true);
        close();

        // A failed revoke must not roll back mid-animation: finishRemoval
        // splices by a fresh lookup, so a rollback that lands first would
        // just be re-removed. The catch below waits on this instead.
        let settleRemoval;
        const removalSettled = new Promise(resolve => { settleRemoval = resolve; });

        const finishRemoval = () => {
            const idx = self._apps.findIndex(a => a.name === appName);
            if ( idx === -1 ) {
                settleRemoval();
                return;
            }
            // FIRST: rects of the surviving tiles keyed by app name — the
            // re-render replaces every node, so identity maps through names.
            const firstRects = new Map();
            if ( ! self._reduceMotion() ) {
                for ( const el of $el_window.find('.myapps-tile').toArray() ) {
                    if ( el.dataset.appName === appName ) continue;
                    firstRects.set(el.dataset.appName, el.getBoundingClientRect());
                }
            }
            self._apps.splice(idx, 1);
            self.renderApps($el_window, { preservePage: true, instant: true });
            // FLIP the survivors from their old boxes into the new layout.
            const moved = [];
            for ( const el of $el_window.find('.myapps-tile').toArray() ) {
                const a = firstRects.get(el.dataset.appName);
                if ( ! a ) continue;
                const b = el.getBoundingClientRect();
                const dx = a.left - b.left;
                const dy = a.top - b.top;
                if ( dx === 0 && dy === 0 ) continue;
                el.style.transform = `translate(${dx}px, ${dy}px)`;
                moved.push(el);
            }
            if ( moved.length > 0 ) {
                void moved[0].offsetWidth; // one reflow commits every inverted offset
                for ( const el of moved ) {
                    el.style.transition = `transform ${DRAG_FLIP_ANIM_MS}ms ${DRAG_FLIP_EASING}`;
                    el.style.transform = '';
                }
                // The transform-only inline transition must not outlive the
                // slide: left in place it overrides .myapps-tile-removing's
                // transition on the next uninstall, snapping opacity to 0
                // with no shrink animation.
                setTimeout(() => {
                    for ( const el of moved ) el.style.transition = '';
                }, DRAG_FLIP_ANIM_MS + 60);
            }
            settleRemoval();
        };

        const tileEl = $el_window.find('.myapps-tile').toArray()
            .find(el => el.dataset.appName === appName);
        if ( tileEl && ! self._reduceMotion() ) {
            // Let the modal's departure settle before the tile starts to go.
            setTimeout(() => {
                // An earlier FLIP (uninstall slide or drag reorder) may have
                // left a stale inline transition on this tile; clear it so
                // the removing class's transition takes effect.
                tileEl.style.transition = '';
                tileEl.classList.add('myapps-tile-removing');
                setTimeout(finishRemoval, TILE_REMOVE_ANIM_MS);
            }, TILE_REMOVE_DELAY_MS);
        } else {
            finishRemoval();
        }

        puter.perms.revokeApp(appUid, '*').then(async () => {
            // Clearing the grants is only half of it. An app the user already
            // opened holds a token that authenticates against a session row,
            // and that row outlives the permission rows — so without this an
            // uninstalled app keeps calling with the credential it has. The
            // revoke endpoint deliberately doesn't do this itself: dropping
            // grants without ending the app's sign-in is a valid thing to ask
            // for on its own, so uninstall asks for both.
            //
            // The grants are already gone at this point, so the app is
            // uninstalled either way and the tile stays removed. A failure here
            // is worth saying out loud rather than swallowing — it's the
            // difference between "revoked" and "revoked but still signed in",
            // and Manage Sessions is where the user can finish the job.
            try {
                await revokeAppSessions(appUid);
            } catch ( e ) {
                console.error('Uninstalled the app but could not end its sessions:', e);
                UIAlert(i18n('uninstall_sessions_failed', [displayName]));
            }
        }).catch(async err => {
            console.error('Failed to uninstall app:', err);
            await removalSettled;
            self._invalidateInFlightLoads();
            // The uninstall didn't happen — take the name back off the
            // removed list so the recommended merge can show it again.
            self._setAppRemoved(appName, false);
            if ( removedApp && ! self._apps.some(a => a.name === appName) ) {
                self._apps.splice(Math.min(removedIndex, self._apps.length), 0, removedApp);
                self.renderApps($el_window, { preservePage: true, instant: true });
            }
            UIAlert(`Couldn't uninstall ${html_encode(displayName)}. Please try again.`);
        });
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
    _hasCustomOrder: false,
    _drag: null,
    _reorderMode: false,
    _emptyPress: null,
    _suppressEmptyTap: false,
    _justDragged: false,
    _reduceMotionMQL: undefined,
    _loadPromise: null,
    _pendingLoad: null,
    _savedOrderNames: null,
    _orderSavedAtSeq: 0,
    _launchingApps: new Set(),

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
        // Touch devices' way into drag-to-reorder (CSS shows it only there);
        // toggles the reorder mode — see _setReorderMode.
        h += `<button type="button" class="myapps-reorder-btn" aria-pressed="false" aria-label="Edit apps">${REORDER_BTN_ICON}</button>`;
        h += '</div>';
        h += '<div class="myapps-container">';
        h += '</div>';
        h += '</div>';
        return h;
    },

    init ($el_window) {
        // This object outlives a closed dashboard window; a re-init gets a
        // fresh DOM that is not in reorder mode, whatever the old one was —
        // and a pending empty-space press holds document-level listeners
        // that must not survive the old DOM.
        this._reorderMode = false;
        this._cancelEmptyPress();

        this.loadApps($el_window);

        const self = this;

        $el_window.on('click', '.myapps-reorder-btn', function (e) {
            // Don't bubble on to the empty-tap handler below: toggling the
            // mode replaces this button's content, and if the tap landed on
            // the cog svg the detached target no longer matches the
            // handler's ancestry checks — the tap would read as empty space
            // and undo the toggle it just made.
            e.stopPropagation();
            self._setReorderMode($el_window, ! self._reorderMode);
        });

        // Tapping empty grid space while the mode is on acts as Done,
        // iOS-style. Interactive pieces are excluded: they handle themselves.
        // _suppressEmptyTap covers the clicks a drag-drop or a long-press
        // lift synthesizes on empty space.
        $el_window.on('click', '.myapps-tab', function (e) {
            if ( ! self._reorderMode || self._suppressEmptyTap ) return;
            // A detached target means some handler already reshaped the DOM
            // under this click — whatever it was, it wasn't empty space.
            if ( ! e.target.isConnected ) return;
            if ( $(e.target).closest('.myapps-tile, .myapps-tile-remove, .myapps-reorder-btn, .myapps-pager-dot, .myapps-pager-arrow').length ) return;
            self._setReorderMode($el_window, false);
        });

        // …and pressing-and-holding empty grid space enters the mode.
        $el_window.on('pointerdown', '.myapps-tab', function (e) {
            self._onEmptyPointerDown($el_window, e);
        });

        // Reorder mode's per-tile uninstall badge — the context-menu route to
        // Uninstall is suppressed while the mode is on, this replaces it.
        $el_window.on('click', '.myapps-tile-remove', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if ( ! self._reorderMode || self._drag ) return;
            const $tile = $(this).closest('.myapps-tile');
            showUninstallModal({
                appName: $tile.attr('data-app-name'),
                appTitle: $tile.attr('data-app-title'),
                appUid: $tile.attr('data-app-uid'),
                self,
                $el_window,
            });
        });

        // Tiles double as the app switcher for headless in-page apps: a
        // dot marks tiles whose app has an open (or minimized) window.
        // UIWindow fires this event on every window open/close.
        document.addEventListener('dashboard-app-windows-changed', () => {
            self.updateRunningDots($el_window);
        });

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
        // index_url) and open the app's website directly in a new browser tab
        // (an external site can't be reliably iframed); everything else
        // launches the app as a maximized window in this same page.
        $el_window.on('click', '.myapps-tile', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // In reorder mode a press on a tile is a (potential) drag pickup,
            // never a launch.
            if ( self._reorderMode ) return;
            // A click synthesized at the end of a drag must not open the app.
            if ( self._justDragged ) {
                self._justDragged = false;
                return;
            }
            const appName = $(this).attr('data-app-name');
            const targetLink = $(this).attr('data-target-link');
            // Ctrl/Cmd+click opens in a new browser tab, mirroring the
            // context menu's "Open in new tab" item.
            if ( e.ctrlKey || e.metaKey ) {
                if ( targetLink && targetLink !== '' ) {
                    window.open(targetLink, '_blank', 'noopener,noreferrer');
                } else if ( appName ) {
                    window.open(`/app/${encodeURIComponent(appName)}`, '_blank', 'noopener,noreferrer');
                }
                return;
            }
            if ( targetLink && targetLink !== '' ) {
                window.open(targetLink, '_blank', 'noopener,noreferrer');
            } else if ( appName ) {
                // One instance per app when launched from here: un-hide a
                // minimized instance / focus a visible one rather than
                // launching a duplicate.
                const $existing = $(`.window[data-app="${html_encode(appName)}"]`);
                if ( $existing.length ) {
                    const $win = $existing.last();
                    const minimized = $win.attr('data-is_minimized');
                    if ( minimized === '1' || minimized === 'true' ) {
                        $win.showWindow();
                    } else {
                        $win.focusWindow();
                    }
                    return;
                }
                // A second click while the first launch's fetches are still in
                // flight has no window to find yet — swallow it instead of
                // spawning a duplicate instance.
                if ( self._launchingApps.has(appName) ) return;
                self._launchingApps.add(appName);
                const tile = this;
                // Acknowledge the click NOW: the icon's half of the open
                // morph starts immediately, while the app's fetches are
                // still in flight; the window's half claims it when the
                // window opens (morph_from_dashboard_tile → see UIWindow),
                // and settle puts the icon back if it never does (launch
                // failed, or the morph fell back to the plain fade).
                begin_dashboard_tile_launch(tile);
                launch_app({
                    name: appName,
                    maximized: true,
                    window_options: { morph_from_dashboard_tile: true },
                })
                    .catch((err) => {
                        console.error(`Failed to launch ${appName}:`, err);
                    })
                    .finally(() => {
                        self._launchingApps.delete(appName);
                        settle_dashboard_tile_launch(tile);
                    });
            }
        });

        // Start a drag-to-reorder gesture. Kept separate from click so a plain
        // click still opens the app (see _onTilePointerDown for the movement
        // threshold that distinguishes the two).
        $el_window.on('pointerdown', '.myapps-tile', function (e) {
            self._onTilePointerDown($el_window, e, this);
        });

        // Context menu on right-click (and, where the platform fires it,
        // touch long-press).
        $el_window.on('contextmenu', '.myapps-tile', function (e) {
            // Reorder mode owns every tile gesture — no menu there; likewise
            // suppress the menu (and any long-press callout) mid-drag.
            if ( self._reorderMode || (self._drag && self._drag.started) ) {
                e.preventDefault();
                return;
            }
            const appName = $(this).attr('data-app-name');
            const appTitle = $(this).attr('data-app-title');
            const appUid = $(this).attr('data-app-uid');
            const targetLink = $(this).attr('data-target-link');
            const noUninstall = APP_NAMES_NO_UNINSTALL.has((appName || '').toLowerCase());
            const isRunning = !! appName && $(`.window[data-app="${html_encode(appName)}"]`).length > 0;

            // Every app opens in a new browser tab the way tiles did before
            // in-page windows: external tiles via their site link, everything
            // else via its /app/<name> URL.
            const items = [
                {
                    html: 'Open in new tab',
                    onClick: () => {
                        if ( targetLink && targetLink !== '' ) {
                            window.open(targetLink, '_blank', 'noopener,noreferrer');
                        } else if ( appName ) {
                            window.open(`/app/${encodeURIComponent(appName)}`, '_blank', 'noopener,noreferrer');
                        }
                    },
                },
            ];
            // The tile doubles as the app switcher (headless apps have no
            // titlebar): a running app — the tile shows its dot — can be
            // quit from here without entering it. Closing consumes the
            // app's URL entry only if it owns the URL (it doesn't, here on
            // the dashboard), and the running dot clears via the
            // dashboard-app-windows-changed event once the window is gone.
            if ( isRunning ) {
                items.push({
                    html: 'Quit',
                    onClick: () => {
                        $(`.window[data-app="${html_encode(appName)}"]`).close();
                    },
                });
            }
            if ( ! noUninstall ) {
                items.push('-', {
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
                });
            }

            // A pending pickup (button held, not yet moved) would be stranded
            // under the menu; cancel it so the two can't run at once. An
            // already-started drag was handled by the guard above.
            if ( self._drag ) self._endDrag(false);

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

        // -- Keyboard navigation --
        // Arrow keys move focus between the current page's tiles and
        // Enter/Space launches the focused one. Navigation is deliberately
        // clamped to the visible page — the keyboard never flips pages; the
        // dots, hover arrows, and wheel remain the paging affordances.
        // updatePagerUI keeps one tile per render in the tab order (roving
        // tabindex), so Tab lands on the grid and arrows take over from there.
        $(document).off('keydown.myapps-keyboard').on('keydown.myapps-keyboard', function (e) {
            if ( ! ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key) ) return;
            if ( ! $el_window.find('.dashboard-section-apps').hasClass('active') ) return;
            if ( ! $el_window.is(':visible') ) return;
            if ( $el_window.find('.myapps-modal-overlay').length ) return;
            if ( $('.window').not($el_window[0]).filter(':visible').length ) return;

            const pageTiles = $el_window.find('.myapps-page').eq(self._page).find('.myapps-tile').toArray();
            if ( pageTiles.length === 0 ) return;

            const ae = document.activeElement;
            const onTile = ae && ae.classList && ae.classList.contains('myapps-tile');

            if ( ! onTile ) {
                // ArrowDown steps from the search box into the grid; when the
                // (auto-focused, Launchpad-style) search is empty, any arrow
                // does. Other keys are left alone so the caret and native
                // button behavior keep working.
                if ( ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable) ) {
                    const emptySearch = $(ae).hasClass('myapps-search') && ae.value === '';
                    if ( e.key !== 'ArrowDown' && ! (emptySearch && e.key.startsWith('Arrow')) ) return;
                } else if ( ! e.key.startsWith('Arrow') ) {
                    return;
                }
                e.preventDefault();
                pageTiles[0].focus({ preventScroll: true });
                return;
            }

            if ( e.key === 'Enter' || e.key === ' ' ) {
                e.preventDefault();
                $(ae).trigger('click');
                return;
            }

            e.preventDefault();
            const idx = pageTiles.indexOf(ae);
            if ( idx === -1 ) {
                // Focus is on a tile of an offscreen page (the page changed
                // under it via dots/wheel); pull it back to the visible one.
                pageTiles[0].focus({ preventScroll: true });
                return;
            }
            const cols = (self._layout && self._layout.cols) || 1;
            let next = idx;
            if ( e.key === 'ArrowLeft' ) next = idx - 1;
            else if ( e.key === 'ArrowRight' ) next = idx + 1;
            else if ( e.key === 'ArrowUp' ) next = idx - cols;
            else if ( e.key === 'ArrowDown' ) next = idx + cols;
            if ( next === idx || next < 0 || next >= pageTiles.length ) return;
            pageTiles[next].focus({ preventScroll: true });
        });

        // Re-paginate when the container resizes (window resize, sidebar
        // collapse, tab becoming visible, on-screen keyboard, …).
        if ( self._resizeObserver ) self._resizeObserver.disconnect();
        self._resizeObserver = new ResizeObserver(() => {
            clearTimeout(self._resizeTimer);
            self._resizeTimer = setTimeout(() => {
                if ( ! self._apps ) return;
                if ( self._drag ) {
                    // Don't rebuild the DOM out from under an in-progress drag.
                    if ( self._drag.started ) return;
                    // A press is pending but hasn't become a drag; cancel it so a
                    // rebuild can't detach the tile the pickup is waiting on.
                    self._endDrag(false);
                }
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
    // load, search, uninstall, re-layout, reorder — funnels through here.
    renderApps ($el_window, { preservePage = false, instant = false } = {}) {
        if ( ! this._apps ) return;

        // The reorder toggle only earns its place once there's something to
        // reorder (CSS additionally gates it to touch-primary devices). A
        // background refresh can also shrink the list below two mid-mode
        // (e.g. apps uninstalled in another window) — leave the mode then.
        $el_window.find('.myapps-reorder-btn')
            .toggleClass('myapps-reorder-btn-available', this._apps.length >= 2);
        if ( this._reorderMode && this._apps.length < 2 ) {
            this._setReorderMode($el_window, false);
        }

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

        $container.html(buildPagerHtml(list, layout, instant));
        revealWhenLoaded($container);
        this.updateRunningDots($el_window);

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

    // Mark tiles whose app has a live window (visible OR minimized — both
    // are running) with the macOS-dock-style dot. Cheap enough to re-run
    // wholesale on every open/close/render.
    updateRunningDots ($el_window) {
        for ( const tile of $el_window.find('.myapps-tile').toArray() ) {
            const name = tile.getAttribute('data-app-name');
            const running = !! name && $(`.window[data-app="${html_encode(name)}"]`).length > 0;
            tile.classList.toggle('myapps-tile-running', running);
        }
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
        // Roving tabindex: exactly one tile — the current page's first — sits
        // in the tab order; arrow keys move real focus from there.
        $container.find('.myapps-tile').attr('tabindex', '-1');
        $container.find('.myapps-page').eq(page).find('.myapps-tile').first().attr('tabindex', '0');
    },

    goToPage ($el_window, index, smooth) {
        const scroller = $el_window.find('.myapps-pager-scroller')[0];
        if ( ! scroller || this._pageCount === 0 ) return;
        const page = Math.max(0, Math.min(this._pageCount - 1, index));
        scroller.scrollTo({
            left: page * scroller.clientWidth,
            behavior: (smooth && !this._reduceMotion()) ? 'smooth' : 'auto',
        });
        // Programmatic scrolls don't reliably emit 'scroll' events (so the
        // scroll-driven sync above can miss them); track the page eagerly.
        this._page = page;
        this.updatePagerUI($el_window);
    },

    _reduceMotion () {
        // Cache the live MediaQueryList — this is read on every pointermove
        // during a drag, and matchMedia() is comparatively expensive.
        if ( this._reduceMotionMQL === undefined ) {
            this._reduceMotionMQL = window.matchMedia
                ? window.matchMedia('(prefers-reduced-motion: reduce)')
                : null;
        }
        return !! (this._reduceMotionMQL && this._reduceMotionMQL.matches);
    },

    // -- Reorder mode (touch) --
    // On touch, a drag must win the gesture from native scrolling *before*
    // the finger moves — touch-action is consulted at gesture start, so no
    // amount of long-press arming can reclaim a touch the scroller already
    // owns (hence the flaky pre-mode behavior, worst on iOS). An explicit
    // mode can: while it's on, CSS sets touch-action:none on the tiles, the
    // first pointer movement begins a drag, taps don't launch, and the
    // context menu is suppressed. Entry is the cog button or a long-press on
    // empty grid space; exit is Done or a tap on empty space (all iOS
    // home-screen conventions). Each drop still persists immediately via
    // saveOrder (same as desktop), so exiting only leaves the mode — there
    // is no unsaved state to lose.
    _setReorderMode ($el_window, on) {
        on = !! on;
        if ( this._reorderMode === on ) return;
        if ( on && (! this._apps || this._apps.length < 2) ) return;

        if ( ! on && this._drag ) {
            // Done tapped with another finger mid-gesture: settle the drag
            // first — commit a started one, discard a pending pickup.
            this._endDrag(this._drag.started);
        }

        this._reorderMode = on;
        $el_window.find('.dashboard-tab-content.myapps-tab')
            .toggleClass('myapps-reorder-mode', on);

        // Reordering a filtered subset is ambiguous (see _onTilePointerDown),
        // so the mode owns the unfiltered grid: clear any query and freeze
        // the search box while the mode is on.
        const $search = $el_window.find('.myapps-search');
        if ( on && String($search.val() || '') !== '' ) {
            $search.val('');
            this.updateSearchIcons($el_window);
            this.renderApps($el_window);
        }
        $search.prop('disabled', on);

        $el_window.find('.myapps-reorder-btn')
            .toggleClass('myapps-reorder-btn-active', on)
            .attr('aria-pressed', on ? 'true' : 'false')
            .attr('aria-label', on ? 'Done editing' : 'Edit apps')
            .html(on ? 'Done' : REORDER_BTN_ICON);
    },

    // A drag's drop and a long-press's lift both synthesize a click that can
    // land on empty grid space; without this window the empty-tap-is-Done
    // handler would read them as an exit request.
    _suppressEmptyTapBriefly () {
        this._suppressEmptyTap = true;
        clearTimeout(this._suppressEmptyTapTimer);
        this._suppressEmptyTapTimer = setTimeout(() => {
            this._suppressEmptyTap = false;
        }, 350);
    },

    // Long-press on empty grid space (touch) enters reorder mode. Unlike the
    // abandoned long-press-to-drag, nothing here races the scroller or the
    // native callout — the finger only has to hold still, so a plain timer
    // is dependable. Movement (a swipe / page pan) or an early lift cancels
    // the intent; after the mode engages, the same press keeps its listeners
    // just long enough to suppress the click its lift synthesizes.
    _onEmptyPointerDown ($el_window, e) {
        const oe = e.originalEvent || e;
        if ( this._reorderMode || this._drag || this._emptyPress ) return;
        if ( (oe.pointerType || 'mouse') !== 'touch' ) return;
        // Match the cog button's audience (a mode with no visible toggle
        // would confuse hover-capable touchscreen laptops).
        if ( ! isTouchPrimaryDevice() ) return;
        if ( ! this._apps || this._apps.length < 2 ) return;
        if ( $(oe.target).closest('.myapps-tile, .myapps-reorder-btn, .myapps-pager-dot, .myapps-pager-arrow, .myapps-search-inner, .myapps-modal-overlay').length ) return;

        const p = this._emptyPress = {
            pointerId: oe.pointerId,
            startX: oe.clientX,
            startY: oe.clientY,
            timer: null,
            fired: false,
        };
        const isPressPointer = ev => ev.pointerId === undefined || ev.pointerId === p.pointerId;
        p.onMove = ev => {
            if ( ! isPressPointer(ev) || p.fired ) return;
            const dist = Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY);
            if ( dist > MODE_LONGPRESS_CANCEL_DISTANCE ) this._cancelEmptyPress();
        };
        p.onEnd = ev => {
            if ( ! isPressPointer(ev) ) return;
            if ( p.fired ) this._suppressEmptyTapBriefly();
            this._cancelEmptyPress();
        };
        document.addEventListener('pointermove', p.onMove, { passive: true });
        document.addEventListener('pointerup', p.onEnd);
        document.addEventListener('pointercancel', p.onEnd);
        p.timer = setTimeout(() => {
            if ( this._emptyPress !== p ) return;
            p.fired = true;
            this._setReorderMode($el_window, true);
            if ( navigator.vibrate ) {
                try { navigator.vibrate(8); } catch ( _e ) { /* not supported */ }
            }
        }, MODE_LONGPRESS_MS);
    },

    _cancelEmptyPress () {
        const p = this._emptyPress;
        if ( ! p ) return;
        this._emptyPress = null;
        clearTimeout(p.timer);
        document.removeEventListener('pointermove', p.onMove);
        document.removeEventListener('pointerup', p.onEnd);
        document.removeEventListener('pointercancel', p.onEnd);
    },

    // -- Drag-to-reorder --

    _onTilePointerDown ($el_window, e, tileEl) {
        const oe = e.originalEvent || e;
        // Primary button / touch / pen only; right-click falls through to the
        // context menu.
        if ( oe.button !== undefined && oe.button !== 0 ) return;
        if ( this._drag ) return;
        if ( ! this._apps || this._apps.length < 2 ) return;
        // A press on the uninstall badge belongs to that button, not to a
        // drag pickup — a finger wobble while tapping × must not lift the tile.
        if ( oe.target && oe.target.closest && oe.target.closest('.myapps-tile-remove') ) return;
        // Reordering a filtered subset is ambiguous — only reorder the full list.
        const query = String($el_window.find('.myapps-search').val() || '').trim();
        if ( query ) return;

        const pointerType = oe.pointerType || 'mouse';
        // Touch reorders only inside reorder mode (the button is the way in;
        // outside it the scroller owns touch gestures and would cancel the
        // drag anyway — see _setReorderMode). A touch press outside the mode
        // stays a tap (launch), swipe (page), or long-press (context menu on
        // platforms that fire it), all handled elsewhere.
        if ( pointerType === 'touch' && ! this._reorderMode ) return;
        const d = this._drag = {
            $el_window,
            tileEl,
            pointerType,
            pointerId: oe.pointerId,
            startX: oe.clientX,
            startY: oe.clientY,
            lastClientX: oe.clientX,
            lastClientY: oe.clientY,
            offsetX: 0,
            offsetY: 0,
            started: false,
            ghost: null,
            edgeTimer: null,
            edgeDir: 0,
            flipping: false,
            flipClearTimer: null,
        };

        // Ignore events from a second pointer (e.g. a stray finger) so it can't
        // hijack or prematurely end an in-progress drag.
        const isDragPointer = ev => ev.pointerId === undefined || ev.pointerId === d.pointerId;
        d.onMove = ev => { if ( isDragPointer(ev) ) this._onDragPointerMove(ev); };
        d.onUp = ev => { if ( isDragPointer(ev) ) this._endDrag(true); };
        d.onCancel = ev => { if ( isDragPointer(ev) ) this._endDrag(false); };
        d.onKey = ev => { if ( ev.key === 'Escape' ) this._endDrag(false); };
        d.onBlur = () => this._endDrag(false);

        document.addEventListener('pointermove', d.onMove, { passive: false });
        document.addEventListener('pointerup', d.onUp);
        document.addEventListener('pointercancel', d.onCancel);
        document.addEventListener('keydown', d.onKey);
        window.addEventListener('blur', d.onBlur);
    },

    _onDragPointerMove (e) {
        const d = this._drag;
        if ( ! d ) return;

        if ( ! d.started ) {
            const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
            if ( dist <= DRAG_START_DISTANCE ) return;
            d.lastClientX = e.clientX;
            d.lastClientY = e.clientY;
            this._beginDrag();
            // _beginDrag bails (without starting) if the tile was detached by a
            // re-render during the pre-start window; don't touch a dead drag.
            if ( ! d.started ) return;
            // Fall through so this same event also places the tile — a coarse
            // (few-event) drag still reorders instead of just lifting.
        }

        // Now committed to a drag — stop native scrolling/selection.
        e.preventDefault();
        d.lastClientX = e.clientX;
        d.lastClientY = e.clientY;
        this._positionGhost(e.clientX, e.clientY);
        if ( d.flipping ) return;
        this._maybeEdgeFlip(e.clientX);
        if ( d.flipping ) return;
        this._updatePlaceholder(e.clientX, e.clientY);
    },

    _beginDrag () {
        const d = this._drag;
        if ( ! d || d.started ) return;
        // A re-render during the pre-start window can detach the pressed tile;
        // starting a drag on a stale node would corrupt the persisted order.
        if ( ! d.tileEl.isConnected ) { this._endDrag(false); return; }
        d.started = true;
        if ( d.pointerType === 'touch' && navigator.vibrate ) {
            try { navigator.vibrate(8); } catch ( _e ) { /* not supported */ }
        }

        const rect = d.tileEl.getBoundingClientRect();
        d.offsetX = d.startX - rect.left;
        d.offsetY = d.startY - rect.top;
        d.tileW = rect.width;
        d.tileH = rect.height;

        const ghost = d.tileEl.cloneNode(true);
        ghost.classList.add('myapps-drag-ghost');
        ghost.classList.remove('has-open-contextmenu');
        ghost.removeAttribute('title');
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.transformOrigin = `${d.offsetX}px ${d.offsetY}px`;
        document.body.appendChild(ghost);
        d.ghost = ghost;
        this._positionGhost(d.lastClientX, d.lastClientY);

        d.tileEl.classList.add('myapps-tile-dragging');
        document.body.classList.add('myapps-reordering');
    },

    _positionGhost (x, y) {
        const d = this._drag;
        if ( ! d || ! d.ghost ) return;
        const scale = this._reduceMotion() ? 1 : 1.06;
        d.ghost.style.transform =
            `translate(${x - d.offsetX}px, ${y - d.offsetY}px) scale(${scale})`;
    },

    _maybeEdgeFlip (px) {
        const d = this._drag;
        const scroller = d.$el_window.find('.myapps-pager-scroller')[0];
        if ( ! scroller || this._pageCount < 2 ) return;

        const r = scroller.getBoundingClientRect();
        let dir = 0;
        if ( px >= r.right - DRAG_EDGE_ZONE ) dir = 1;
        else if ( px <= r.left + DRAG_EDGE_ZONE ) dir = -1;

        const atEnd = (dir === 1 && this._page >= this._pageCount - 1);
        const atStart = (dir === -1 && this._page <= 0);
        if ( dir === 0 || atEnd || atStart ) {
            clearTimeout(d.edgeTimer);
            d.edgeTimer = null;
            d.edgeDir = 0;
            return;
        }

        if ( d.edgeTimer && d.edgeDir === dir ) return; // already dwelling this way
        clearTimeout(d.edgeTimer);
        d.edgeDir = dir;
        d.edgeTimer = setTimeout(() => {
            d.edgeTimer = null;
            d.edgeDir = 0;
            if ( this._drag !== d ) return;
            d.flipping = true;
            this.goToPage(d.$el_window, this._page + dir, true);
            clearTimeout(d.flipClearTimer);
            d.flipClearTimer = setTimeout(() => {
                if ( this._drag !== d ) return;
                d.flipping = false;
                this._updatePlaceholder(d.lastClientX, d.lastClientY);
            }, this._reduceMotion() ? 60 : DRAG_FLIP_SETTLE_MS);
        }, DRAG_EDGE_DWELL_MS);
    },

    // Slot the (invisible) placeholder into the tile the dragged icon is
    // hovering over, animating the displaced tiles with FLIP. The placeholder
    // may hop in from another page (cross-page reorder).
    //
    // Two things keep this from jittering:
    //   1. Hit-testing uses each tile's *resting* rect (its final layout box),
    //      not getBoundingClientRect — mid-FLIP a tile is visually somewhere
    //      between slots, and testing its live box would swap it straight back.
    //   2. A tile only counts as the target when the dragged icon's centre is
    //      well inside it (DRAG_HIT_INSET), so hovering a boundary does nothing.
    _updatePlaceholder (px, py) {
        const d = this._drag;
        if ( ! d ) return;
        const pageEl = d.$el_window.find('.myapps-page').toArray()[this._page];
        if ( ! pageEl ) return;

        // Probe with the dragged icon's centre rather than the fingertip, so the
        // drop follows where the tile visually is.
        const probeX = px - d.offsetX + d.tileW / 2;
        const probeY = py - d.offsetY + d.tileH / 2;

        const tiles = Array.from(pageEl.querySelectorAll('.myapps-tile'));
        const phIndex = tiles.indexOf(d.tileEl);

        let overIndex = -1;
        for ( let i = 0; i < tiles.length; i++ ) {
            const t = tiles[i];
            if ( t === d.tileEl ) continue;
            const r = t.__myappsRestRect || t.getBoundingClientRect();
            const insetX = r.width * DRAG_HIT_INSET;
            const insetY = r.height * DRAG_HIT_INSET;
            if ( probeX >= r.left + insetX && probeX <= r.right - insetX &&
                 probeY >= r.top + insetY && probeY <= r.bottom - insetY ) {
                overIndex = i;
                break;
            }
        }

        // In a gap / over the placeholder itself: leave the arrangement alone.
        if ( overIndex === -1 ) return;

        // Move the placeholder to that tile's slot; everything between cascades.
        // After the move the probe sits over the vacated gap, so it won't bounce.
        const overTile = tiles[overIndex];
        const refNode = (phIndex === -1 || overIndex < phIndex)
            ? overTile
            : overTile.nextElementSibling;

        this._flipMove(tiles.filter(t => t !== d.tileEl), () => {
            if ( refNode ) pageEl.insertBefore(d.tileEl, refNode);
            else pageEl.appendChild(d.tileEl);
        });
    },

    // First-Last-Invert-Play, interruption-safe. Records each tile's true
    // resting rect (transforms cleared first) so an interrupting reorder
    // continues smoothly and hit-testing always reads a stable position.
    _flipMove (tiles, mutate) {
        // FIRST: current visual boxes (may be mid-animation).
        const first = new Map();
        for ( const t of tiles ) first.set(t, t.getBoundingClientRect());

        mutate();

        // LAST: clear any in-flight transform, then measure the true resting box.
        for ( const t of tiles ) {
            t.style.transition = 'none';
            t.style.transform = '';
        }
        const rest = new Map();
        for ( const t of tiles ) {
            const b = t.getBoundingClientRect();
            rest.set(t, b);
            t.__myappsRestRect = b;
        }
        if ( this._reduceMotion() ) return;

        // INVERT: offset each tile from its resting box back to where it was.
        const moved = [];
        for ( const t of tiles ) {
            const a = first.get(t);
            const b = rest.get(t);
            const dx = a.left - b.left;
            const dy = a.top - b.top;
            if ( dx === 0 && dy === 0 ) continue;
            t.style.transform = `translate(${dx}px, ${dy}px)`;
            moved.push(t);
        }
        if ( moved.length === 0 ) return;
        void moved[0].offsetWidth; // one reflow commits every inverted offset
        // PLAY: release to the resting box.
        for ( const t of moved ) {
            t.style.transition = `transform ${DRAG_FLIP_ANIM_MS}ms ${DRAG_FLIP_EASING}`;
            t.style.transform = '';
        }
    },

    _teardownDragListeners (d) {
        document.removeEventListener('pointermove', d.onMove, { passive: false });
        document.removeEventListener('pointerup', d.onUp);
        document.removeEventListener('pointercancel', d.onCancel);
        document.removeEventListener('keydown', d.onKey);
        window.removeEventListener('blur', d.onBlur);
        clearTimeout(d.edgeTimer);
        clearTimeout(d.flipClearTimer);
    },

    _endDrag (commit) {
        const d = this._drag;
        if ( ! d ) return;
        this._drag = null;
        this._teardownDragListeners(d);
        document.body.classList.remove('myapps-reordering');

        if ( ! d.started ) {
            // Never became a drag — leave the click to open the app.
            return;
        }

        d.tileEl.classList.remove('myapps-tile-dragging');

        // The click this drop synthesizes may land on empty grid space (the
        // drop spot) — it is the tail of the drag, not an exit-the-mode tap.
        this._suppressEmptyTapBriefly();

        let changed = false;
        if ( commit ) {
            const names = d.$el_window.find('.myapps-page .myapps-tile').toArray()
                .map(t => t.getAttribute('data-app-name'));
            const current = this._apps.map(a => a.name);
            // Only persist when the order actually changed, so a pickup
            // dropped back in place doesn't freeze the default ordering.
            changed = names.length !== current.length
                || names.some((name, i) => name !== current[i]);
            if ( changed ) {
                this._apps = reconcileAppOrder(this._apps, names);
                this.saveOrder();
            }
        }

        // Swallow the click synthesized after this pointerup only when the drag
        // actually reordered something — a drift/no-op press should still open
        // the app, matching a plain click.
        if ( changed ) {
            this._justDragged = true;
            clearTimeout(this._justDraggedTimer);
            this._justDraggedTimer = setTimeout(() => { this._justDragged = false; }, 350);
        }

        const ghost = d.ghost;
        if ( ghost ) {
            ghost.classList.add('myapps-drag-ghost-drop');
            setTimeout(() => ghost.remove(), this._reduceMotion() ? 0 : 160);
        }

        // Rebuild so pages rebalance to exactly perPage; skip the load fade.
        this.renderApps(d.$el_window, { preservePage: true, instant: true });

        this._applyPendingLoad();
    },

    // A load that resolved mid-drag was stashed rather than rendered (see
    // _fetchAndRenderApps). Apply it now; _resolveOrderNames picks between
    // the canonical in-memory saved order and the kv snapshot this load
    // fetched, based on which is fresher.
    _applyPendingLoad () {
        const pending = this._pendingLoad;
        if ( ! pending ) return;
        this._pendingLoad = null;
        if ( pending.loadSeq < (this._appliedSeq || 0) ) return;
        this._appliedSeq = pending.loadSeq;

        const orderedNames = this._resolveOrderNames(pending.loadSeq, pending.orderedNames);
        this._savedOrderNames = orderedNames;
        this._hasCustomOrder = Array.isArray(orderedNames) && orderedNames.length > 0;
        this._apps = reconcileAppOrder(pending.merged, orderedNames);
        this.renderApps(pending.$el_window, { preservePage: true, instant: true });
    },

    // Decide which saved-order snapshot a resolving load reconciles against.
    // A fetch issued before the user's latest local order save carries a
    // pre-save kv snapshot — replaying it would visibly revert the reorder,
    // and permanently clobber it after the next save. A fetch issued after
    // the save is at least as fresh and may carry a newer arrangement from
    // another window, so it wins. Never resolve to the visible-only
    // on-screen order: it would tail-append any app returning to the grid.
    _resolveOrderNames (loadSeq, fetchedOrderNames) {
        const fetchedBeforeSave = loadSeq <= (this._orderSavedAtSeq || 0);
        return fetchedBeforeSave && Array.isArray(this._savedOrderNames)
            ? this._savedOrderNames
            : fetchedOrderNames;
    },

    // A local mutation of _apps (uninstall) must invalidate loads fetched
    // before it — applying one would resurrect the pre-mutation state. Loads
    // started after this call get a newer seq and still apply. Dropping the
    // shared promise lets the next activation fetch fresh instead of joining
    // the doomed load.
    _invalidateInFlightLoads () {
        this._loadSeq = (this._loadSeq || 0) + 1;
        this._appliedSeq = this._loadSeq;
        this._loadPromise = null;
    },

    // Record that the user uninstalled `appName` — or, with removed=false,
    // that a failed uninstall rolled back. The in-memory record makes this
    // session's loads filter correctly even while the kv write is still in
    // flight; the kv record is what makes the uninstall survive a refresh
    // (see the removedNames filter in _fetchAndRenderApps).
    _setAppRemoved (appName, removed) {
        if ( typeof appName !== 'string' || appName.length === 0 ) return;
        if ( ! this._removedLocal ) this._removedLocal = new Map();
        this._removedLocal.set(appName, removed);

        // Persist by read-modify-write, serialized on a promise chain so two
        // quick uninstalls can't interleave their reads and writes. Every
        // local mutation is replayed onto the freshly read list, so a write
        // that failed earlier is repaired by the next one, and names added
        // by another window survive. If the read itself fails, the write is
        // skipped rather than risk clobbering the stored list with an empty
        // one — the in-memory record still covers this session, and the
        // next write retries the lot.
        this._removedWriteChain = (this._removedWriteChain || Promise.resolve()).then(async () => {
            const names = parseRemovedApps(await puter.kv.get(REMOVED_APPS_KV_KEY));
            for ( const [name, isRemoved] of this._removedLocal ) {
                if ( isRemoved ) names.add(name);
                else names.delete(name);
            }
            await puter.kv.set(REMOVED_APPS_KV_KEY, JSON.stringify(serializeRemovedApps(names)));
        }).catch(err => {
            console.error('Failed to persist the uninstalled-apps list:', err);
        });
    },

    saveOrder () {
        this._hasCustomOrder = true;
        // Merge with the previously saved order so names absent from the
        // current list (e.g. apps whose installedApps page failed to load
        // this session) keep their saved positions — the saved order is the
        // only record of them, and stale names are harmless because
        // reconcileAppOrder ignores them.
        const names = mergeSavedOrder(serializeAppOrder(this._apps), this._savedOrderNames);
        this._savedOrderNames = names;
        // Loads already in flight fetched kv before this save; mark the
        // boundary so their stale snapshot can't replay over it (see
        // _resolveOrderNames).
        this._orderSavedAtSeq = this._loadSeq || 0;
        try {
            const p = puter.kv.set(APPS_ORDER_KV_KEY, JSON.stringify(names));
            if ( p && typeof p.catch === 'function' ) {
                p.catch(err => console.error('Failed to save app order:', err));
            }
        } catch ( err ) {
            console.error('Failed to save app order:', err);
        }
    },

    loadApps ($el_window) {
        if ( this._drag ) {
            // Don't fetch/re-render on top of a live drag; cancel a pending
            // (not-yet-started) pickup so a rebuild can't strand it.
            if ( this._drag.started ) return;
            this._endDrag(false);
        }
        // init and the initial-route onActivate both fire on open; join the
        // in-flight load instead of issuing a duplicate request trio.
        if ( this._loadPromise ) return this._loadPromise;
        const p = this._fetchAndRenderApps($el_window).finally(() => {
            if ( this._loadPromise === p ) this._loadPromise = null;
        });
        this._loadPromise = p;
        return p;
    },

    async _fetchAndRenderApps ($el_window) {
        // Give each load a monotonically increasing id. An older/slower
        // response must not clobber a newer one that already applied — or a
        // reorder the user saved while a stale fetch was in flight. We gate on
        // "already applied", not "latest started", so the first load to
        // resolve still populates _apps (the pager's ResizeObserver needs
        // _apps set as soon as any load resolves).
        const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);

        const $container = $el_window.find('.myapps-container');

        try {
            // Fetch the two app lists and the saved order together. The
            // installedApps endpoint caps `limit` at 100 and paginates, so page
            // through it — otherwise a user with >100 apps silently loses the
            // rest from the grid and from search. Common case is a single page
            // (a short page ends the loop before a second request).
            const fetchAllInstalledApps = async () => {
                const PAGE_SIZE = 100;
                const MAX_PAGES = 50; // 5000 apps — a runaway backstop
                const all = [];
                for ( let page = 1; page <= MAX_PAGES; page++ ) {
                    try {
                        const res = await fetch(
                            `${window.api_origin}/installedApps?orderBy=name&limit=${PAGE_SIZE}&page=${page}`,
                            {
                                headers: { 'Authorization': `Bearer ${puter.authToken}` },
                                method: 'GET',
                            },
                        );
                        const batch = await res.json();
                        // An error payload (e.g. `{"error": ...}` on a 401/500)
                        // must fail the page — reading it as end-of-pagination
                        // would silently drop every installed app.
                        if ( ! Array.isArray(batch) ) {
                            throw new Error(`installedApps returned a non-array response (status ${res.status})`);
                        }
                        if ( batch.length === 0 ) break;
                        all.push(...batch);
                        if ( batch.length < PAGE_SIZE ) break;
                    } catch ( err ) {
                        // A first-page failure is a failed load. A later page
                        // failing must not fail the refresh — that would turn
                        // one flaky request among N into an empty (or frozen)
                        // grid. Return what we have and flag it incomplete;
                        // the merge below fills the gap from the previous
                        // list so the grid and saved order can't shrink.
                        if ( page === 1 ) throw err;
                        console.error(`Failed to fetch installedApps page ${page}; got ${all.length} apps before the failure:`, err);
                        return { apps: all, complete: false };
                    }
                }
                return { apps: all, complete: true };
            };

            const [installedResult, launchRes, savedOrderRaw, removedAppsRaw] = await Promise.all([
                fetchAllInstalledApps(),
                fetch(
                    `${window.api_origin}/get-launch-apps?icon_size=128`,
                    {
                        headers: { 'Authorization': `Bearer ${window.auth_token}` },
                        method: 'GET',
                    },
                ),
                puter.kv.get(APPS_ORDER_KV_KEY).catch(() => null),
                puter.kv.get(REMOVED_APPS_KV_KEY).catch(() => null),
            ]);

            const installedApps = installedResult.apps;
            const launchData = await launchRes.json();

            // Uninstall only revokes permissions, and the recommended list
            // is a global hardcoded set that knows nothing about per-user
            // revokes — without this filter every uninstalled recommended
            // app resurrects on the next load. Only the recommended merge
            // is filtered; installedApps is never touched, so an app the
            // user genuinely (re)installs always shows. The kv snapshot is
            // overlaid with this session's not-yet-persisted mutations: an
            // uninstall races its own kv write, and a failed uninstall's
            // rollback races the removal of that write.
            const removedNames = parseRemovedApps(removedAppsRaw);
            if ( this._removedLocal ) {
                for ( const [name, isRemoved] of this._removedLocal ) {
                    if ( isRemoved ) removedNames.add(name);
                    else removedNames.delete(name);
                }
            }

            // Normalize recommended launch apps to the tile shape. The
            // recent list is deliberately unused: recents are open history,
            // not installs, so they resurrected uninstalled apps' tiles and
            // showed merely-visited sites as if installed. Anything the user
            // actually uses appears via installedApps (opening an app grants
            // it a permission). Recents still power the Home tab.
            const launchApps = (launchData.recommended || [])
                .filter(app => ! removedNames.has(app?.name))
                .map(app => ({
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

            // A page beyond the first failed: fill the gap with apps we
            // already know about so one flaky request among N can't make
            // apps vanish from the grid, from search, or from a subsequently
            // saved order. Apps uninstalled remotely may linger until the
            // next complete refresh — the same staleness any between-refresh
            // window has.
            if ( ! installedResult.complete && Array.isArray(this._apps) ) {
                for ( const app of this._apps ) {
                    if ( seen.has(app.name) ) continue;
                    seen.add(app.name);
                    merged.push({ ...app });
                }
            }

            // Overlay the user's saved ordering (if any). New apps are appended
            // in their default order; stale names are ignored.
            let orderedNames = null;
            try {
                if ( savedOrderRaw ) {
                    orderedNames = typeof savedOrderRaw === 'string'
                        ? JSON.parse(savedOrderRaw)
                        : savedOrderRaw;
                }
            } catch ( _e ) {
                orderedNames = null;
            }
            // Skip only if a strictly newer load already applied its result.
            if ( loadSeq < (this._appliedSeq || 0) ) return;
            // A drag began while we were awaiting: rendering now would yank
            // the grid out from under it, but the data must not be thrown
            // away either — stash it for _endDrag to apply.
            if ( this._drag?.started ) {
                if ( ! this._pendingLoad || loadSeq > this._pendingLoad.loadSeq ) {
                    this._pendingLoad = { $el_window, merged, orderedNames, loadSeq };
                }
                return;
            }
            this._pendingLoad = null;
            this._appliedSeq = loadSeq;
            // A drag may have started AND committed while this load was in
            // flight; _resolveOrderNames keeps its saved reorder from being
            // replayed over by this load's pre-save kv snapshot.
            const effectiveOrder = this._resolveOrderNames(loadSeq, orderedNames);
            this._savedOrderNames = effectiveOrder;

            this._hasCustomOrder = Array.isArray(effectiveOrder) && effectiveOrder.length > 0;

            this._apps = reconcileAppOrder(merged, effectiveOrder);
            this.renderApps($el_window);
        } catch (e) {
            console.error('Failed to load installed apps:', e);
            // Only show the failure placeholder when nothing has loaded yet; a
            // transient re-fetch error must not wipe a grid already on screen.
            if ( ! this._apps ) {
                $container.html('<div class="myapps-empty"><p>Failed to load apps</p></div>');
            }
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

    // A direct landing on /app/<name> (see initgui's dashboard branch) plays
    // the same click→morph→open sequence a real tile click does, so the user
    // sees WHICH tile the app came from — and where minimize will put it
    // back. This waits for the tile to be genuinely visible (grid loaded,
    // load-fade revealed, icon painted — the flourish must never play over
    // blank space), then paces out the sequence: a beat to take the grid in,
    // a visible flip when the tile lives on a later pager page, the tile's
    // click flourish, a beat for it to read, and only then does it resolve
    // for the caller to open the window, whose morph grows it out of the
    // tile's slot.
    //
    // The intro is pedagogy, and it knows when to step aside:
    //   - INTERRUPTIBLE: any pointer/key/wheel input skips the remaining
    //     choreography and resolves at once — the trained user's instinctive
    //     click gets an instant launch. Input never cancels the launch
    //     itself (the URL asked for the app), and it is never swallowed:
    //     whatever it was doing (typing a search, flipping a page) still
    //     happens.
    //   - EXPOSURE DECAY: after DEEP_LINK_INTRO_TEACH_COUNT delivered (or
    //     deliberately skipped) intros, the beats collapse and the sequence
    //     plays in one breath — see the constant for why the count lives in
    //     kv. The page flip is exempt: unlike the beats it isn't repeating a
    //     lesson, it's live wayfinding to where THIS app lives, and its
    //     settle is needed anyway to put the tile in view for the morph.
    //
    // Resolves to the tile element, or null when there is nothing to
    // introduce — app not installed (resolved as soon as the app list
    // arrives, with no further waiting), grid slower than the deadline
    // (which also bounds a stalled app-list fetch: a hung request must not
    // hold the launch hostage), or animations that wouldn't play anyway;
    // the landing then launches immediately with the plain fade it always
    // had.
    //
    // Also claims the app in _launchingApps immediately, so a user click on
    // the tile mid-intro is swallowed instead of spawning a second instance
    // (same guard as the click handler). The caller MUST call
    // settleDeepLinkLaunch once its launch attempt settles.
    async beginDeepLinkLaunch (appName, $el_window) {
        this._launchingApps.add(appName);
        // No animations, no intro: the morph and the flourish would both
        // no-op, so waiting on the grid would only delay the launch.
        if ( ! window.animate_window_opening || this._reduceMotion() ) return null;
        const deadline = Date.now() + DEEP_LINK_INTRO_DEADLINE_MS;

        // How many intros this account has already been shown — fetched in
        // parallel with the grid load, so it is long resolved by the time
        // the beats need the answer.
        const seen_promise = puter.kv.get(DEEP_LINK_INTRO_SEEN_KV_KEY).catch(() => null);

        // Interruption plumbing. The flag is checked at every step, and
        // waking the in-flight sleep makes a skip take effect NOW rather
        // than at the end of a beat. Passive capture listeners: they must
        // see input that page handlers consume, and must never delay it.
        let interrupted = false;
        let wake = () => {};
        const on_input = (e) => {
            // Real user input only — a script-dispatched event is not a
            // person asking the intro to hurry up.
            if ( ! e.isTrusted ) return;
            interrupted = true;
            wake();
        };
        const sleep = ms => new Promise(resolve => {
            wake = resolve;
            setTimeout(resolve, ms);
        });
        document.addEventListener('pointerdown', on_input, { capture: true, passive: true });
        document.addEventListener('keydown', on_input, { capture: true, passive: true });
        document.addEventListener('wheel', on_input, { capture: true, passive: true });

        let tile = null;
        let flourish_played = false;
        try {
            // Join the load init() already started rather than racing a
            // duplicate — but never wait past the deadline: fetch has no
            // timeout of its own, and a stalled app-list request used to
            // stall the launch with it. (Racing the interruptible sleep also
            // lets input cut this wait short.)
            try {
                await Promise.race([
                    this.loadApps($el_window),
                    sleep(Math.max(0, deadline - Date.now())),
                ]);
            } catch ( _e ) { /* a failed load leaves _apps unset; handled below */ }
            if ( interrupted ) return null;
            if ( ! Array.isArray(this._apps) || ! this._apps.some(a => a.name === appName) ) {
                return null;
            }
            while ( Date.now() < deadline && ! interrupted ) {
                // A hidden page (deep link opened in a background tab) can't
                // show the intro at all — and won't finish this wait either:
                // Chrome throttles the sleep below to 1Hz and defers the
                // deferred-render path's ResizeObserver, so waiting just
                // delays the launch. Skip to the plain open; the app is
                // simply there when the tab is finally brought forward.
                if ( document.visibilityState === 'hidden' ) return null;
                // Re-query every pass — renders replace tile nodes
                // wholesale, and the first render can trail the load itself
                // (the window is briefly hidden entering full-page mode, so
                // renderApps defers to the ResizeObserver until the
                // container has a size). Scoped to the ACTIVE section: if
                // the user has already moved to another tab, there is no
                // visible tile to introduce from.
                const candidate = $el_window.find('.dashboard-section-apps.active .myapps-tile').toArray()
                    .find(el => el.dataset.appName === appName);
                if ( candidate ) {
                    const revealed = ! $el_window.find('.myapps-pager').hasClass('myapps-pager-loading');
                    const img = candidate.querySelector('.myapps-tile-icon img');
                    if ( revealed && ( ! img || img.complete ) ) {
                        tile = candidate;
                        break;
                    }
                }
                await sleep(DEEP_LINK_INTRO_POLL_MS);
            }
            if ( ! tile || interrupted ) return tile;
            // The count is normally long resolved; the short cap covers a
            // hung kv read without holding a ready tile back (the timed-out
            // default of 0 errs toward teaching).
            const seen = parseIntroSeenCount(await Promise.race([seen_promise, sleep(400)]));
            const teach = seen < DEEP_LINK_INTRO_TEACH_COUNT;
            if ( interrupted ) return tile;
            // Everything is on screen — now pace the sequence (see the beat
            // constants). The beats are also where the user may navigate
            // away: a page hidden mid-beat skips the rest of the
            // choreography and just opens the app (the flourish would play
            // unseen, and the window's morph re-checks tile visibility on
            // its own anyway).
            if ( teach ) {
                await sleep(DEEP_LINK_INTRO_GRID_BEAT_MS);
                if ( interrupted || document.visibilityState === 'hidden' ) return tile;
            }
            // A tile on a later pager page: travel there visibly, AFTER the
            // reveal and the grid beat — the grid opens on its familiar
            // first page and the user watches the flip land on the page the
            // app actually lives on (which is also where minimize will put
            // it back).
            const page = $el_window.find('.myapps-page').index($(tile).closest('.myapps-page'));
            if ( page >= 0 && page !== this._page ) {
                this.goToPage($el_window, page, true);
                await sleep(DEEP_LINK_INTRO_FLIP_SETTLE_MS);
                if ( interrupted || document.visibilityState === 'hidden' ) return tile;
            }
            begin_dashboard_tile_launch(tile);
            flourish_played = true;
            if ( teach ) {
                await sleep(DEEP_LINK_INTRO_CLICK_BEAT_MS);
            }
            return tile;
        } finally {
            document.removeEventListener('pointerdown', on_input, { capture: true });
            document.removeEventListener('keydown', on_input, { capture: true });
            document.removeEventListener('wheel', on_input, { capture: true });
            // What counts as "seen": the flourish was delivered while the
            // user watched, or they had the grid in front of them and
            // actively skipped ahead — proof they didn't need the rest.
            // Fallbacks (hidden tab, timeout, no tile) taught nothing and
            // don't count.
            if ( flourish_played || (tile && interrupted) ) {
                this._recordDeepLinkIntroSeen(seen_promise);
            }
        }
    },

    // Bump the per-account intro counter. kv.incr is atomic on the server,
    // so two devices landing at once can't lose an increment; the pre-read
    // only CAPS the counter — once the lesson is learned there is nothing
    // left to record and the key stops changing. A failed write just means
    // one more teach later.
    _recordDeepLinkIntroSeen (seen_promise) {
        Promise.resolve(seen_promise).then(raw => {
            if ( parseIntroSeenCount(raw) >= DEEP_LINK_INTRO_TEACH_COUNT ) return;
            return puter.kv.incr(DEEP_LINK_INTRO_SEEN_KV_KEY);
        }).catch(err => {
            console.error('Failed to record the deep-link intro exposure:', err);
        });
    },

    // Release beginDeepLinkLaunch's duplicate-launch claim once the landing's
    // launch attempt is over — success or failure, tile or no tile —
    // mirroring the tile click handler's finally (including its
    // settle_dashboard_tile_launch, which un-marks the tile if the window's
    // morph never claimed it).
    settleDeepLinkLaunch (appName, tile) {
        this._launchingApps.delete(appName);
        settle_dashboard_tile_launch(tile);
    },
};

export default TabApps;
