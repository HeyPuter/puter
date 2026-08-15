import UIContextMenu from '../UIContextMenu.js';
import UIAlert from '../UIAlert.js';
import launch_app from '../../helpers/launch_app.js';
import revokeAppSessions from '../../helpers/revoke_app_sessions.js';
import { begin_dashboard_tile_launch, settle_dashboard_tile_launch } from '../UIWindow.js';
import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import { reconcileAppOrder, serializeAppOrder, mergeSavedOrder, APPS_ORDER_KV_KEY } from './appOrder.js';
import { parseRemovedApps, serializeRemovedApps, REMOVED_APPS_KV_KEY } from './removedApps.js';
import { appTileLink } from './appLink.js';
import { is_window_on_screen, user_facing_windows } from '../../helpers/window_visibility.js';
import {
    APP_GROUPS_KV_KEY,
    MAX_GROUP_APPS,
    MAX_GROUP_NAME_LENGTH,
    addAppToGroup,
    buildGridItems,
    createGroup,
    defaultGroupName,
    findGroupById,
    flattenGridItems,
    orderWithAppAfter,
    parseAppGroups,
    removeAppFromGroups,
    removeGroup,
    renameGroup,
    reorderGroupApps,
    serializeAppGroups,
} from './appGroups.js';

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

// -- Add-an-app tile --
/** Puter's app marketplace — the add-an-app tile's route to installing one. */
const APP_CENTER_APP_NAME = 'app-center';
/** Puter's AI app builder, which generates an app from a description. */
const BUILDER_APP_NAME = 'builder';

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

// -- Drag-to-group tuning (iOS folders) --
// Hovering a tile is ambiguous: it means "push over, I'm passing through" AND
// "swallow me, let's be a folder". Pixels can't separate the two — the tile is
// barely bigger than the icon — so MOTION does: an icon that comes to REST on
// a tile opens it into a folder well, while one that carries on shuffles it
// aside on the way past. Hence the shuffle waits until the icon leaves the
// tile (or the drop settles it) rather than firing the moment it arrives:
// displacing on arrival would move the target out from under the very icon
// deciding to join it, and no folder could ever be made.
const DRAG_MERGE_DWELL_MS = 460;
// How still "at rest" is. Checked when the dwell elapses rather than as the
// pointer moves: a hand that is still drifting simply restarts the countdown,
// so the offer always arrives once the icon settles — and never while it is
// being carried across the grid.
const DRAG_MERGE_TRAVEL = 7;
// Once the well is open the target is sticky across its whole tile — a hand
// that drifts a few px must not silently undo the folder it is watching form.
const DRAG_MERGE_STICKY_PAD = 10;
const DRAG_MERGE_DROP_MS = 240;     // ghost dropping into the folder it joined
// A tile dragged this far outside the open folder's card leaves the folder
// (iOS: drag an app out of a folder and it lands back on the home screen).
const GROUP_EJECT_MARGIN = 24;
// How long the icon must stay carried outside the card before the folder
// closes under it and the SAME drag carries on over the grid, placeholder
// and page flips included, so the user PLACES the app rather than
// discovering where a blind drop put it (see _ejectToGrid). A beat of
// forgiveness first: an overshoot can swing straight back in.
const GROUP_EJECT_CLOSE_MS = 260;

// -- Folder panel --
const GROUP_ICON_MAX_TILES = 9;     // the 3x3 mini-grid on a folder's icon
// A folder big enough to need it paginates like the grid outside (iOS folders
// page too) rather than growing a scrollbar: this many rows to a page, fewer
// when the viewport can't show that many (see _refreshGroupPanel).
const GROUP_PANEL_ROWS = 3;
const GROUP_PANEL_OPEN_MS = 380;    // keep in sync with .myapps-group-panel
const GROUP_PANEL_CLOSE_MS = 240;
// A brand-new folder opens itself so the user sees what their drop made — and
// lands on the name, because "Folder" is a placeholder, not an answer. The
// wait lets the drop animation finish first.
const GROUP_CREATE_OPEN_DELAY_MS = 260;

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
// A landing on an app the dashboard doesn't list yet is what INSTALLS it
// (opening grants the permission that installedApps reports) — so the grid
// says so: the app's tile materializes at the tail, held invisible until
// the intro has travelled to its page, then is INSTALLED before the
// flourish and the morph grow the window out of it. The arrival plays the
// install grammar users already know: the slot opens with the icon dim
// inside it — present but not yet usable — a progress stroke draws around
// the slot, and on completion the icon springs to full color and size
// while the label names it (keep in sync with
// .myapps-tile-install-arriving). It is the one beat that never decays:
// per-app news that happens at most once per app, not a repeated lesson.
// See _spliceDeepLinkApp.
const DEEP_LINK_INSTALL_ARRIVE_MS = 1400;
const DEEP_LINK_INSTALL_REST_MS = 220;

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

// The tile at the tail of the grid that is not an app but the way to GET one
// (see showAddAppModal). It wears the same .myapps-tile skeleton as an app so
// hover, focus, and keyboard navigation treat it identically, and carries
// neither an app name nor a group id — which is what keeps it out of the saved
// order, the running dots, and the deep-link tile lookups, all of which key
// off those attributes.
function buildAddTileHtml () {
    const label = i18n('add_app');
    let h = `<div class="myapps-tile myapps-add-tile" role="button" tabindex="-1" title="${label}" aria-label="${label}">`;
    h += '<div class="myapps-tile-icon myapps-add-icon">';
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    h += '</div>';
    h += `<span class="myapps-tile-label">${label}</span>`;
    h += '</div>';
    return h;
}

// One instance per app when opened from the dashboard: un-hide a minimized
// instance / focus a visible one instead of launching a duplicate. Returns
// whether an existing window took the request.
//
// "Un-hide" covers a window hidden outright as well as a minimized one — an
// app can hide itself with puter.ui.hideWindow(), and with no taskbar in
// dashboard mode its tile is the only way back to it. Focusing it instead
// would leave the tile dead (and hand the keyboard to a window nobody can
// see); showWindow() tells the two cases apart.
//
// Only the user's own instances count (user_facing_windows): an instance
// another app launched in the background is that app's private helper, so the
// tile must not reopen it — the click launches a fresh instance and the helper
// stays hidden, still serving whoever launched it.
function focusExistingAppWindow (appName) {
    const $existing = $(user_facing_windows($(`.window[data-app="${html_encode(appName)}"]`)));
    if ( ! $existing.length ) return false;
    const $on_screen = $existing.filter((_, el) => is_window_on_screen(el)).last();
    if ( $on_screen.length ) {
        $on_screen.focusWindow();
        return true;
    }
    $existing.last().showWindow();
    return true;
}

// The label a folder shows: its own name, or the default one if a rename
// somehow left it blank (a nameless tile is one the user can't tell apart).
function groupLabel (group) {
    return group.name || i18n('app_group_default_name', [], false);
}

// A folder tile: same .myapps-tile skeleton as an app (so hover, focus, drag,
// FLIP, and the launch morph all treat it identically), with the icon slot
// filled by iOS's miniature grid of the apps inside instead of one icon.
// data-group-apps lets code outside this tab (UIWindow's minimize morph) find
// which folder an app lives in without reaching into the tab's state.
function buildGroupTileHtml (group, apps) {
    const label = groupLabel(group);
    const shown = apps.slice(0, GROUP_ICON_MAX_TILES);
    const names = JSON.stringify(apps.map(app => app.name));

    let h = `<div class="myapps-tile myapps-group-tile" role="button" tabindex="-1" data-group-id="${html_encode(group.id)}" data-group-apps="${html_encode(names)}" title="${html_encode(label)}" aria-label="${i18n('app_group_tile_aria', [label, apps.length])}">`;
    h += '<div class="myapps-tile-icon myapps-group-icon">';
    h += '<div class="myapps-group-icon-grid">';
    for ( const app of shown ) {
        const iconUrl = app.icon === null
            ? window.icons['app-default.svg']
            : (app.iconUrl || window.icons['app.svg']);
        h += `<img src="${html_encode(iconUrl)}" alt="" draggable="false">`;
    }
    h += '</div>';
    h += '</div>';
    h += `<span class="myapps-tile-label">${html_encode(label)}</span>`;
    h += '</div>';
    return h;
}

// What a tile is, across a re-render that replaces every node: an app tile is
// its app, a folder tile is its folder. Used to match a tile to its old box
// when FLIP-animating the grid closing up.
function tileIdentity (tileEl) {
    return tileEl.dataset.groupId
        ? `group:${tileEl.dataset.groupId}`
        : `app:${tileEl.dataset.appName || ''}`;
}

// How many columns a CSS grid resolved to — arrow-key up/down inside the
// folder needs the folder's own column count, which (unlike the pager's) is
// decided by the stylesheet rather than computeLayout.
function gridColumnCount (gridEl) {
    const tracks = getComputedStyle(gridEl).gridTemplateColumns;
    if ( ! tracks || tracks === 'none' ) return 1;
    return Math.max(1, tracks.split(' ').filter(Boolean).length);
}

// The app names a folder tile carries (see buildGroupTileHtml). Corruption
// reads as an empty folder rather than throwing — the tile is still a tile.
function parseTileGroupApps (tileEl) {
    try {
        const names = JSON.parse(tileEl.dataset.groupApps || '[]');
        return Array.isArray(names) ? names : [];
    } catch ( _e ) {
        return [];
    }
}

