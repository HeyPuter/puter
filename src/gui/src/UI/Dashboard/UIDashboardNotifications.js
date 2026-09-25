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

import UINotification from '../UINotification.js';
import { reveal_dashboard } from '../UIWindow.js';
import { listNotifications, markNotificationAcknowledged } from '../../helpers/notificationApi.js';
import { applyToastMark, createNotificationFeed } from '../../helpers/notificationFeed.js';
import {
    badgeLabel,
    formatAbsoluteTime,
    formatRelativeTime,
    glyphKey,
    isUnread,
    mergeEntries,
    notificationTarget,
    planBurstToasts,
    reconcileWithServer,
    setReadAt,
    titleWithBadge,
    toEntry,
    unreadCount,
} from './notificationCenter.js';

const { html_encode } = window;

/** How long a toast stays up on its own; the panel keeps what it announced. */
const TOAST_TIMEOUT_MS = 8_000;

/** How often the "5 minutes ago" labels are brought up to date while open. */
const RELATIVE_TIME_TICK_MS = 60_000;

/** Below this the panel is a bottom sheet; matches the sidebar's drawer breakpoint. */
const SHEET_BREAKPOINT = '(max-width: 768px)';

/** Acknowledgements in flight at once when marking the whole list read. */
const ACK_CONCURRENCY = 6;

/** How many of the most recent notifications the panel lists, read or not. */
const HISTORY_LIMIT = 30;

/** Matches the panel's CSS transition; `hidden` is set once it has run. */
const CLOSE_ANIMATION_MS = 180;

/** The anchored panel's height at most, and the least it shrinks to. */
const PANEL_MAX_HEIGHT = 560;
const PANEL_MIN_HEIGHT = 200;

const STROKE_ICON = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const bellIcon = `<svg ${STROKE_ICON}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const closeIcon = `<svg ${STROKE_ICON} stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const checkIcon = `<svg ${STROKE_ICON} stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>`;
const checkAllIcon = `<svg ${STROKE_ICON} stroke-width="2"><path d="M2 13l4 4L14 7"/><path d="M12 17l10-10"/></svg>`;

/** The glyph in front of an entry, by who sent it. */
const GLYPHS = {
    sharing: `<svg ${STROKE_ICON}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`,
    default: bellIcon,
};

const glyphFor = (notification) => GLYPHS[glyphKey(notification)];