function buildGridItemHtml (item) {
    if ( item.type === 'add' ) return buildAddTileHtml();
    return item.type === 'group'
        ? buildGroupTileHtml(item.group, item.apps)
        : buildTileHtml(item.app);
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

// A search that matched none of the user's apps. Unlike buildNoAppsHtml this
// is a line ABOVE the grid rather than a stand-in for it: the grid still has
// the add-an-app tile in it, which is the one useful answer to a search for an
// app you don't have.
function buildNoMatchesHtml () {
    return '<div class="myapps-empty myapps-empty-notice"><p>No apps match your search</p></div>';
}

// iOS-home-screen-style pager: fixed cols × rows pages in a horizontal
// scroll-snap scroller, with page dots below and hover arrows for mouse users.
// Takes grid ITEMS (see buildGridItems) — an app or a folder both occupy one
// slot, so paging and layout are blind to the difference.
function buildPagerHtml (items, layout, instant) {
    const pageCount = Math.ceil(items.length / layout.perPage);

    let h = `<div class="myapps-pager${instant ? '' : ' myapps-pager-loading'}" style="--myapps-cols: ${layout.cols}">`;

    h += '<div class="myapps-pager-scroller">';
    for ( let p = 0; p < pageCount; p++ ) {
        h += '<div class="myapps-page">';
        for ( const item of items.slice(p * layout.perPage, (p + 1) * layout.perPage) ) {
            h += buildGridItemHtml(item);
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
            // FIRST: rects of the surviving tiles keyed by identity — the
            // re-render replaces every node, so an app maps through its name
            // and a folder through its id (it has no app name of its own).
            const firstRects = new Map();
            if ( ! self._reduceMotion() ) {
                for ( const el of $el_window.find('.myapps-tile').toArray() ) {
                    if ( el.dataset.appName === appName ) continue;
                    firstRects.set(tileIdentity(el), el.getBoundingClientRect());
                }
            }
            self._apps.splice(idx, 1);
            self.renderApps($el_window, { preservePage: true, instant: true });
            // FLIP the survivors from their old boxes into the new layout.
            const moved = [];
            for ( const el of $el_window.find('.myapps-tile').toArray() ) {
                const a = firstRects.get(tileIdentity(el));
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

// What the grid's add-an-app tile asks: which of the three ways to get an app
// do you want? Install one that already exists, have one built for you, or ask
// for one that doesn't exist yet. Uses the same modal shell as the uninstall
// confirmation above, with the options as rows rather than a question.
function showAddAppModal ({ $el_window }) {
    const options = [
        {
            key: 'browse',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
            title: i18n('add_app_browse'),
            desc: i18n('add_app_browse_desc'),
        },
        {
            key: 'ai',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M11 3.5 12.7 8.3 17.5 10 12.7 11.7 11 16.5 9.3 11.7 4.5 10 9.3 8.3z"/><path d="M18 14.5 18.8 16.7 21 17.5 18.8 18.3 18 20.5 17.2 18.3 15 17.5 17.2 16.7z"/></svg>',
            title: i18n('add_app_ai'),
            desc: i18n('add_app_ai_desc'),
        },
        {
            key: 'request',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            title: i18n('add_app_request'),
            desc: i18n('add_app_request_desc'),
        },
    ];

    let h = '<div class="myapps-modal-overlay">';
    h += `<div class="myapps-modal myapps-add-modal" role="dialog" aria-modal="true" aria-label="${i18n('add_app')}">`;

    // The three ways in.
    h += '<div class="myapps-add-pane" data-pane="options">';
    h += `<h3>${i18n('add_app')}</h3>`;
    h += '<div class="myapps-add-options">';
    for ( const option of options ) {
        h += `<button type="button" class="myapps-add-option" data-add-option="${option.key}">`;
        h += `<span class="myapps-add-option-icon">${option.icon}</span>`;
        h += '<span class="myapps-add-option-text">';
        h += `<span class="myapps-add-option-title">${option.title}</span>`;
        h += `<span class="myapps-add-option-desc">${option.desc}</span>`;
        h += '</span>';
        h += '<svg class="myapps-add-option-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        h += '</button>';
    }
    h += '</div>';
    h += '<div class="myapps-modal-buttons">';
    h += `<button class="myapps-modal-btn myapps-modal-cancel">${i18n('cancel')}</button>`;
    h += '</div>';
    h += '</div>';

    // The request form. Lives in the same card so asking for an app is one
    // step deeper into the same decision, not a second window over the top
    // of it — Back returns to the options with whatever was typed intact.
    h += '<div class="myapps-add-pane" data-pane="request" hidden>';
    h += '<div class="myapps-add-head">';
    h += `<button type="button" class="myapps-add-back" aria-label="${i18n('back')}">`;
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    h += '</button>';
    h += `<h3>${i18n('add_app_request')}</h3>`;
    h += '</div>';
    h += `<p>${i18n('add_app_request_c2a')}</p>`;
    h += `<textarea class="myapps-add-message" placeholder="${i18n('add_app_request_placeholder')}"></textarea>`;
    h += `<p class="myapps-add-error" role="alert" hidden>${i18n('add_app_request_failed')}</p>`;
    h += '<div class="myapps-modal-buttons">';
    h += `<button class="myapps-modal-btn myapps-modal-cancel">${i18n('cancel')}</button>`;
    h += `<button class="myapps-modal-btn myapps-add-send" disabled>${i18n('send')}</button>`;
    h += '</div>';
    h += '</div>';

    // Sent.
    h += '<div class="myapps-add-pane" data-pane="sent" hidden>';
    h += '<div class="myapps-add-sent">';
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9.5"/></svg>';
    h += `<p>${i18n('add_app_request_sent')}</p>`;
    h += '</div>';
    h += '<div class="myapps-modal-buttons">';
    h += `<button class="myapps-modal-btn myapps-modal-cancel">${i18n('close')}</button>`;
    h += '</div>';
    h += '</div>';

    h += '</div>';
    h += '</div>';

    const $overlay = $(h);
    $el_window.append($overlay);

    const close = () => {
        $overlay.remove();
        $(document).off('keydown.add-app-modal');
    };

    const currentPane = () => $overlay.find('.myapps-add-pane:not([hidden])').attr('data-pane');

    const showPane = name => {
        $overlay.find('.myapps-add-pane').attr('hidden', 'hidden');
        $overlay.find(`.myapps-add-pane[data-pane="${name}"]`).removeAttr('hidden');
        if ( name === 'request' ) {
            $overlay.find('.myapps-add-message').focus();
        } else if ( name === 'sent' ) {
            $overlay.find('[data-pane="sent"] .myapps-modal-cancel').focus();
        } else {
            $overlay.find('.myapps-add-option').first().focus();
        }
    };

    $overlay.on('click', '.myapps-modal-cancel', close);
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] ) close();
    });
    $overlay.on('click', '.myapps-add-back', () => showPane('options'));
    $(document).on('keydown.add-app-modal', function (e) {
        if ( e.key !== 'Escape' ) return;
        // Escape steps back out of the form before it closes the modal, so a
        // half-written request survives a mis-hit key.
        if ( currentPane() === 'request' ) showPane('options');
        else close();
    });

    // Opened exactly like an /app/<name> landing: the same pedagogical
    // click→morph→open intro plays (see beginDeepLinkLaunch) — and since
    // choosing App Center or the AI builder is usually asking for an app the
    // grid doesn't have yet, the intro is also what INSTALLS it: the tile
    // arrives in the grid with the install choreography, and only then does
    // the window grow out of the app's own slot. The user watches the app
    // they asked for become a tile they can find again; the window never
    // just appears from nowhere.
    const openApp = appName => {
        if ( focusExistingAppWindow(appName) ) return;
        // Same duplicate-launch guard as the tile click handler — a second
        // trip through the modal mid-intro must not spawn a second instance.
        if ( TabApps._launchingApps.has(appName) ) return;
        // Fetched in parallel with the intro, which may need it to DRAW the
        // arriving tile, then handed to launch_app so the intro never costs
        // a second app-info round-trip — the same contract as the landing's
        // prefetch in initgui. A failed prefetch hands nothing over;
        // launch_app refetches and fails the way it always did.
        const app_info_promise = puter.apps.get(appName, { icon_size: 128 })
            .catch(() => null);
        (async () => {
            let tile = null;
            try {
                tile = await TabApps.beginDeepLinkLaunch(appName, $el_window, app_info_promise);
            } catch ( _e ) {
                // No intro — still launch.
            }
            const app_obj = await app_info_promise;
            launch_app({
                name: appName,
                maximized: true,
                ...(app_obj ? { app_obj } : {}),
                window_options: { morph_from_dashboard_tile: true },
            }).catch(err => {
                console.error(`Failed to launch ${appName}:`, err);
                UIAlert(i18n('something_went_wrong'));
            }).finally(() => {
                TabApps.settleDeepLinkLaunch(appName, tile);
            });
        })();
    };

    $overlay.on('click', '.myapps-add-option', function () {
        const key = this.dataset.addOption;
        if ( key === 'request' ) {
            showPane('request');
            return;
        }
        // An app is opening — the modal has nothing left to say.
        close();
        if ( key === 'browse' ) openApp(APP_CENTER_APP_NAME);
        else if ( key === 'ai' ) openApp(BUILDER_APP_NAME);
    });

    // Nothing to send until something has been written.
    $overlay.on('input', '.myapps-add-message', function () {
        $overlay.find('.myapps-add-send').prop('disabled', this.value.trim() === '');
    });

    const send = async () => {
        const $btn = $overlay.find('.myapps-add-send');
        const message = String($overlay.find('.myapps-add-message').val() || '').trim();
        if ( ! message || $btn.prop('disabled') ) return;
        $btn.prop('disabled', true);
        $overlay.find('.myapps-add-error').attr('hidden', 'hidden');
        try {
            const res = await fetch(`${window.api_origin}/contactUs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${puter.authToken}`,
                },
                body: JSON.stringify({ message }),
            });
            if ( ! res.ok ) throw new Error(`contactUs responded ${res.status}`);
            showPane('sent');
        } catch ( err ) {
            // Said inside the form rather than in an alert: the request is
            // still here to retry, and an alert window over the modal is one
            // the next click on the dashboard would bury.
            console.error('Failed to send the app request:', err);
            $overlay.find('.myapps-add-error').removeAttr('hidden');
            $btn.prop('disabled', false);
        }
    };

    $overlay.on('click', '.myapps-add-send', send);
    // Enter alone belongs to the textarea (a request may need paragraphs).
    $overlay.on('keydown', '.myapps-add-message', function (e) {
        if ( e.key === 'Enter' && (e.metaKey || e.ctrlKey) ) {
            e.preventDefault();
            send();
        }
    });

    showPane('options');
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
    _groups: [],
    _openGroupId: null,
    _groupPage: 0,
    _groupPageCount: 0,
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
    _groupsSavedAtSeq: 0,
    _launchingApps: new Set(),
    // A deep-link install mid-arrival ({ name, $el_window }) — its tile is
    // parked invisible until the intro's arrival beat (see
    // _spliceDeepLinkApp); and the session's landing-installed apps, kept
    // so a refresh fetched before the launch's grant lands can't evict
    // their tiles (the mirror of _removedLocal).
    _arriving: null,
    _pendingInstalls: null,

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
        // fresh DOM that is not in reorder mode and has no folder open,
        // whatever the old one had — and a pending empty-space press (or an
        // open folder) holds document-level listeners that must not survive
        // the old DOM.
        this._reorderMode = false;
        this._cancelEmptyPress();
        this._closeGroup($el_window, { instant: true });
        // An arrival is a beat of the OLD window's intro; the fresh DOM
        // renders its tile plainly visible (the pending-install record, by
        // contrast, is data and survives re-init).
        this._arriving = null;

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
            if ( $(e.target).closest('.myapps-tile, .myapps-tile-remove, .myapps-reorder-btn, .myapps-pager-dot, .myapps-pager-arrow, .myapps-group-overlay').length ) return;
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
            // A click synthesized at the end of a drag must not open anything.
            if ( self._justDragged ) {
                self._justDragged = false;
                return;
            }
            // The tail tile isn't an app — it asks how you'd like to get one.
            // Answered in every mode: it is never part of the arrangement
            // reorder mode exists to edit.
            if ( this.classList.contains('myapps-add-tile') ) {
                showAddAppModal({ $el_window });
                return;
            }
            // Folders open in every mode — inside reorder mode that is the
            // only way to rearrange or empty one.
            if ( this.dataset.groupId ) {
                self._openGroup($el_window, this.dataset.groupId, this);
                return;
            }
            // In reorder mode a press on a tile is a (potential) drag pickup,
            // never a launch.
            if ( self._reorderMode ) return;
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
            // Launching from inside a folder closes it once the app is up —
            // the folder was the way in, not the destination (iOS shuts it
            // behind the opening app). Deferred to the launch's settle so the
            // tile is still there for the window's morph to grow out of.
            const fromFolder = !! this.closest('.myapps-group-panel-grid');
            const closeFolder = () => {
                if ( fromFolder ) self._closeGroup($el_window);
            };
            if ( targetLink && targetLink !== '' ) {
                window.open(targetLink, '_blank', 'noopener,noreferrer');
                closeFolder();
            } else if ( appName ) {
                // One instance per app when launched from here: un-hide a
                // minimized instance / focus a visible one rather than
                // launching a duplicate.
                if ( focusExistingAppWindow(appName) ) {
                    closeFolder();
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
                        closeFolder();
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
            // The add-an-app tile has no app for a menu to act on.
            if ( this.classList.contains('myapps-add-tile') ) {
                e.preventDefault();
                return;
            }
            // Reorder mode owns every tile gesture — no menu there; likewise
            // suppress the menu (and any long-press callout) mid-drag.
            if ( self._reorderMode || (self._drag && self._drag.started) ) {
                e.preventDefault();
                return;
            }
            // A pending pickup (button held, not yet moved) would be stranded
            // under the menu; cancel it so the two can't run at once. An
            // already-started drag was handled by the guard above.
            if ( self._drag ) self._endDrag(false);

            const groupId = this.dataset.groupId;
            if ( groupId ) {
                e.preventDefault();
                e.stopPropagation();
                const tile = this;
                UIContextMenu({
                    parent_element: $(this),
                    position: { top: e.clientY, left: e.clientX },
                    items: [
                        {
                            html: i18n('app_group_open'),
                            onClick: () => self._openGroup($el_window, groupId, tile),
                        },
                        {
                            html: i18n('app_group_rename'),
                            // Renaming happens in the folder's own header —
                            // one place to edit the name, seen in context.
                            onClick: () => self._openGroup($el_window, groupId, tile, { editName: true }),
                        },
                        '-',
                        {
                            html: i18n('app_group_ungroup'),
                            onClick: () => self._ungroup($el_window, groupId),
                        },
                    ],
                });
                return;
            }

            const appName = $(this).attr('data-app-name');
            const appTitle = $(this).attr('data-app-title');
            const appUid = $(this).attr('data-app-uid');
            const targetLink = $(this).attr('data-target-link');
            const noUninstall = APP_NAMES_NO_UNINSTALL.has((appName || '').toLowerCase());
            // Same window set the running dot counts: Quit is offered for what
            // the user has open, not for a helper another app is running in
            // the background (which is that app's to close, and dies with it).
            const isRunning = !! appName
                && user_facing_windows($(`.window[data-app="${html_encode(appName)}"]`)).length > 0;

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
                // The same destination the item above opens, as an absolute
                // URL so it is worth pasting somewhere other than this page.
                {
                    html: i18n('copy_link'),
                    onClick: async () => {
                        const link = appTileLink({ appName, targetLink }, window.location.origin);
                        if ( link ) await window.copy_to_clipboard(link);
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
                        // Re-read at click time (the set can change while the
                        // menu is open), and quit only what the menu offered:
                        // a background helper stays up for the app using it.
                        $(user_facing_windows($(`.window[data-app="${html_encode(appName)}"]`))).close();
                    },
                });
            }
            // Inside an open folder: the pointer-free way out of it, for
            // anyone who won't (or can't) drag the tile past the card's edge.
            if ( this.closest('.myapps-group-panel-grid') && self._openGroupId ) {
                items.push({
                    html: i18n('app_group_remove_from_folder'),
                    onClick: () => self._ejectFromGroup($el_window, appName),
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
        // Enter/Space launches the focused one (a folder tile opens instead).
        // Navigation is deliberately clamped to the visible page — the
        // keyboard never flips pages; the dots, hover arrows, and wheel remain
        // the paging affordances. updatePagerUI keeps one tile per render in
        // the tab order (roving tabindex), so Tab lands on the grid and arrows
        // take over from there. While a folder is open the same arrows walk
        // ITS tiles: the grid behind is inert, so focus must not be there.
        $(document).off('keydown.myapps-keyboard').on('keydown.myapps-keyboard', function (e) {
            if ( ! ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key) ) return;
            if ( ! $el_window.find('.dashboard-section-apps').hasClass('active') ) return;
            if ( ! $el_window.is(':visible') ) return;
            if ( $el_window.find('.myapps-modal-overlay').length ) return;
            if ( $('.window').not($el_window[0]).filter(':visible').length ) return;

            const $panelGrid = $el_window.find('.myapps-group-panel-grid');
            const pageTiles = ($panelGrid.length
                ? $panelGrid
                : $el_window.find('.myapps-page').eq(self._page)
            ).find('.myapps-tile').toArray();
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
            const cols = $panelGrid.length
                ? gridColumnCount($panelGrid.find('.myapps-group-page')[0] || $panelGrid[0])
                : ((self._layout && self._layout.cols) || 1);
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

        // Search looks THROUGH folders: a query is a question about apps, and
        // an answer the user then has to go hunting inside a folder for is not
        // an answer. Unfiltered, the grid folds into folders as usual.
        const items = query
            ? list.map(app => ({ type: 'app', app }))
            : buildGridItems(list, this._groups);

        // No apps at all, and nothing typed: there is no grid to page through,
        // so the empty state stands in for the whole of it.
        if ( items.length === 0 && ! query ) {
            this._layout = null;
            this._page = 0;
            this._pageCount = 0;
            $container.html(buildNoAppsHtml());
            return;
        }

        // A search that matched nothing still has a grid — the tail tile is in
        // it (below) — so the "nothing matched" line sits ABOVE that grid
        // rather than replacing it.
        const no_matches = query && items.length === 0;

        // The add-an-app tile rides at the tail of the grid: after every app,
        // on the last page, and nowhere else — a drag can't place an app past
        // it (see _updatePlaceholder) and a newly installed app arrives before
        // it. Pushed here, so it counts as a slot when the pages are laid out
        // below. Searching keeps it: "which of my apps is this" and "I don't
        // have it, get me one" are the same question asked a moment apart, and
        // the tile answers the second — never more so than when the query
        // matched nothing and it is the only thing left to offer.
        items.push({ type: 'add' });

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
        this._pageCount = Math.ceil(items.length / layout.perPage);
        this._page = Math.min(Math.floor(anchorIndex / layout.perPage), this._pageCount - 1);

        $container.html((no_matches ? buildNoMatchesHtml() : '')
            + buildPagerHtml(items, layout, instant));
        // A tile mid-arrival (a deep-link landing installing its app — see
        // _spliceDeepLinkApp) stays parked invisible across re-renders; the
        // intro's arrival beat, not the render, is what reveals it.
        if ( this._arriving ) {
            const el = $container.find('.myapps-tile').toArray()
                .find(t => t.dataset.appName === this._arriving.name);
            if ( el ) el.classList.add('myapps-tile-installing');
        }
        revealWhenLoaded($container);
        this.updateRunningDots($el_window);
        // An open folder outlives the grid rebuilds underneath it (a
        // background refresh must not slam it shut mid-browse); its contents
        // come from the same state, so they refresh here too.
        this._refreshGroupPanel($el_window);

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
    // are running) with the macOS-dock-style dot. A folder wears the dot when
    // anything inside it is running — the apps it hides are exactly the ones
    // whose state the user can't otherwise see. Cheap enough to re-run
    // wholesale on every open/close/render.
    //
    // The dot means "you have this app open", so it counts the user's windows
    // only (user_facing_windows): a helper another app launched in the
    // background is not something the user can switch to or quit, and lighting
    // the dot for it would promise a window the tile will not open.
    updateRunningDots ($el_window) {
        const isRunning = name => !! name
            && user_facing_windows($(`.window[data-app="${html_encode(name)}"]`)).length > 0;
        for ( const tile of $el_window.find('.myapps-tile').toArray() ) {
            const running = tile.dataset.groupId
                ? parseTileGroupApps(tile).some(isRunning)
                : isRunning(tile.getAttribute('data-app-name'));
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
        // The folder card's own empty space counts: with the grid's behind a
        // backdrop, holding there is the only way into reorder mode from
        // inside a folder. Its backdrop doesn't — a tap there closes.
        if ( $(oe.target).closest('.myapps-tile, .myapps-reorder-btn, .myapps-pager-dot, .myapps-pager-arrow, .myapps-search-inner, .myapps-modal-overlay, .myapps-group-backdrop, .myapps-group-name, .myapps-group-dots').length ) return;

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

    // -- Folders --
    // A folder opens the way iOS opens one: the grid recedes behind a blurred
    // scrim and the folder grows out of its own icon into a card — so the
    // enlargement reads as "this tile, opened", not "a dialog appeared". The
    // card is a plain overlay inside the tab (not a UIWindow): it belongs to
    // this grid, moves with the dashboard window, and closes on Escape, on a
    // click outside, or on the tile that opened it.

    _openGroup ($el_window, groupId, fromTile, { editName = false } = {}) {
        const group = findGroupById(this._groups, groupId);
        if ( ! group ) return;
        // Clicking the open folder's own tile again closes it, like iOS.
        if ( this._openGroupId === groupId ) {
            this._closeGroup($el_window);
            return;
        }
        if ( this._openGroupId ) this._closeGroup($el_window, { instant: true });
        // A folder closed a moment ago is still fading out; two cards on
        // screen would make every $overlay lookup below ambiguous, so the
        // outgoing one goes now and the incoming one takes over.
        $el_window.find('.myapps-group-overlay').remove();

        this._openGroupId = groupId;
        this._groupPage = 0;
        this._groupPageCount = 0;
        // Where focus came from, so closing can hand it back rather than
        // dumping the keyboard user at the top of the document.
        this._groupReturnFocus = fromTile || null;

        const $overlay = $(`
            <div class="myapps-group-overlay">
                <div class="myapps-group-backdrop"></div>
                <div class="myapps-group-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="${i18n('app_group_tile_aria', [groupLabel(group), group.apps.length])}">
                    <input type="text" class="myapps-group-name" maxlength="${MAX_GROUP_NAME_LENGTH}"
                        aria-label="${i18n('app_group_name_aria')}" autocomplete="off" autocorrect="off"
                        spellcheck="false" data-form-type="other" data-lpignore="true" data-1p-ignore>
                    <div class="myapps-group-panel-grid"></div>
                    <div class="myapps-group-dots" aria-label="Folder pages"></div>
                </div>
            </div>
        `);
        $el_window.find('.dashboard-tab-content.myapps-tab').append($overlay);
        this._refreshGroupPanel($el_window);
        // The refresh shuts a folder that turned out to have nothing to show
        // (its apps failed to load); there is then no panel to wire up.
        if ( this._openGroupId !== groupId ) return;
        this._bindGroupPanel($el_window, $overlay);
        this._animateGroupPanelOpen($el_window, fromTile);

        if ( editName && ! isTouchPrimaryDevice() ) {
            // Naming is the first thing a new folder wants; on touch the same
            // gesture would throw an on-screen keyboard over the folder the
            // user just made, so there they tap the name when ready.
            const input = $overlay.find('.myapps-group-name')[0];
            input.focus();
            input.select();
        } else {
            // The DOM node, not the jQuery wrapper: jQuery reads a lone
            // object argument to .focus() as event DATA and binds a handler
            // with it instead of moving focus — so the folder opened with
            // focus still on the inert grid behind it (Tab then walked off
            // through that grid, past this dialog's trap), and the bogus
            // handler threw on the tile's every later focus.
            const first = $overlay.find('.myapps-tile')[0];
            if ( first ) first.focus({ preventScroll: true });
        }
    },

    _bindGroupPanel ($el_window, $overlay) {
        const self = this;

        // Anywhere outside the card — including the strip of scrim beside it.
        $overlay.on('click', function (e) {
            if ( e.target === this || $(e.target).hasClass('myapps-group-backdrop') ) {
                self._closeGroup($el_window);
            }
        });

        // A press inside the overlay must not let initgui's global mousedown
        // hand focus (and the z-index) back to the window underneath it.
        $overlay.on('mousedown', function () {
            window.mouseover_window = undefined;
        });

        // -- The folder's own pager (see _refreshGroupPanel) --

        $overlay.on('click', '.myapps-group-dot', function () {
            self._goToGroupPage($el_window, parseInt(this.dataset.page, 10), true);
        });

        // Mouse wheel / two-finger vertical swipe flips one folder page per
        // gesture, mirroring the grid's scroller (which see for the debounce).
        $overlay.on('wheel', '.myapps-group-panel-grid', function (e) {
            const oe = e.originalEvent;
            if ( Math.abs(oe.deltaX) > Math.abs(oe.deltaY) ) return;
            if ( Math.abs(oe.deltaY) < 4 ) return;
            e.preventDefault();
            clearTimeout(self._groupWheelTimer);
            self._groupWheelTimer = setTimeout(() => {
                self._groupWheelActive = false;
            }, 150);
            if ( self._groupWheelActive ) return;
            self._groupWheelActive = true;
            self._goToGroupPage($el_window, self._groupPage + (oe.deltaY > 0 ? 1 : -1), true);
        });

        // Keep the active dot in sync with native swipes. The scroller node
        // outlives every _refreshGroupPanel rebuild (only its contents are
        // replaced), so binding once here is enough.
        const scroller = $overlay.find('.myapps-group-panel-grid')[0];
        let ticking = false;
        scroller.addEventListener('scroll', () => {
            if ( ticking ) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                const pageW = scroller.clientWidth || 1;
                const idx = Math.round(Math.abs(scroller.scrollLeft) / pageW);
                const page = Math.max(0, Math.min((self._groupPageCount || 1) - 1, idx));
                if ( page !== self._groupPage ) {
                    self._groupPage = page;
                    self._updateGroupPagerUI($el_window);
                }
            });
        }, { passive: true });

        // Focus follows pages: Tab (or the arrow keys, whose focus calls
        // suppress the browser's own scrolling) may land on a tile of an
        // offscreen folder page — flip there, snap-aligned, so focus is never
        // on something the user can't see.
        $overlay.on('focusin', '.myapps-tile', function () {
            const $pages = $overlay.find('.myapps-group-page');
            const page = $pages.index($(this).closest('.myapps-group-page'));
            if ( page >= 0 && page !== self._groupPage ) {
                self._goToGroupPage($el_window, page, true);
            }
        });

        // Escape closes from anywhere — a click on the scrim leaves focus on
        // no element in particular, and the key must still work there. Not
        // mid-drag, where Escape already means "cancel this drag".
        this._groupEscHandler = e => {
            if ( e.key !== 'Escape' || this._drag ) return;
            if ( $el_window.find('.myapps-modal-overlay').length ) return;
            this._closeGroup($el_window);
        };
        document.addEventListener('keydown', this._groupEscHandler);

        $overlay.on('keydown', function (e) {
            // The folder is modal: Tab cycles inside it rather than walking
            // off into the inert grid behind.
            if ( e.key !== 'Tab' ) return;
            const focusables = $overlay.find('.myapps-group-name, .myapps-tile').toArray()
                .filter(el => el.offsetParent !== null);
            if ( focusables.length === 0 ) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const idx = focusables.indexOf(document.activeElement);
            // idx -1: focus sits on the card itself (its tabindex=-1 catches
            // clicks on the card's empty space, keeping this trap in reach) —
            // going backwards from there must wrap inside too, not step off
            // through the scrim.
            if ( e.shiftKey && idx <= 0 ) {
                e.preventDefault();
                last.focus();
            } else if ( ! e.shiftKey && idx === focusables.length - 1 ) {
                e.preventDefault();
                first.focus();
            }
        });

        const $name = $overlay.find('.myapps-group-name');
        // Enter commits (and gets out of the way); blur commits too, so a
        // click straight onto an app in the folder keeps the new name.
        $name.on('keydown', function (e) {
            if ( e.key === 'Enter' ) {
                e.preventDefault();
                // The name box owns this Enter: the grid's document-level key
                // handler reads Enter on a focused tile as "launch it", and
                // the focus move below would hand it exactly that — the same
                // keystroke would name the folder AND open an app out of it.
                e.stopPropagation();
                // Step out onto the folder's contents rather than just
                // blurring: a bare blur leaves focus on <body>, outside this
                // dialog, where the next Tab walks off into the inert grid
                // the folder is covering. Moving focus still commits the
                // name — that is the same blur.
                const first = $overlay.find('.myapps-group-panel-grid .myapps-tile')[0];
                if ( first ) first.focus({ preventScroll: true });
                else this.blur();
            }
            if ( e.key === 'Escape' ) {
                const group = findGroupById(self._groups, self._openGroupId);
                const stored = group ? groupLabel(group) : '';
                // An edit in progress: Escape means "never mind THIS EDIT"
                // (the convention of every inline rename), not "close the
                // folder" — left to propagate, the document handler would
                // close it and _closeGroup's commit-on-close would store the
                // very half-typed name being abandoned. Put the stored name
                // back and step out of the box; the next Escape, with no
                // edit left to cancel, closes the folder as usual.
                if ( this.value === stored ) return;
                e.preventDefault();
                e.stopPropagation();
                this.value = stored;
                const first = $overlay.find('.myapps-group-panel-grid .myapps-tile')[0];
                if ( first ) first.focus({ preventScroll: true });
                else this.blur();
            }
        });
        $name.on('change blur', function () {
            self._renameGroup($el_window, self._openGroupId, this.value);
        });
    },

    // Rebuild the open folder's contents from the current state — called on
    // every render, so a background refresh, an uninstall, or a drag all keep
    // the card truthful. Closes it if the folder is gone.
    _refreshGroupPanel ($el_window) {
        if ( ! this._openGroupId ) return;
        const $overlay = $el_window.find('.myapps-group-overlay');
        if ( $overlay.length === 0 ) return;

        const group = findGroupById(this._groups, this._openGroupId);
        const apps = group
            ? group.apps
                .map(name => (this._apps || []).find(app => app.name === name))
                .filter(Boolean)
            : [];
        // Under two apps it is not a folder any more (the grid draws the
        // survivor as a plain tile); there is nothing left to browse.
        if ( apps.length < 2 ) {
            this._closeGroup($el_window, { instant: true });
            return;
        }

        const $name = $overlay.find('.myapps-group-name');
        // Never overwrite a name being typed.
        if ( ! $name.is(':focus') ) $name.val(groupLabel(group));
        const $grid = $overlay.find('.myapps-group-panel-grid');
        // Only as wide as it needs to be, within the cap the stylesheet sets
        // for the viewport — a folder of three in a four-wide card would sit
        // lopsided against a stretch of empty surface.
        const gridCS = getComputedStyle($grid[0]);
        const maxCols = parseInt(gridCS.getPropertyValue('--myapps-group-cols-max'), 10);
        const cols = Math.max(1, Math.min(apps.length, Number.isFinite(maxCols) ? maxCols : 4));
        $grid[0].style.setProperty('--myapps-group-cols', String(cols));

        // A folder that outgrows one page paginates, like the grid outside —
        // GROUP_PANEL_ROWS rows to a page, fewer when the viewport is too
        // short for them (landscape phones): the card must never outgrow the
        // screen now that it doesn't scroll. ~180px is the card's overhead
        // around the rows (scrim padding, card padding, name row, dots).
        const tileH = parseFloat(gridCS.getPropertyValue('--myapps-tile-h')) || 78;
        const rows = Math.max(1, Math.min(
            GROUP_PANEL_ROWS,
            Math.floor((window.innerHeight - 180) / (tileH + 24)),
        ));
        const perPage = cols * rows;
        const pageCount = Math.ceil(apps.length / perPage);

        let html = '';
        for ( let p = 0; p < pageCount; p++ ) {
            html += '<div class="myapps-group-page">';
            for ( const app of apps.slice(p * perPage, (p + 1) * perPage) ) {
                html += buildTileHtml(app);
            }
            html += '</div>';
        }
        // A rebuild replaces every tile node, and a node detached mid-gesture
        // takes the rest of that gesture with it: the name box commits on
        // BLUR, which fires on the press — before the click it belongs to —
        // so renaming a folder and then clicking an app in it renamed the
        // folder and did nothing else (the click found no tile to bubble
        // from). Nothing here changes on a rename, so nothing is rebuilt.
        if ( $grid[0].__myappsPanelHtml !== html ) {
            // The rebuild is about to detach a focused tile, and the routes
            // in here that go through a context menu (Remove from Folder)
            // already dropped focus to <body> when the menu closed. Focus
            // stranded outside an open folder breaks its modality — Tab
            // walks the inert grid behind the scrim — so pull it back to
            // the same app's tile (or the first). Only from <body>: an
            // uninstall modal above the folder holds focus legitimately.
            const focusedApp = $grid[0].contains(document.activeElement)
                ? document.activeElement.dataset.appName
                : null;
            $grid[0].__myappsPanelHtml = html;
            $grid.html(html);
            $overlay.find('.myapps-tile').attr('tabindex', '0');

            // The rebuild reset the scroller; put it back on the page the
            // user was browsing (clamped — a shrink can delete that page),
            // and rebuild the dots to the new page count.
            this._groupPageCount = pageCount;
            this._groupPage = Math.max(0, Math.min(this._groupPage, pageCount - 1));
            let dots = '';
            for ( let p = 0; p < pageCount; p++ ) {
                dots += `<button class="myapps-group-dot" data-page="${p}" aria-label="Page ${p + 1} of ${pageCount}"></button>`;
            }
            $overlay.find('.myapps-group-dots')
                .html(dots)
                .toggleClass('myapps-group-dots-hidden', pageCount < 2);
            if ( this._groupPage > 0 ) {
                $grid[0].scrollLeft = this._groupPage * $grid[0].clientWidth;
            }
            this._updateGroupPagerUI($el_window);

            const ae = document.activeElement;
            if ( ae === document.body || ae === null || ! ae.isConnected ) {
                const tiles = $grid[0].querySelectorAll('.myapps-tile');
                const target = [...tiles].find(t => t.dataset.appName === focusedApp) || tiles[0];
                if ( target ) target.focus({ preventScroll: true });
            }
        } else {
            // Tiles that survive keep the resting rects an earlier drag left
            // on them, and the card may have moved since (a resize re-centres
            // it) — stale rects are what the next drag would hit-test against.
            for ( const el of $grid[0].querySelectorAll('.myapps-tile') ) el.__myappsRestRect = null;
        }
        this.updateRunningDots($el_window);
    },

    _goToGroupPage ($el_window, index, smooth) {
        const scroller = $el_window.find('.myapps-group-panel-grid')[0];
        if ( ! scroller || ! this._groupPageCount ) return;
        const page = Math.max(0, Math.min(this._groupPageCount - 1, index));
        scroller.scrollTo({
            left: page * scroller.clientWidth,
            behavior: (smooth && ! this._reduceMotion()) ? 'smooth' : 'auto',
        });
        // Programmatic scrolls don't reliably emit 'scroll' events; track the
        // page eagerly (same as goToPage).
        this._groupPage = page;
        this._updateGroupPagerUI($el_window);
    },

    _updateGroupPagerUI ($el_window) {
        const page = this._groupPage;
        $el_window.find('.myapps-group-dots .myapps-group-dot').each(function (i) {
            this.classList.toggle('active', i === page);
            if ( i === page ) {
                this.setAttribute('aria-current', 'true');
            } else {
                this.removeAttribute('aria-current');
            }
        });
    },

    _animateGroupPanelOpen ($el_window, fromTile) {
        const $overlay = $el_window.find('.myapps-group-overlay');
        const panel = $overlay.find('.myapps-group-panel')[0];
        const icon = fromTile && fromTile.isConnected
            ? (fromTile.querySelector('.myapps-tile-icon') || fromTile)
            : null;
        const from = icon ? icon.getBoundingClientRect() : null;
        const to = panel.getBoundingClientRect();

        if ( this._reduceMotion() || ! from || from.width <= 0 || to.width <= 0 ) {
            $overlay.addClass('myapps-group-open');
            return;
        }

        // Start collapsed onto the folder's own icon, then release: the card
        // is the icon, enlarged.
        const scale = Math.max(0.05, from.width / to.width);
        panel.style.transition = 'none';
        panel.style.transform =
            `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, `
            + `${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${scale})`;
        void panel.offsetWidth; // commit the collapsed start state
        panel.style.transition = '';
        $overlay.addClass('myapps-group-open');
        panel.style.transform = '';
    },

    _closeGroup ($el_window, { instant = false } = {}) {
        const groupId = this._openGroupId;
        if ( ! groupId ) return;
        this._openGroupId = null;
        // Commit a name still being typed. Every other way out of the folder
        // (clicking outside it, launching an app from it) commits through the
        // box's own blur while the folder is still open; closing is the one
        // path that blurs it AFTER — handing focus back to the tile below, or
        // simply removing the card — so the blur handler would find no open
        // folder to rename and the typed name would be dropped on the floor.
        const nameEl = $el_window.find('.myapps-group-name')[0];
        if ( nameEl && document.activeElement === nameEl ) {
            this._renameGroup($el_window, groupId, nameEl.value);
        }
        clearTimeout(this._createdGroupTimer);
        if ( this._groupEscHandler ) {
            document.removeEventListener('keydown', this._groupEscHandler);
            this._groupEscHandler = null;
        }

        const $overlay = $el_window.find('.myapps-group-overlay');
        const returnFocus = this._groupReturnFocus;
        this._groupReturnFocus = null;

        // Hand focus back to the tile the folder came from — but only if it is
        // still on screen and the user hasn't moved on to something else.
        const tile = $el_window.find(`.myapps-group-tile[data-group-id="${CSS.escape(groupId)}"]`)[0]
            || (returnFocus && returnFocus.isConnected ? returnFocus : null);
        if ( tile && $overlay[0] && $overlay[0].contains(document.activeElement) ) {
            tile.focus({ preventScroll: true });
        }

        if ( $overlay.length === 0 ) return;
        if ( instant || this._reduceMotion() ) {
            $overlay.remove();
            return;
        }

        // The card is on its way out but its scrim still spans the viewport:
        // without this it would swallow every click on the grid until the
        // removal below, so the tile a user reaches for the instant a folder
        // shuts would do nothing.
        $overlay.css('pointer-events', 'none');

        // Back into the tile it grew out of; if that tile is gone (the folder
        // dissolved, the page flipped) the card simply recedes where it is.
        const panel = $overlay.find('.myapps-group-panel')[0];
        const icon = tile ? (tile.querySelector('.myapps-tile-icon') || tile) : null;
        const from = icon ? icon.getBoundingClientRect() : null;
        const to = panel.getBoundingClientRect();
        if ( from && from.width > 0 && to.width > 0 ) {
            const scale = Math.max(0.05, from.width / to.width);
            panel.style.transform =
                `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, `
                + `${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${scale})`;
        }
        $overlay.removeClass('myapps-group-open');
        setTimeout(() => $overlay.remove(), GROUP_PANEL_CLOSE_MS);
    },

    _renameGroup ($el_window, groupId, name) {
        const group = findGroupById(this._groups, groupId);
        if ( ! group ) return;
        const next = renameGroup(this._groups, groupId, name);
        const renamed = findGroupById(next, groupId);
        // An empty or whitespace-only name keeps the old one; put it back in
        // the box so what the user sees is what is stored.
        $el_window.find('.myapps-group-name').val(renamed ? groupLabel(renamed) : '');
        if ( ! renamed || renamed.name === group.name ) return;
        this._groups = next;
        this.saveGroups();
        this.renderApps($el_window, { preservePage: true, instant: true });
    },

    // Dissolve a folder: its apps stay exactly where the folder was, side by
    // side, so nothing is lost or moved somewhere the user has to find.
    _ungroup ($el_window, groupId) {
        if ( ! findGroupById(this._groups, groupId) ) return;
        if ( this._openGroupId === groupId ) this._closeGroup($el_window);
        this._groups = removeGroup(this._groups, groupId);
        this.saveGroups();
        this.renderApps($el_window, { preservePage: true, instant: true });
    },

    // Take one app out of a folder. It lands on the grid immediately after
    // the folder it came from, so it turns up where the user was looking
    // rather than at the end of the last page. Returns whether it moved.
    _ejectApp ($el_window, groupId, appName) {
        const group = findGroupById(this._groups, groupId);
        if ( ! group || ! group.apps.includes(appName) ) return false;

        const anchors = group.apps.filter(name => name !== appName);
        const names = orderWithAppAfter(this._gridOrderNames($el_window), appName, anchors);
        this._groups = removeAppFromGroups(this._groups, appName);
        this._apps = reconcileAppOrder(this._apps, names);
        this.saveGroups();
        this.saveOrder();
        return true;
    },

    // The context-menu route out of the open folder; the drag route is
    // _commitEject, which always closes the folder because the user is
    // already looking at the grid by then.
    _ejectFromGroup ($el_window, appName) {
        if ( ! this._ejectApp($el_window, this._openGroupId, appName) ) return;
        // Two apps left one behind: the folder is gone and there is nothing to
        // stay open for. Otherwise the folder stays open, one app lighter.
        const dissolved = ! findGroupById(this._groups, this._openGroupId);
        if ( dissolved ) this._closeGroup($el_window);
        this.renderApps($el_window, { preservePage: true, instant: true });
        // The re-render replaced every node, including whatever _closeGroup
        // just handed focus to — and the context menu this ran from dropped
        // focus to <body> anyway. Give it to the ejected app's tile, where
        // the user's attention is. (The folder-stays-open case is covered by
        // _refreshGroupPanel's own restore.)
        if ( dissolved && (document.activeElement === document.body || ! document.activeElement) ) {
            const tile = $el_window.find('.myapps-page .myapps-tile').toArray()
                .find(el => el.dataset.appName === appName);
            if ( tile ) tile.focus({ preventScroll: true });
        }
    },

    saveGroups () {
        const groups = serializeAppGroups(this._groups);
        this._groups = groups;
        // Loads already in flight fetched kv before this save; mark the
        // boundary so their stale snapshot can't replay over it (see
        // _resolveGroups).
        this._groupsSavedAtSeq = this._loadSeq || 0;
        try {
            const p = puter.kv.set(APP_GROUPS_KV_KEY, JSON.stringify(groups));
            if ( p && typeof p.catch === 'function' ) {
                p.catch(err => console.error('Failed to save app folders:', err));
            }
        } catch ( err ) {
            console.error('Failed to save app folders:', err);
        }
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
        // The add-an-app tile holds the tail and isn't part of the
        // arrangement: it can't be picked up, and nothing can be dropped onto
        // it (see _updatePlaceholder).
        if ( tileEl.classList.contains('myapps-add-tile') ) return;
        // Reordering a filtered subset is ambiguous — only reorder the full list.
        const query = String($el_window.find('.myapps-search').val() || '').trim();
        if ( query ) return;

        // A drag inside an open folder rearranges (or empties) that folder;
        // one on the grid rearranges the grid. The container decides which,
        // and is fixed for the life of the gesture.
        const panelGrid = tileEl.closest('.myapps-group-panel-grid');
        // A folder that is open but not the one being dragged in means the
        // grid behind is under a backdrop the user can't reach anyway.
        if ( this._openGroupId && ! panelGrid ) return;

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
            panelGrid,
            groupId: panelGrid ? this._openGroupId : null,
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
            // Folder gestures: the tile being hovered long enough to swallow
            // this one, and (inside a folder) whether the drop would take the
            // app back out onto the grid.
            mergeEl: null,
            mergeTimer: null,
            mergeArmed: false,
            mergeAnchorX: 0,
            mergeAnchorY: 0,
            ejecting: false,
            ejectTimer: null,
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
        if ( d.panelGrid ) {
            // Carrying an app past the folder's edge takes it out of the
            // folder; the card visibly recoils so the intent is legible
            // before the finger lifts.
            this._updateEjectState(e.clientX, e.clientY);
            if ( d.ejecting ) return;
            if ( d.flipping ) return;
            this._maybeGroupEdgeFlip(e.clientX);
            if ( d.flipping ) return;
            this._updatePlaceholder(e.clientX, e.clientY);
            return;
        }
        if ( d.flipping ) return;
        this._maybeEdgeFlip(e.clientX);
        if ( d.flipping ) return;
        this._updatePlaceholder(e.clientX, e.clientY);
    },

    // Whether the dragged icon has left the open folder's card (with a margin
    // of forgiveness, since the card's edge is also where the last row of
    // tiles sits). Only meaningful for a drag that started inside a folder.
    // An icon that stays out past GROUP_EJECT_CLOSE_MS is ejected mid-drag —
    // see _ejectToGrid; a drop during the beat before that still ejects, it
    // just lands beside the folder (_commitEject) instead of where the user
    // carried it.
    _updateEjectState (px, py) {
        const d = this._drag;
        const panel = d.$el_window.find('.myapps-group-panel')[0];
        if ( ! panel ) return;
        const r = panel.getBoundingClientRect();
        // The dragged icon's centre, not the fingertip — the drop follows
        // where the tile visually is (same probe the placeholder uses).
        const x = px - d.offsetX + d.tileW / 2;
        const y = py - d.offsetY + d.tileH / 2;
        const outside = x < r.left - GROUP_EJECT_MARGIN || x > r.right + GROUP_EJECT_MARGIN
            || y < r.top - GROUP_EJECT_MARGIN || y > r.bottom + GROUP_EJECT_MARGIN;
        if ( outside === d.ejecting ) return;
        d.ejecting = outside;
        d.$el_window.find('.myapps-group-overlay').toggleClass('myapps-group-ejecting', outside);
        clearTimeout(d.ejectTimer);
        d.ejectTimer = null;
        if ( outside ) {
            this._vibrate(8);
            // A timer, not a pointer event, ends the beat: nothing is
            // dispatched while the icon rests outside the card.
            d.ejectTimer = setTimeout(() => {
                d.ejectTimer = null;
                if ( this._drag !== d || ! d.ejecting ) return;
                this._ejectToGrid(d);
            }, GROUP_EJECT_CLOSE_MS);
        }
    },

    // The icon has been carried out of the folder and held there: take the
    // app out NOW — the folder closes behind it and the very same drag
    // carries on over the grid (placeholder shuffle, edge page flips, even a
    // drop into another folder), so the app lands where the user watched
    // themselves put it. The membership change is saved here, exactly as a
    // drop at this moment would have saved it; the drop that eventually ends
    // the drag saves only the final position.
    _ejectToGrid (d) {
        const appName = d.tileEl.dataset.appName;
        if ( ! this._ejectApp(d.$el_window, d.groupId, appName) ) return;
        this._closeGroup(d.$el_window);
        this.renderApps(d.$el_window, { preservePage: true, instant: true });

        const tile = d.$el_window.find('.myapps-page .myapps-tile').toArray()
            .find(el => el.dataset.appName === appName);
        if ( ! tile ) {
            // Nothing left to carry (the app vanished in a refresh); the
            // eject itself stands, there is just nothing to place.
            this._endDrag(false);
            return;
        }

        // A folder-page flip armed just before the icon left the card must
        // not fire into the grid drag this has become.
        clearTimeout(d.edgeTimer);
        d.edgeTimer = null;
        d.edgeDir = 0;

        d.panelGrid = null;
        d.groupId = null;
        d.ejecting = false;
        d.tileEl = tile;
        tile.classList.add('myapps-tile-dragging');
        // The tile landed beside its old folder, possibly on another page;
        // this pulls the placeholder straight under the icon the user is
        // still holding.
        this._updatePlaceholder(d.lastClientX, d.lastClientY);
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
        // A merge offer in progress means the icon is parked on a tile, not
        // asking for a page — and a last-column tile sits inside the edge
        // zone, so without this hold the page would flip out from under the
        // very folder the user is watching form. Carrying the icon off the
        // tile withdraws the offer (see _updatePlaceholder), and with it
        // this hold.
        if ( ! d.mergeEl ) {
            if ( px >= r.right - DRAG_EDGE_ZONE ) dir = 1;
            else if ( px <= r.left + DRAG_EDGE_ZONE ) dir = -1;
        }

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
            // The offer can arrive while this dwell runs (resting on an
            // edge-zone tile starts both countdowns): no pointer event fires
            // during a rest to clear the timer, so re-check at the flip.
            if ( d.mergeEl ) return;
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

    // _maybeEdgeFlip's folder-card counterpart: dwelling at the card's edge
    // flips its pages, so a drag can reorder across them. The zone is
    // narrower than the grid's — the card's scroller is exactly as wide as
    // its tiles, so a wide zone would swallow the whole edge column; this
    // one stays inside the edge tiles' hit-test dead band (DRAG_HIT_INSET).
    // No merge hold either: tiles inside a folder never merge.
    _maybeGroupEdgeFlip (px) {
        const d = this._drag;
        const scroller = d.panelGrid;
        if ( ! scroller || this._groupPageCount < 2 ) return;

        const r = scroller.getBoundingClientRect();
        const zone = Math.min(DRAG_EDGE_ZONE, d.tileW * DRAG_HIT_INSET);
        let dir = 0;
        if ( px >= r.right - zone ) dir = 1;
        else if ( px <= r.left + zone ) dir = -1;

        const atEnd = (dir === 1 && this._groupPage >= this._groupPageCount - 1);
        const atStart = (dir === -1 && this._groupPage <= 0);
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
            if ( this._drag !== d || d.ejecting ) return;
            d.flipping = true;
            this._goToGroupPage(d.$el_window, this._groupPage + dir, true);
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
    //
    // Hovering also has a second meaning — "make a folder out of us" — which
    // _considerMerge arbitrates by motion before any shuffling happens.
    _updatePlaceholder (px, py, { force = false } = {}) {
        const d = this._drag;
        if ( ! d ) return;
        // Inside a folder, only the visible page's tiles are live targets —
        // the other pages' tiles have real rects just past the scroller's
        // clip edge, and a probe near the card's edge must not shuffle a
        // tile the user can't see.
        const pageEl = d.panelGrid
            ? d.panelGrid.querySelectorAll('.myapps-group-page')[this._groupPage]
            : d.$el_window.find('.myapps-page').toArray()[this._page];
        if ( ! pageEl ) return;

        // Probe with the dragged icon's centre rather than the fingertip, so the
        // drop follows where the tile visually is.
        const probeX = px - d.offsetX + d.tileW / 2;
        const probeY = py - d.offsetY + d.tileH / 2;

        // An armed folder target holds across its whole tile: a hand that
        // drifts while watching the well fill must not silently lose it.
        if ( d.mergeArmed && d.mergeEl ) {
            if ( this._probeOverTile(d.mergeEl, probeX, probeY, DRAG_MERGE_STICKY_PAD) ) return;
            this._clearMergeTarget();
        }

        const tiles = Array.from(pageEl.querySelectorAll('.myapps-tile'));

        let overIndex = -1;
        for ( let i = 0; i < tiles.length; i++ ) {
            const t = tiles[i];
            if ( t === d.tileEl ) continue;
            // The add-an-app tile is never a drop target, so an app can never
            // be placed after it — the probe over its slot reads as a gap and
            // leaves the arrangement alone. It stays in `tiles` so it still
            // FLIP-slides along when a drop from another page pushes it.
            if ( t.classList.contains('myapps-add-tile') ) continue;
            const r = t.__myappsRestRect || t.getBoundingClientRect();
            const insetX = r.width * DRAG_HIT_INSET;
            const insetY = r.height * DRAG_HIT_INSET;
            if ( probeX >= r.left + insetX && probeX <= r.right - insetX &&
                 probeY >= r.top + insetY && probeY <= r.bottom - insetY ) {
                overIndex = i;
                break;
            }
        }
        const overTile = overIndex === -1 ? null : tiles[overIndex];

        // The icon has carried on past the tile it was hovering: that was a
        // pass-through, not a folder — the tile steps aside now, which is the
        // shuffle that was held back while the two readings were open.
        if ( d.mergeEl && d.mergeEl !== overTile ) {
            const passed = d.mergeEl;
            this._clearMergeTarget();
            this._displaceTo(tiles, passed, pageEl);
            return;
        }

        // In a gap / over the placeholder itself: leave the arrangement alone.
        if ( ! overTile ) return;

        // Still deciding whether this hover is a pass-through or a folder:
        // hold the shuffle until the answer is in (`force` is the drop
        // resolving it — see _endDrag).
        if ( ! force && this._considerMerge(overTile) ) return;

        this._displaceTo(tiles, overTile, pageEl);
    },

    // Move the placeholder into `overTile`'s slot; everything between cascades.
    // After the move the probe sits over the vacated gap, so it won't bounce.
    _displaceTo (tiles, overTile, pageEl) {
        const d = this._drag;
        const overIndex = tiles.indexOf(overTile);
        if ( overIndex === -1 || ! overTile.isConnected ) return;
        const phIndex = tiles.indexOf(d.tileEl);
        const refNode = (phIndex === -1 || overIndex < phIndex)
            ? overTile
            : overTile.nextElementSibling;
        // overTile's own parent, not pageEl: inside a folder the tiles live
        // one level down, in the current .myapps-group-page.
        const parentEl = overTile.parentElement || pageEl;

        this._flipMove(tiles.filter(t => t !== d.tileEl), () => {
            if ( refNode ) parentEl.insertBefore(d.tileEl, refNode);
            else parentEl.appendChild(d.tileEl);
        });
    },

    // Offer `overTile` as a folder and start the countdown. Returns true while
    // the offer stands — the caller holds the shuffle for exactly that long,
    // since displacing the target would move it out from under the very icon
    // deciding to join it.
    _considerMerge (overTile) {
        const d = this._drag;
        if ( ! this._canMergeInto(overTile) ) {
            this._clearMergeTarget();
            return false;
        }
        if ( d.mergeEl === overTile ) {
            // The countdown measures REST, and rest is only visible at its
            // edges: each move event that carries the icon further across
            // the tile re-anchors the countdown HERE, so the one that
            // finally completes started with the last movement — the well
            // fills exactly once, beginning the moment the hand stops.
            // (Anchoring at first contact instead made the dwell's own
            // re-check trip on the hand decelerating INTO the tile, and the
            // refill played the fill twice on nearly every merge.)
            if ( ! d.mergeArmed ) {
                const moved = Math.hypot(d.lastClientX - d.mergeAnchorX, d.lastClientY - d.mergeAnchorY);
                if ( moved > DRAG_MERGE_TRAVEL ) {
                    d.mergeAnchorX = d.lastClientX;
                    d.mergeAnchorY = d.lastClientY;
                    this._restartMergeCountdown(d, overTile);
                }
            }
            return true;
        }

        d.mergeEl = overTile;
        d.mergeAnchorX = d.lastClientX;
        d.mergeAnchorY = d.lastClientY;
        overTile.classList.add('myapps-tile-merge-pending');
        d.mergeTimer = setTimeout(() => this._mergeDwellElapsed(d, overTile), DRAG_MERGE_DWELL_MS);
        return true;
    },

    // Restart the rest countdown — and with it the well's fill, from empty:
    // the fill IS the countdown to the user (the CSS transition runs the same
    // DRAG_MERGE_DWELL_MS), so a well left full while the countdown quietly
    // reran would promise a folder the drop wouldn't make.
    _restartMergeCountdown (d, overTile) {
        overTile.classList.remove('myapps-tile-merge-pending');
        void overTile.offsetWidth; // commit the empty state
        overTile.classList.add('myapps-tile-merge-pending');
        clearTimeout(d.mergeTimer);
        d.mergeTimer = setTimeout(() => this._mergeDwellElapsed(d, overTile), DRAG_MERGE_DWELL_MS);
    },

    _mergeDwellElapsed (d, overTile) {
        if ( this._drag !== d || d.mergeEl !== overTile ) return;
        // Movement normally restarts the countdown from the move events
        // themselves (see _considerMerge); this re-check only catches travel
        // in the final instants before the timer fired. It exists because
        // nothing is dispatched while the icon rests — a cancel-on-movement
        // dwell could never fire at all.
        const moved = Math.hypot(d.lastClientX - d.mergeAnchorX, d.lastClientY - d.mergeAnchorY);
        if ( moved > DRAG_MERGE_TRAVEL ) {
            d.mergeAnchorX = d.lastClientX;
            d.mergeAnchorY = d.lastClientY;
            this._restartMergeCountdown(d, overTile);
            return;
        }
        d.mergeArmed = true;
        overTile.classList.add('myapps-tile-merge-armed');
        this._vibrate(12);
    },

    // Can the dragged tile be dropped INTO `tile`? Folders don't nest (so a
    // folder is never the thing being dropped, and never gains another
    // folder), and inside an open folder every tile is already together.
    _canMergeInto (tile) {
        const d = this._drag;
        if ( ! d || ! tile || d.panelGrid ) return false;
        if ( ! d.tileEl.dataset.appName ) return false;
        const groupId = tile.dataset.groupId;
        if ( groupId ) {
            const group = findGroupById(this._groups, groupId);
            return !! group && group.apps.length < MAX_GROUP_APPS;
        }
        return !! tile.dataset.appName;
    },

    _probeOverTile (tile, probeX, probeY, pad = 0) {
        const r = tile.__myappsRestRect || tile.getBoundingClientRect();
        return probeX >= r.left - pad && probeX <= r.right + pad
            && probeY >= r.top - pad && probeY <= r.bottom + pad;
    },

    _clearMergeTarget () {
        const d = this._drag;
        if ( ! d ) return;
        clearTimeout(d.mergeTimer);
        d.mergeTimer = null;
        if ( d.mergeEl ) {
            d.mergeEl.classList.remove('myapps-tile-merge-pending', 'myapps-tile-merge-armed');
        }
        d.mergeEl = null;
        d.mergeArmed = false;
    },

    // A haptic tick for the touch gestures that change what a drop will do.
    _vibrate (ms) {
        if ( ! this._drag || this._drag.pointerType !== 'touch' ) return;
        if ( ! navigator.vibrate ) return;
        try { navigator.vibrate(ms); } catch ( _e ) { /* not supported */ }
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
        clearTimeout(d.mergeTimer);
        clearTimeout(d.ejectTimer);
    },

    _endDrag (commit) {
        const d = this._drag;
        if ( ! d ) return;
        const mergeEl = commit && d.mergeArmed ? d.mergeEl : null;
        const ejecting = commit && d.ejecting;
        // A drop that was still deciding between "pass through" and "make a
        // folder" (see _considerMerge) has its answer now: it never became a
        // folder, so let the held-back shuffle happen — a quick drop onto a
        // neighbour reorders, exactly as it always did.
        if ( commit && d.started && d.mergeEl && ! d.mergeArmed ) {
            this._clearMergeTarget();
            this._updatePlaceholder(d.lastClientX, d.lastClientY, { force: true });
        }
        this._clearMergeTarget();
        this._drag = null;
        this._teardownDragListeners(d);
        document.body.classList.remove('myapps-reordering');
        d.$el_window.find('.myapps-group-overlay').removeClass('myapps-group-ejecting');

        if ( ! d.started ) {
            // Never became a drag — leave the click to open the app.
            return;
        }

        d.tileEl.classList.remove('myapps-tile-dragging');

        // The click this drop synthesizes may land on empty grid space (the
        // drop spot) — it is the tail of the drag, not an exit-the-mode tap.
        this._suppressEmptyTapBriefly();

        let changed = false;
        if ( mergeEl ) {
            changed = this._commitMerge(d, mergeEl);
        } else if ( ejecting ) {
            changed = this._commitEject(d);
        } else if ( commit && d.panelGrid ) {
            changed = this._commitFolderOrder(d);
        } else if ( commit ) {
            const names = this._gridOrderNames(d.$el_window);
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
            if ( mergeEl && ! this._reduceMotion() ) {
                // The icon falls INTO the folder it just joined rather than
                // fading where it was dropped — the only thing on screen that
                // says where the app went.
                this._dropGhostInto(ghost, mergeEl, d);
            } else {
                ghost.classList.add('myapps-drag-ghost-drop');
                setTimeout(() => ghost.remove(), this._reduceMotion() ? 0 : 160);
            }
        }

        // Rebuild so pages rebalance to exactly perPage; skip the load fade.
        this.renderApps(d.$el_window, { preservePage: true, instant: true });

        this._applyPendingLoad();
    },

    // Fly the drag ghost into a folder tile's icon and let it shrink away
    // there. Purely decorative: the grid underneath has already been rebuilt.
    _dropGhostInto (ghost, targetTile, d) {
        const icon = targetTile.querySelector('.myapps-tile-icon') || targetTile;
        const to = icon.getBoundingClientRect();
        if ( to.width <= 0 ) {
            ghost.remove();
            return;
        }
        const scale = Math.max(0.1, to.width / Math.max(1, d.tileW));
        ghost.style.transformOrigin = 'center';
        ghost.style.transition = `transform ${DRAG_MERGE_DROP_MS}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${DRAG_MERGE_DROP_MS}ms ease-in`;
        ghost.style.transform =
            `translate(${to.left + to.width / 2 - d.tileW / 2}px, ${to.top + to.height / 2 - d.tileH / 2}px) scale(${scale})`;
        ghost.style.opacity = '0';
        setTimeout(() => ghost.remove(), DRAG_MERGE_DROP_MS + 40);
    },

    // An app was dropped onto another app (make a folder of the two) or onto a
    // folder (join it). The dropped app moves next to what it joined in the
    // flat order, which is what puts the folder in the target's slot when the
    // grid is rebuilt — see buildGridItems. Returns whether anything changed.
    _commitMerge (d, targetTile) {
        const appName = d.tileEl.dataset.appName;
        if ( ! appName ) return false;

        // Read the order BEFORE the folders change: the group tiles still
        // expand to what they held when the DOM was built.
        let names = this._gridOrderNames(d.$el_window);
        const targetGroupId = targetTile.dataset.groupId;
        let createdId = null;

        if ( targetGroupId ) {
            const target = findGroupById(this._groups, targetGroupId);
            if ( ! target ) return false;
            this._groups = addAppToGroup(this._groups, targetGroupId, appName);
            names = orderWithAppAfter(names, appName, target.apps);
        } else {
            const targetName = targetTile.dataset.appName;
            if ( ! targetName || targetName === appName ) return false;
            const created = createGroup(
                this._groups,
                [targetName, appName],
                defaultGroupName(this._groups, i18n('app_group_default_name', [], false)),
            );
            if ( ! created.id ) return false;
            this._groups = created.groups;
            createdId = created.id;
            names = orderWithAppAfter(names, appName, [targetName]);
        }

        this._apps = reconcileAppOrder(this._apps, names);
        this.saveGroups();
        this.saveOrder();

        // A folder the user just invented opens itself: it shows what the drop
        // made, and lands on the name so "Folder" doesn't have to stick.
        if ( createdId ) {
            const $el_window = d.$el_window;
            clearTimeout(this._createdGroupTimer);
            this._createdGroupTimer = setTimeout(() => {
                // Not over a drag the user has since started, and not onto a
                // tab they have since left — either way the moment has passed.
                if ( this._drag ) return;
                if ( ! $el_window.find('.dashboard-section-apps').hasClass('active') ) return;
                const tile = $el_window.find(`.myapps-group-tile[data-group-id="${CSS.escape(createdId)}"]`)[0];
                this._openGroup($el_window, createdId, tile, { editName: true });
            }, this._reduceMotion() ? 0 : GROUP_CREATE_OPEN_DELAY_MS);
        }
        return true;
    },

    // An app was carried out of the open folder: it leaves the folder and
    // lands beside it on the grid, and the folder closes behind it (there is
    // nothing left to say — the user is looking at the grid now).
    _commitEject (d) {
        if ( ! this._ejectApp(d.$el_window, d.groupId, d.tileEl.dataset.appName) ) return false;
        this._closeGroup(d.$el_window);
        return true;
    },

    // A drag that stayed inside the folder rearranged it. The flat app order
    // is rewritten to match so the folder's contents and the grid's order
    // never disagree about who comes first.
    _commitFolderOrder (d) {
        const group = findGroupById(this._groups, d.groupId);
        if ( ! group ) return false;
        const tiles = d.panelGrid.querySelectorAll('.myapps-tile');
        const ordered = Array.from(tiles, tile => tile.dataset.appName).filter(Boolean);
        const before = group.apps.join('\n');
        this._groups = reorderGroupApps(this._groups, d.groupId, ordered);
        const after = (findGroupById(this._groups, d.groupId) || { apps: [] }).apps.join('\n');
        if ( before === after ) return false;

        this._apps = reconcileAppOrder(
            this._apps,
            flattenGridItems(buildGridItems(this._apps, this._groups)).map(app => app.name),
        );
        this.saveGroups();
        this.saveOrder();
        return true;
    },

    // The grid's app order as the DOM currently shows it, folders expanded to
    // the apps they hold. This is the same flat shape the saved order stores,
    // so a folder is just a run of adjacent names in it.
    _gridOrderNames ($el_window) {
        const present = new Set(this._apps.map(a => a.name));
        const names = [];
        for ( const tile of $el_window.find('.myapps-page .myapps-tile').toArray() ) {
            if ( tile.dataset.groupId ) {
                const group = findGroupById(this._groups, tile.dataset.groupId);
                if ( group ) names.push(...group.apps.filter(name => present.has(name)));
                continue;
            }
            if ( tile.dataset.appName ) names.push(tile.dataset.appName);
        }
        return names;
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
        this._groups = this._resolveGroups(pending.loadSeq, pending.groups);
        this._hasCustomOrder = Array.isArray(orderedNames) && orderedNames.length > 0;
        this._apps = reconcileAppOrder(pending.merged, orderedNames);
        this.renderApps(pending.$el_window, { preservePage: true, instant: true });
    },

    // The folders half of _resolveOrderNames, for the same reason: a fetch
    // issued before the user's latest local folder edit carries a pre-edit kv
    // snapshot, and replaying it would visibly undo the folder they just made.
    _resolveGroups (loadSeq, fetchedGroups) {
        return loadSeq <= (this._groupsSavedAtSeq || 0) ? this._groups : fetchedGroups;
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

            const [installedResult, launchRes, savedOrderRaw, removedAppsRaw, groupsRaw] = await Promise.all([
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
                puter.kv.get(APP_GROUPS_KV_KEY).catch(() => null),
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

            // Apps this session installed by landing on their URL (see
            // _spliceDeepLinkApp): a load fetched before the launch's
            // permission grant landed doesn't list them yet, and applying
            // it would evict a tile the user just watched arrive. The local
            // record fills that gap — and retires the moment the server
            // confirms the app (it is in `seen` already) or the user
            // uninstalls it again (removedNames).
            if ( this._pendingInstalls ) {
                for ( const [name, app] of [...this._pendingInstalls] ) {
                    if ( seen.has(name) || removedNames.has(name) ) {
                        this._pendingInstalls.delete(name);
                        continue;
                    }
                    seen.add(name);
                    merged.push({ ...app });
                }
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
            const groups = parseAppGroups(groupsRaw);

            // Skip only if a strictly newer load already applied its result.
            if ( loadSeq < (this._appliedSeq || 0) ) return;
            // A drag began while we were awaiting: rendering now would yank
            // the grid out from under it, but the data must not be thrown
            // away either — stash it for _endDrag to apply.
            if ( this._drag?.started ) {
                if ( ! this._pendingLoad || loadSeq > this._pendingLoad.loadSeq ) {
                    this._pendingLoad = { $el_window, merged, orderedNames, groups, loadSeq };
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
            this._groups = this._resolveGroups(loadSeq, groups);

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
        // A folder is modal over THIS tab's grid, and the dashboard only hides
        // an inactive section — it never tells a tab it was left. So one open
        // when the user walked off to Files is still open, mid-browse, when
        // they come back, with focusSearch about to drop the caret in the
        // search box behind its scrim: typing would then filter a grid the
        // folder is covering. Coming back to the tab is coming back to the
        // grid.
        this._closeGroup($el_window, { instant: true });
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

    // A deep-link landing on an app the dashboard doesn't list: opening is
    // what installs it (the launch grants the permission installedApps
    // reports), so the grid says so NOW rather than on some later refresh —
    // without this the user's first Back found no tile to minimize into and
    // a grid without the app they were just using. The app joins _apps at
    // the tail (where reconcileAppOrder appends new apps) with a tile drawn
    // from the landing's own app-info prefetch, so only a confirmed-real
    // app ever materializes, with its real icon. `mark` parks the tile
    // invisible (.myapps-tile-installing) for the intro's arrival beat to
    // reveal; unmarked (no-intro paths) it simply appears. The
    // _pendingInstalls record shields the tile from refreshes fetched
    // before the grant lands (see _fetchAndRenderApps). The order is NOT
    // saved: a default-position append must not freeze a custom order the
    // user never made. Resolves true when the app is on the grid (or
    // already was), false when there is nothing to add.
    async _spliceDeepLinkApp ($el_window, appName, appInfoPromise, { mark = false, boundedSleep = null } = {}) {
        if ( ! appInfoPromise ) return false;
        let info = null;
        try {
            info = boundedSleep
                ? await Promise.race([appInfoPromise, boundedSleep()])
                : await appInfoPromise;
        } catch ( _e ) { /* a failed prefetch: nothing real to add */ }
        if ( ! info || ! info.name || info.name !== appName ) return false;
        if ( ! Array.isArray(this._apps) ) return false;
        if ( this._apps.some(a => a.name === appName) ) return true; // a refresh beat us to it

        const app = {
            name: info.name,
            title: info.title || info.name,
            uid: info.uuid || info.uid || null,
            index_url: info.index_url || null,
            external: false,
            iconUrl: info.icon || null,
        };
        if ( ! this._pendingInstalls ) this._pendingInstalls = new Map();
        this._pendingInstalls.set(appName, app);
        // A previously uninstalled app is being re-installed by this
        // landing; the removed record must not go on filtering it.
        this._setAppRemoved(appName, false);
        this._apps.push(app);
        if ( mark ) this._arriving = { name: appName, $el_window };
        // instant only when the pager is already on screen: this re-render
        // must not blink a revealed grid back through the load fade, nor
        // skip the fade of one still arriving.
        const revealed = $el_window.find('.myapps-pager').length > 0
            && $el_window.find('.myapps-pager-loading').length === 0;
        this.renderApps($el_window, { preservePage: true, instant: revealed });
        return true;
    },

    // Reveal the tile a deep-link install parked invisible (see
    // _spliceDeepLinkApp). Animated only from the intro's arrival beat;
    // instant from every other path — interruption, hidden tab, and
    // settleDeepLinkLaunch's safety net — because the parked state must
    // never outlive the intro: an invisible tile is a broken grid.
    _revealArrivingTile (animate) {
        const arriving = this._arriving;
        if ( ! arriving ) return;
        this._arriving = null;
        const el = arriving.$el_window.find('.myapps-page .myapps-tile').toArray()
            .find(t => t.dataset.appName === arriving.name);
        if ( ! el ) return;
        if ( animate && ! this._reduceMotion() ) {
            // The installation (see .myapps-tile-install-arriving): the
            // slot opens with the icon dim inside it, a progress stroke
            // draws clockwise around the slot, and on completion the icon
            // springs to full color while the label names it. Each piece
            // is a backwards-filled keyframe, so the class swap never
            // flashes the resting tile. The progress ring is a transient
            // element rather than a pseudo — the tile's ::before is the
            // folder well and its ::after the running dot. Everything is
            // torn down just after the run; a re-render replacing the node
            // mid-run simply shows the resting tile (the detached nodes are
            // cleaned up regardless).
            el.classList.add('myapps-tile-install-arriving');
            el.classList.remove('myapps-tile-installing');
            const ring = document.createElement('div');
            ring.className = 'myapps-install-progress';
            ring.innerHTML = '<svg viewBox="0 0 68 68" aria-hidden="true">'
                + '<rect x="1.5" y="1.5" width="65" height="65" rx="17" pathLength="100"/></svg>';
            el.appendChild(ring);
            setTimeout(() => {
                el.classList.remove('myapps-tile-install-arriving');
                ring.remove();
            }, DEEP_LINK_INSTALL_ARRIVE_MS + 80);
        } else {
            el.classList.remove('myapps-tile-installing');
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
    async beginDeepLinkLaunch (appName, $el_window, appInfoPromise = null) {
        this._launchingApps.add(appName);
        // No animations, no intro: the morph and the flourish would both
        // no-op, so waiting on the grid would only delay the launch. The
        // landing still installs the app, though — give it its tile
        // silently once the grid is up (fire-and-forget: nothing here may
        // hold the launch, and a failure just means the tile waits for the
        // next refresh, as it always did).
        if ( ! window.animate_window_opening || this._reduceMotion() ) {
            Promise.resolve(this.loadApps($el_window))
                .then(() => this._spliceDeepLinkApp($el_window, appName, appInfoPromise))
                .catch(() => {});
            return null;
        }
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
            if ( ! Array.isArray(this._apps) ) return null;
            if ( ! this._apps.some(a => a.name === appName) ) {
                // Not on the dashboard: this landing is what installs it.
                // Materialize its tile (parked invisible for the arrival
                // beat below), bounded by the same deadline as the rest of
                // the intro — the prefetch has been in flight since the
                // landing, so it is normally long resolved.
                const spliced = await this._spliceDeepLinkApp($el_window, appName, appInfoPromise, {
                    mark: true,
                    boundedSleep: () => sleep(Math.max(0, deadline - Date.now())),
                });
                if ( ! spliced ) {
                    // The wait ran out (deadline, or input woke it) with the
                    // prefetch still pending: the intro moves on, but the
                    // data half must not be lost — add the tile plainly
                    // whenever the info lands (a rejected/absent app still
                    // adds nothing).
                    this._spliceDeepLinkApp($el_window, appName, appInfoPromise).catch(() => {});
                    return null;
                }
                // Interrupted while splicing: no intro, but the tile stays —
                // settleDeepLinkLaunch's reveal uncovers it.
                if ( interrupted ) return null;
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
                // visible tile to introduce from. An app inside a folder has
                // no tile of its own — the folder's tile stands in, and the
                // wayfinding below opens it.
                const tiles = $el_window.find('.dashboard-section-apps.active .myapps-tile').toArray();
                const candidate = tiles.find(el => el.dataset.appName === appName)
                    || tiles.find(el => el.dataset.groupId && parseTileGroupApps(el).includes(appName));
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
            // This landing installed the app: its tile ARRIVES now — after
            // the travel, so the user watches it materialize where it will
            // live — and only then does the launch grow out of it. Unlike
            // the beats this never decays: it is per-app news, delivered at
            // most once per app, ever.
            if ( this._arriving && this._arriving.name === appName ) {
                this._revealArrivingTile(true);
                await sleep(DEEP_LINK_INSTALL_ARRIVE_MS + DEEP_LINK_INSTALL_REST_MS);
                if ( interrupted || document.visibilityState === 'hidden' ) return tile;
            }
            // The app lives in a folder: open it, so the launch grows out of
            // the icon where the app actually is — and the user learns where
            // to find it again. settleDeepLinkLaunch shuts it afterwards.
            if ( tile.dataset.groupId ) {
                this._openGroup($el_window, tile.dataset.groupId, tile);
                this._deepLinkFolder = $el_window;
                await sleep(GROUP_PANEL_OPEN_MS);
                const inFolder = $el_window.find('.myapps-group-panel-grid .myapps-tile').toArray()
                    .find(el => el.dataset.appName === appName);
                // A folder that refused to open (its apps went missing under
                // us) leaves the folder's own tile as the morph's anchor.
                if ( inFolder ) {
                    tile = inFolder;
                    // The app may live on a later folder page — travel there
                    // visibly, same as the grid's own wayfinding flip, so the
                    // morph grows out of a tile the user can actually see.
                    const inPage = $el_window.find('.myapps-group-page')
                        .index($(inFolder).closest('.myapps-group-page'));
                    if ( inPage >= 0 && inPage !== this._groupPage ) {
                        this._goToGroupPage($el_window, inPage, true);
                        await sleep(DEEP_LINK_INTRO_FLIP_SETTLE_MS);
                    }
                }
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
        // Whatever path the intro took out (interruption, hidden tab, the
        // deadline), an unrevealed arrival must not outlive it — an
        // invisible tile is a broken grid. The intro's own reveal already
        // cleared this on the happy path.
        this._revealArrivingTile(false);
        // A folder the intro opened to show where the app lives has done its
        // job once the window is up (or the launch has failed).
        if ( this._deepLinkFolder ) {
            this._closeGroup(this._deepLinkFolder);
            this._deepLinkFolder = null;
        }
    },
};

export default TabApps;