/** The same glyph as an image source, for toasts. */
const toastIconFor = (notification) => {
    const iconName = notification?.icon;
    const named = typeof iconName === 'string' && Object.hasOwn(window.icons ?? {}, iconName)
        ? window.icons[iconName]
        : null;
    if ( named ) return named;
    const color = glyphKey(notification) === 'sharing' ? '#2563eb' : '#64748b';
    // Loaded as an image rather than inlined, the SVG needs its namespace.
    const svg = glyphFor(notification)
        .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
        .replace('stroke="currentColor"', `stroke="${color}"`);
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/** A share notification's second line: the item it names, if only one. */
const textFor = (notification) => {
    if ( typeof notification?.text === 'string' && notification.text ) return notification.text;
    const name = notification?.fields?.target?.name;
    return typeof name === 'string' ? name : '';
};

const titleFor = (notification) => (
    typeof notification?.title === 'string' && notification.title
        ? notification.title
        : i18n('notification', [], false)
);

/**
 * Wait for the Files tab to finish a render already in flight —
 * `renderDirectory` drops calls made while one is running rather than
 * queueing them.
 */
const whenFilesIdle = async (filesTab, timeoutMs = 4_000) => {
    const started = Date.now();
    while ( filesTab.renderingDirectory && Date.now() - started < timeoutMs ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
};

/**
 * Run `task` over `items`, at most `limit` at a time. Resolves to the items
 * whose task rejected.
 */
const runLimited = async (items, limit, task) => {
    const failed = [];
    let index = 0;
    const worker = async () => {
        while ( index < items.length ) {
            const item = items[index++];
            try {
                await task(item);
            } catch {
                failed.push(item);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return failed;
};

/**
 * The dashboard's notification center: a bell in the sidebar with the unread
 * count, a panel listing the most recent notifications read or not, and
 * toasts for what arrives while the dashboard is open. The list is what the
 * server holds — it survives a reload, unlike the desktop's toasts — with
 * socket pushes folded in as they come.
 *
 * Reading one (its check, or acting on it) acknowledges it on the server,
 * which also marks it read in every other open tab; it stays listed, just
 * quieter. A toast timing out does not, so nothing is lost while someone is
 * looking away.
 *
 * @param {{ $el_window: JQuery, socket: import('socket.io-client').Socket }} opts
 * @returns {{ open: () => void, close: (opts?: { restoreFocus?: boolean }) => void, refresh: () => Promise<void>, isOpen: () => boolean }}
 */
export default function UIDashboardNotifications ({ $el_window, socket }) {
    /** @type {import('./notificationCenter.js').NotificationEntry[]} */
    let entries = [];
    let loaded = false;
    let loading = null;
    let loadFailed = false;
    let isOpen = false;
    let closeTimer = null;
    let tickTimer = null;
    let statusTimer = null;
    let previousFocus = null;
    const justAdded = new Set();
    /**
     * Entries the user has actually been shown — toasted, or listed while the
     * panel was open. The list itself fills from the server on load, before
     * the socket's `notif.unreads` for the same items arrives; only this
     * decides whether an arrival still deserves a toast.
     */
    const surfaced = new Set();
    /**
     * Acknowledgements a listing in flight can't know about — its snapshot
     * was taken when it was requested. Keyed by uid; the value is when the
     * ack finished, `Infinity` while it is still out.
     */
    const acked = new Map();
    let listingRequestedAt = 0;

    const sheetMedia = window.matchMedia(SHEET_BREAKPOINT);
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // -- Markup -------------------------------------------------------------

    const $trigger = $(`
        <button type="button" class="dashboard-sidebar-item dashboard-notifications-btn allow-native-ctxmenu"
            aria-haspopup="dialog" aria-expanded="false" aria-controls="dashboard-notifications-panel"
            data-tooltip="${i18n('notifications')}">
            <span class="dashboard-notifications-btn-icon">${bellIcon}<span class="dashboard-notifications-dot" aria-hidden="true"></span></span>
            <span class="dashboard-notifications-btn-label">${i18n('notifications')}</span>
            <span class="dashboard-notifications-badge" aria-hidden="true"></span>
        </button>
    `);
    $el_window.find('.dashboard-user-options').prepend($trigger);

    const $scrim = $('<div class="dashboard-notifications-scrim" hidden></div>');
    const $panel = $(`
        <div id="dashboard-notifications-panel" class="dashboard-notifications-panel" role="dialog"
            aria-label="${i18n('notifications')}" tabindex="-1" hidden>
            <div class="dashboard-notifications-grip" aria-hidden="true"></div>
            <div class="dashboard-notifications-header">
                <div class="dashboard-notifications-heading">
                    <h2>${i18n('notifications')}</h2>
                    <span class="dashboard-notifications-count" aria-hidden="true"></span>
                </div>
                <div class="dashboard-notifications-actions">
                    <button type="button" class="dashboard-notifications-mark-all" hidden>${checkAllIcon}<span>${i18n('notifications_mark_all_read')}</span></button>
                    <button type="button" class="dashboard-notifications-close" aria-label="${i18n('close')}" title="${i18n('close')}">${closeIcon}</button>
                </div>
            </div>
            <div class="dashboard-notifications-status" role="status" aria-live="polite"></div>
            <div class="dashboard-notifications-body">
                <ul class="dashboard-notifications-list" role="list"></ul>
                <div class="dashboard-notifications-loading" aria-hidden="true">
                    ${'<div class="dashboard-notifications-skeleton"><span></span><span><i></i><i></i></span></div>'.repeat(3)}
                </div>
                <div class="dashboard-notifications-empty" hidden>
                    <div class="dashboard-notifications-empty-art">${bellIcon}</div>
                    <p class="dashboard-notifications-empty-title">${i18n('notifications_empty_title')}</p>
                </div>
                <div class="dashboard-notifications-error" hidden>
                    <p>${i18n('notifications_load_failed')}</p>
                    <button type="button" class="dashboard-notifications-retry">${i18n('retry')}</button>
                </div>
            </div>
        </div>
    `);
    // Announces arrivals to assistive tech; the toast itself is visual only
    // and the panel is hidden (so silent) until opened.
    const $live = $('<div class="dashboard-notifications-live" role="status" aria-live="polite"></div>');
    // Inside the dashboard window, like its other overlays: on phones every
    // window is stacked above anything at body level, and the window is
    // full-page so viewport-fixed placement still lands where intended.
    $el_window.append($scrim, $panel, $live);

    const $list = $panel.find('.dashboard-notifications-list');
    const $count = $panel.find('.dashboard-notifications-count');
    const $markAll = $panel.find('.dashboard-notifications-mark-all');
    const $status = $panel.find('.dashboard-notifications-status');
    const $badge = $trigger.find('.dashboard-notifications-badge');
    const $sidebarToggle = $el_window.find('.dashboard-sidebar-toggle');

    // -- Rendering ----------------------------------------------------------

    const setStatus = (text) => {
        clearTimeout(statusTimer);
        $status.text(text).toggleClass('visible', Boolean(text));
        if ( text ) statusTimer = setTimeout(() => setStatus(''), 6_000);
    };

    const rowHtml = (entry) => {
        const { notification } = entry;
        // A closed set, so it needs no sanitising on the way into the class.
        const glyph = glyphKey(notification);
        const text = textFor(notification);
        const time = entry.createdAt === null ? '' : `
            <time class="dashboard-notification-time" datetime="${new Date(entry.createdAt).toISOString()}"
                title="${html_encode(formatAbsoluteTime(entry.createdAt, window.locale))}">${html_encode(formatRelativeTime(entry.createdAt, Date.now(), window.locale))}</time>`;
        const title = titleFor(notification);
        const unread = isUnread(entry);
        // Only an entry with somewhere to go is a control; the rest is text,
        // with the check to mark it read as its one action while unread.
        const actionable = notificationTarget(notification) !== null;
        const mainTag = actionable ? 'button type="button"' : 'div';
        const classes = [
            'dashboard-notification',
            unread ? 'is-unread' : '',
            justAdded.has(entry.uid) ? 'dashboard-notification-new' : '',
        ].filter(Boolean).join(' ');
        return `
            <li class="${classes}" data-uid="${html_encode(entry.uid)}">
                <${mainTag} class="dashboard-notification-main${actionable ? ' is-actionable' : ''}">
                    <span class="dashboard-notification-icon dashboard-notification-icon-${glyph}">${glyphFor(notification)}<span class="dashboard-notification-unread-dot" aria-hidden="true"></span></span>
                    <span class="dashboard-notification-content">
                        <span class="dashboard-notification-title">${unread ? `<span class="dashboard-notification-sr">${i18n('notification_unread')}: </span>` : ''}${html_encode(title)}</span>
                        ${text ? `<span class="dashboard-notification-text">${html_encode(text)}</span>` : ''}
                        ${time}
                    </span>
                </${actionable ? 'button' : 'div'}>
                ${unread ? `<button type="button" class="dashboard-notification-read"
                    aria-label="${i18n('notification_mark_read_named', { title })}" title="${i18n('notification_mark_read')}">${checkIcon}</button>` : ''}
            </li>`;
    };

    /**
     * Where the keyboard is in the list, so a re-render — which rebuilds
     * every row — can put it back: on the same entry, or if that one is
     * gone, on the entry that took its place. A check that was just pressed
     * is gone with the unread state; the row's own control, or the panel,
     * takes the focus instead.
     */
    const focusedRow = () => {
        const active = document.activeElement;
        const row = active && $list[0].contains(active) ? active.closest('.dashboard-notification') : null;
        if ( ! row ) return null;
        return {
            uid: row.getAttribute('data-uid'),
            index: $list.children().index(row),
            read: active.classList.contains('dashboard-notification-read'),
        };
    };

    const rowControl = (row, read) => (
        (read ? row.querySelector('.dashboard-notification-read') : null)
        ?? row.querySelector('button')
    );

    const restoreFocus = (was) => {
        if ( ! was ) return;
        const rows = $list.children().get();
        const same = rows.find((row) => row.getAttribute('data-uid') === was.uid);
        const row = same ?? rows[Math.min(was.index, rows.length - 1)];
        const target = (row && rowControl(row, was.read)) ?? $panel[0];
        target.focus({ preventScroll: true });
    };

    const render = () => {
        const count = unreadCount(entries);
        const label = badgeLabel(count);

        $badge.text(label).attr('hidden', label ? null : '');
        $trigger.toggleClass('has-unread', count > 0);
        $trigger.attr('aria-label', count > 0
            ? `${i18n('notifications', [], false)}, ${i18n('notifications_unread_count', { count }, false)}`
            : i18n('notifications', [], false));
        $sidebarToggle.toggleClass('has-unread', count > 0);
        $count.text(label);
        $markAll.attr('hidden', count > 0 ? null : '');
        document.title = titleWithBadge(document.title, count);

        const showLoading = ! loaded && loading !== null;
        const showError = ! loaded && loadFailed && loading === null;
        $panel.find('.dashboard-notifications-loading').attr('hidden', showLoading ? null : '');
        $panel.find('.dashboard-notifications-error').attr('hidden', showError ? null : '');
        $panel.find('.dashboard-notifications-empty').attr('hidden', loaded && entries.length === 0 ? null : '');
        $panel.attr('aria-busy', showLoading ? 'true' : null);

        const was = isOpen ? focusedRow() : null;
        $list.html(entries.map(rowHtml).join(''));
        restoreFocus(was);
        justAdded.clear();
        if ( isOpen ) for ( const entry of entries ) surfaced.add(entry.uid);
    };

    const refreshTimes = () => {
        const now = Date.now();
        $list.find('time').each(function () {
            const at = Date.parse(this.getAttribute('datetime'));
            if ( Number.isFinite(at) ) this.textContent = formatRelativeTime(at, now, window.locale);
        });
    };

    // -- Data ---------------------------------------------------------------

    /** Pull the server's list and fold it over what this tab knows. */
    const refresh = () => {
        if ( loading ) return loading;
        loadFailed = false;
        if ( ! loaded ) render();
        listingRequestedAt = Date.now();
        loading = listNotifications({ predicate: 'all', limit: HISTORY_LIMIT })
            .then((rows) => {
                const now = Date.now();
                const server = rows.map((row) => toEntry(row, now)).filter(Boolean);
                // Acked since this listing was requested: unread in its snapshot.
                // Anything acked before it is settled and can be forgotten.
                const readSince = new Set();
                for ( const [uid, at] of acked ) {
                    if ( at >= listingRequestedAt ) readSince.add(uid);
                    else acked.delete(uid);
                }
                entries = reconcileWithServer(entries, server, now, undefined, readSince);
                loaded = true;
            })
            .catch((err) => {
                console.warn('Could not load notifications:', err);
                loadFailed = true;
                if ( loaded ) setStatus(i18n('notifications_load_failed', [], false));
            })
            .finally(() => {
                loading = null;
                render();
            });
        return loading;
    };

    /** Record the server's copy of `uid` as read; resolves once it is. */
    const acknowledge = async (uid) => {
        acked.set(uid, Infinity);
        try {
            await markNotificationAcknowledged(uid);
            acked.set(uid, Date.now());
        } catch (err) {
            acked.delete(uid);
            throw err;
        }
    };

    /** Show an entry as read now and tell the server; revert if that fails. */
    const markRead = async (uid) => {
        const entry = entries.find((e) => e.uid === uid);
        if ( ! entry || ! isUnread(entry) ) return;
        entries = setReadAt(entries, uid, Date.now());
        render();
        try {
            await acknowledge(uid);
        } catch (err) {
            console.warn('Could not acknowledge notification:', err);
            entries = setReadAt(entries, uid, null);
            render();
            setStatus(i18n('notifications_mark_read_failed', [], false));
        }
    };

    const markAllRead = async () => {
        const unread = entries.filter(isUnread);
        if ( unread.length === 0 ) return;
        const now = Date.now();
        entries = entries.map((entry) => (isUnread(entry) ? { ...entry, readAt: now } : entry));
        render();
        const failed = await runLimited(unread, ACK_CONCURRENCY, (entry) => acknowledge(entry.uid));
        if ( failed.length > 0 ) {
            setStatus(i18n('notifications_mark_all_failed', [], false));
            await refresh();
        }
    };

    // -- Acting on an entry -------------------------------------------------

    /** Show the Files tab on Shared, picking out `paths` if they are there. */
    const goToShared = async (paths) => {
        $el_window.find('.dashboard-sidebar-item[data-section="files"]').trigger('click');
        const filesTab = window.dashboard_object;
        if ( ! filesTab?.renderDirectory ) return;
        await whenFilesIdle(filesTab);
        filesTab.pushNavHistory?.(window.shared_path);
        await filesTab.renderDirectory(window.shared_path, { consistency: 'strong' });
        if ( paths?.length ) filesTab.selectSharedRows?.(paths);
    };

    const actOn = (entry) => {
        const target = notificationTarget(entry.notification);
        close({ restoreFocus: false });
        // Acknowledged first: what the click leads to may take a moment, and
        // the entry should read as seen by the time it lands.
        void markRead(entry.uid);
        if ( target?.kind === 'shared-item' ) {
            void goToShared([target.path]);
        } else if ( target?.kind === 'shared' ) {
            void goToShared([]);
        }
    };

    // -- Toasts -------------------------------------------------------------

    // A toast is the one control that reaches the user while an app window
    // covers the dashboard; what it leads to happens on the dashboard, so
    // that has to come back into view first.
    const toast = (entry, { replay = false } = {}) => {
        const { notification } = entry;
        UINotification({
            uid: entry.uid,
            title: titleFor(notification),
            text: textFor(notification),
            icon: toastIconFor(notification),
            value: notification,
            timeout: TOAST_TIMEOUT_MS,
            click: () => void reveal_dashboard().then(() => actOn(entry)),
            // The ✕ is a dismissal; timing out is not, so `close` alone acks.
            close: () => void markRead(entry.uid),
        });
        // Shown is not dismissed: the events path can say so, and a replay
        // already claimed it on the way in.
        if ( ! replay ) {
            void applyToastMark('shown', entry.uid, { eventsPath: feed.isActive() });
        }
    };

    const toastSummary = (count) => {
        UINotification({
            title: i18n('notifications_new_count', { count }, false),
            text: i18n('notifications_open_hint', [], false),
            icon: toastIconFor({}),
            timeout: TOAST_TIMEOUT_MS,
            click: () => void reveal_dashboard().then(() => open()),
        });
    };

    const announce = (added) => {
        if ( added.length === 0 ) return;
        const text = added.length === 1
            ? `${i18n('new_notification', [], false)}: ${titleFor(added[0].notification)}`
            : i18n('notifications_new_count', { count: added.length }, false);
        // Clear first so the same text twice is still read out.
        $live.text('');
        setTimeout(() => $live.text(text), 50);
    };

    /**
     * Fold arrivals in. While the panel is open they simply appear in it;
     * closed, each gets a toast — a large burst a summary instead.
     */
    const receive = (rawItems, { replay = false } = {}) => {
        const now = Date.now();
        const incoming = rawItems.map((raw) => toEntry(raw, now)).filter(Boolean);
        const result = mergeEntries(entries, incoming);
        entries = result.entries;

        // A regrouped notification refreshes the toast already on screen.
        for ( const entry of incoming ) {
            const $showing = $(`.notification[data-uid="${html_encode(entry.uid)}"]`);
            if ( ! $showing.length ) continue;
            $showing.find('.notification-title').text(titleFor(entry.notification));
            $showing.find('.notification-text').text(textFor(entry.notification));
        }

        const fresh = incoming.filter((entry) => ! surfaced.has(entry.uid));
        for ( const entry of fresh ) surfaced.add(entry.uid);
        for ( const entry of result.added ) justAdded.add(entry.uid);
        render();
        announce(fresh);

        // Open, the panel is already showing them.
        if ( isOpen ) return;
        const { shown, folded } = planBurstToasts(fresh);
        for ( const entry of [...shown].reverse() ) toast(entry, { replay });
        if ( folded > 0 ) toastSummary(folded);
    };

    // -- Panel ----------------------------------------------------------------

    const position = () => {
        if ( sheetMedia.matches ) {
            $panel.css({ left: '', bottom: '', right: '', maxHeight: '' });
            return;
        }
        const rect = $trigger[0].getBoundingClientRect();
        const width = $panel.outerWidth() || 380;
        const gap = 10;
        let left = rect.right + gap;
        if ( left + width > window.innerWidth - gap ) left = Math.max(gap, window.innerWidth - width - gap);
        // Bottom-aligned with the bell, growing upward — and no taller than
        // the room above it, so a short window scrolls the list rather than
        // pushing the header off the top.
        const bottom = Math.max(gap, window.innerHeight - rect.bottom);
        const maxHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, window.innerHeight - bottom - gap));
        $panel.css({ left: `${left}px`, bottom: `${bottom}px`, right: '', maxHeight: `${maxHeight}px` });
    };

    const focusables = () => $panel.find('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        .filter(':visible').filter(function () {
            return ! this.hasAttribute('hidden') && ! this.disabled;
        });

    const open = () => {
        if ( isOpen ) return;
        isOpen = true;
        clearTimeout(closeTimer);
        previousFocus = document.activeElement;

        // The bell lives in the mobile drawer; the sheet replaces it.
        if ( sheetMedia.matches ) $el_window.find('.dashboard-sidebar-close').trigger('click');

        $panel.attr('hidden', null);
        $scrim.attr('hidden', null);
        position();
        // Two frames: one for `hidden` to lift, one for the transition to
        // have a starting state to leave.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            $panel.addClass('open');
            $scrim.addClass('open');
        }));
        $trigger.attr('aria-expanded', 'true').addClass('has-open-panel');
        // The collapsed sidebar's hover tooltip would sit on the panel's corner.
        $('.dashboard-sidebar-tooltip').removeClass('visible');
        $panel[0].focus({ preventScroll: true });

        // What's listed is shown at once; the server's copy is pulled behind
        // it, since a notification can be rewritten without a push (a share
        // folded in past the sender's interruption budget).
        void refresh();
        refreshTimes();
        tickTimer = setInterval(refreshTimes, RELATIVE_TIME_TICK_MS);

        $(window).on('resize.dashboard-notifications', position);
        $(document).on('pointerdown.dashboard-notifications', (e) => {
            if ( $(e.target).closest('.dashboard-notifications-panel, .dashboard-notifications-btn').length ) return;
            close({ restoreFocus: false });
        });
        $(document).on('keydown.dashboard-notifications', (e) => {
            if ( e.key === 'Escape' ) {
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
            }
            // Tab cycles within the panel while it is up. Focus resting on
            // the panel itself (just opened, or after the last entry went)
            // counts as the start, so Shift+Tab wraps rather than leaving.
            if ( e.key === 'Tab' ) {
                const $items = focusables();
                if ( $items.length === 0 ) return;
                const first = $items[0], last = $items[$items.length - 1];
                const active = document.activeElement;
                const inside = $panel[0].contains(active);
                const atStart = active === first || active === $panel[0];
                if ( ! inside || (e.shiftKey && atStart) || (! e.shiftKey && active === last) ) {
                    e.preventDefault();
                    (e.shiftKey ? last : first).focus();
                }
            }
        });
    };

    const close = ({ restoreFocus = true } = {}) => {
        if ( ! isOpen ) return;
        isOpen = false;
        $panel.removeClass('open');
        $scrim.removeClass('open');
        $trigger.attr('aria-expanded', 'false').removeClass('has-open-panel');
        clearInterval(tickTimer);
        $(window).off('resize.dashboard-notifications');
        $(document).off('pointerdown.dashboard-notifications keydown.dashboard-notifications');
        closeTimer = setTimeout(() => {
            $panel.attr('hidden', '');
            $scrim.attr('hidden', '');
        }, reducedMotion() ? 0 : CLOSE_ANIMATION_MS);
        if ( restoreFocus ) {
            const target = previousFocus && document.contains(previousFocus) ? previousFocus : $trigger[0];
            try {
                target.focus({ preventScroll: true });
            } catch { /* best effort */ }
        }
        previousFocus = null;
    };

    // -- Wiring ---------------------------------------------------------------

    $trigger.on('click', () => (isOpen ? close() : open()));
    $panel.on('click', '.dashboard-notifications-close', () => close());
    $scrim.on('click', () => close({ restoreFocus: false }));
    $panel.on('click', '.dashboard-notifications-mark-all', () => void markAllRead());
    $panel.on('click', '.dashboard-notifications-retry', () => void refresh());
    $panel.on('click', '.dashboard-notification-read', function (e) {
        e.stopPropagation();
        void markRead($(this).closest('.dashboard-notification').attr('data-uid'));
    });
    $panel.on('click', '.dashboard-notification-main.is-actionable', function () {
        const uid = $(this).closest('.dashboard-notification').attr('data-uid');
        const entry = entries.find((e) => e.uid === uid);
        if ( entry ) actOn(entry);
    });

    // Layout mode changed under an open panel: re-anchor, or drop the anchor.
    sheetMedia.addEventListener?.('change', () => {
        if ( isOpen ) position();
    });

    // An app window opening over the dashboard covers the panel; don't leave
    // it open underneath to be found again when the app closes.
    document.addEventListener('dashboard-app-windows-changed', () => {
        if ( isOpen ) close({ restoreFocus: false });
    });

    // The title is rewritten by app windows opening and closing over the
    // dashboard; keep the count in front of whatever it becomes. Setting the
    // same title again is a no-op, so this can't loop.
    const titleEl = document.querySelector('title');
    if ( titleEl ) {
        new MutationObserver(() => {
            const wanted = titleWithBadge(document.title, unreadCount(entries));
            if ( document.title !== wanted ) document.title = wanted;
        }).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    // -- Arrivals -----------------------------------------------------------------

    /**
     * Notifications over the events surface, where the server says it has
     * them. Arrivals fold in exactly as the socket's do; the listeners below
     * stand down only while it is up, so a lapse is a fallback rather than
     * silence.
     */
    const feed = createNotificationFeed({
        deliver: (items, { replay }) => receive(items, { replay }),
    });
    void feed.start();

    socket.on('notif.message', ({ uid, notification }) => {
        if ( feed.isActive() ) return;
        receive([{ uid, notification }]);
    });
    socket.on('notif.unreads', ({ unreads }) => {
        if ( feed.isActive() ) return;
        receive(Array.isArray(unreads) ? unreads : []);
    });
    // Not gated: an ack marks an entry read rather than adding one, so it
    // can't duplicate anything — and the events surface carries only
    // postings, which leaves this the one thing that syncs a dismissal
    // between open tabs.
    socket.on('notif.ack', ({ uid }) => {
        if ( ! uid ) return;
        $(`.notification[data-uid="${html_encode(uid)}"]`).closest('.notification-wrapper').remove();
        if ( ! entries.some((e) => e.uid === uid && isUnread(e)) ) return;
        // Read in another tab: a listing already in flight predates it too.
        const now = Date.now();
        acked.set(uid, now);
        entries = setReadAt(entries, uid, now);
        render();
    });
    // Every (re)connection: anything read elsewhere while this tab was
    // offline is marked so in the server's list, and anything new is in it.
    socket.on('connect', () => void refresh());
    // Coming back to the tab: same reasoning, cheaper than waiting to be told.
    document.addEventListener('visibilitychange', () => {
        if ( document.visibilityState === 'visible' && loaded ) void refresh();
    });

    render();
    void refresh();

    return { open, close, refresh, isOpen: () => isOpen };
}
