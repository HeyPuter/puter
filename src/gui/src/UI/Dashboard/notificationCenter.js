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

/**
 * The dashboard notification center's logic, kept free of the DOM: what the
 * list holds, how arrivals fold into it, what a click on an entry should do,
 * and how a moment is described. `UIDashboardNotifications` renders this.
 */

/**
 * @typedef {Object} NotificationPayload
 * @property {string} [type] - What it is, from the server's registry
 * @property {string} [source] - Legacy sender marker: `sharing`, `worker`, …
 * @property {string} [title]
 * @property {string} [text]
 * @property {string} [icon] - A `window.icons` key
 * @property {string} [template] - Legacy marker, superseded by `type`
 * @property {Object} [fields]
 */

/**
 * @typedef {Object} NotificationEntry
 * @property {string} uid
 * @property {NotificationPayload} notification
 * @property {number|null} createdAt - Epoch milliseconds, `null` when unknown
 * @property {number|null} readAt - When the user acknowledged it (epoch ms); `null` while unread
 * @property {number} receivedAt - When this client first saw it (epoch ms)
 */

/** Notifications announcing a share. */
const SHARE_TYPES = new Set(['share.received', 'share.claimed']);

/**
 * The `source` / `template` markers share and worker notifications carried
 * before the server sent a `type`. Kept so rows written by the previous
 * release still read correctly.
 */
const LEGACY_SHARE_TEMPLATES = new Set(['file-shared-with-you', 'file-shared-before-you-joined']);
const LEGACY_HIDDEN_SOURCES = new Set(['worker']);

/**
 * Notifications the center leaves out entirely — a worker's deploy
 * confirmations are noise next to things that need the user.
 */
const HIDDEN_TYPES = new Set(['app.worker.deployed', 'app.worker.deployFailed']);

/**
 * Whether a notification announces a share, by either the server's `type` or
 * the markers that preceded it.
 *
 * @param {NotificationPayload} notification
 * @returns {boolean}
 */
export const isShareNotification = (notification) => {
    if ( ! notification || typeof notification !== 'object' ) return false;
    return SHARE_TYPES.has(notification.type)
        || notification.source === 'sharing'
        || LEGACY_SHARE_TEMPLATES.has(notification.template);
};

// SQLite's CURRENT_TIMESTAMP: UTC with no zone marker, which `Date.parse`
// would otherwise read as local time.
const SQL_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Epoch milliseconds from however a row's `created_at` arrives — SQLite's
 * `YYYY-MM-DD HH:MM:SS`, a MySQL `Date` serialized to ISO, or epoch seconds
 * or milliseconds. `null` when it can't be read, so the UI shows no time
 * rather than a wrong one.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export const parseCreatedAt = (value) => {
    if ( value === null || value === undefined || value === '' ) return null;
    if ( typeof value === 'number' ) {
        if ( ! Number.isFinite(value) || value <= 0 ) return null;
        // Anything before 2001 in milliseconds is really seconds.
        return value < 1e11 ? value * 1000 : value;
    }
    if ( value instanceof Date ) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if ( typeof value !== 'string' ) return null;
    const text = value.trim();
    if ( /^\d+$/.test(text) ) return parseCreatedAt(Number(text));
    const ms = Date.parse(SQL_TIMESTAMP.test(text) ? `${text.replace(' ', 'T')}Z` : text);
    return Number.isFinite(ms) ? ms : null;
};

/**
 * One entry from whatever the server or the socket hands over: a driver row
 * (`{ uid, value, created_at, acknowledged }`) or a socket item (`{ uid,
 * notification, created_at? }`). A push carries no `acknowledged` and is
 * unread — the server only pushes what the user hasn't dismissed. `null`
 * for anything without a uid — there is nothing to acknowledge it by — and
 * for senders the center doesn't show.
 *
 * @param {Object} raw
 * @param {number} now - Epoch ms; stands in for `created_at` when absent
 * @returns {NotificationEntry|null}
 */
export const toEntry = (raw, now) => {
    const uid = raw?.uid;
    if ( typeof uid !== 'string' || uid === '' ) return null;
    const payload = raw.notification ?? raw.value;
    const notification = payload && typeof payload === 'object' ? payload : {};
    if ( HIDDEN_TYPES.has(notification.type) ) return null;
    if ( LEGACY_HIDDEN_SOURCES.has(notification.source) ) return null;
    const createdAt = parseCreatedAt(raw.created_at);
    return {
        uid,
        notification,
        // A push arrives before its row is written, so "now" is accurate for
        // it; a listed row always carries its own time.
        createdAt: createdAt ?? (raw.created_at === undefined ? now : null),
        readAt: parseCreatedAt(raw.acknowledged),
        receivedAt: now,
    };
};

/**
 * Newest first; entries without a time sort as newest (they are the ones
 * just pushed), ties keep their order.
 *
 * @param {NotificationEntry[]} entries
 * @returns {NotificationEntry[]}
 */
export const sortEntries = (entries) => entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
        const ta = a.entry.createdAt ?? Infinity;
        const tb = b.entry.createdAt ?? Infinity;
        if ( ta !== tb ) return tb - ta;
        return a.index - b.index;
    })
    .map(({ entry }) => entry);

/**
 * Fold arrivals into the list. A uid already present is rewritten in place
 * — the backend re-sends a notification under its own uid when what it says
 * has grown — keeping the time it was first seen, so a regrouped share
 * doesn't jump to the top as if new.
 *
 * @param {NotificationEntry[]} entries
 * @param {NotificationEntry[]} incoming
 * @returns {{ entries: NotificationEntry[], added: NotificationEntry[], updated: NotificationEntry[] }}
 */
export const mergeEntries = (entries, incoming) => {
    const byUid = new Map(entries.map((entry) => [entry.uid, { ...entry }]));
    const added = [];
    const updated = [];
    for ( const entry of incoming ) {
        if ( ! entry ) continue;
        const existing = byUid.get(entry.uid);
        if ( existing ) {
            existing.notification = entry.notification;
            if ( existing.createdAt === null && entry.createdAt !== null ) {
                existing.createdAt = entry.createdAt;
            }
            updated.push(existing);
        } else {
            byUid.set(entry.uid, entry);
            added.push(entry);
        }
    }
    return { entries: sortEntries([...byUid.values()]), added, updated };
};

/**
 * Replace the list with what the server holds, keeping anything this client
 * was pushed in the last `graceMs` that the server hasn't listed yet — a
 * push goes out before its row is written, and a listing racing it must not
 * make the toast's entry vanish. `readSince` names what was acknowledged
 * after the listing was requested; its snapshot predates those, so they
 * stay read rather than flipping back to unread.
 *
 * @param {NotificationEntry[]} local
 * @param {NotificationEntry[]} server
 * @param {number} now
 * @param {number} [graceMs]
 * @param {Set<string>} [readSince]
 * @returns {NotificationEntry[]}
 */
export const reconcileWithServer = (local, server, now, graceMs = 15_000, readSince = new Set()) => {
    const known = new Map(local.map((entry) => [entry.uid, entry]));
    const listed = server.map((entry) => (
        entry.readAt === null && readSince.has(entry.uid)
            ? { ...entry, readAt: known.get(entry.uid)?.readAt ?? now }
            : entry
    ));
    const listedUids = new Set(listed.map((entry) => entry.uid));
    const recent = local.filter((entry) => ! listedUids.has(entry.uid) && now - entry.receivedAt < graceMs);
    return sortEntries([...listed, ...recent]);
};

/**
 * The list with one entry's read state changed; `null` makes it unread
 * again, for rolling back an acknowledgement the server refused.
 *
 * @param {NotificationEntry[]} entries
 * @param {string} uid
 * @param {number|null} readAt
 * @returns {NotificationEntry[]}
 */
export const setReadAt = (entries, uid, readAt) => entries.map((entry) => (
    entry.uid === uid && entry.readAt !== readAt ? { ...entry, readAt } : entry
));

/** @param {NotificationEntry} entry */
export const isUnread = (entry) => entry.readAt === null;

/**
 * @param {NotificationEntry[]} entries
 * @returns {number}
 */
export const unreadCount = (entries) => entries.filter(isUnread).length;

/**
 * Which glyph an entry shows. Shares have one of their own; anything else
 * gets the bell.
 *
 * @param {NotificationPayload} notification
 * @returns {'sharing'|'default'}
 */
export const glyphKey = (notification) => (
    isShareNotification(notification) ? 'sharing' : 'default'
);

/**
 * @typedef {{ kind: 'shared-item', path: string } | { kind: 'shared' } | null} NotificationTarget
 */

/**
 * Where a click on a notification should go. A share naming one item points
 * at it; a grouped share, or one claimed after signing up, points at Shared
 * where they all landed. Anything else has nowhere to go and just clears.
 *
 * @param {NotificationPayload} notification
 * @returns {NotificationTarget}
 */
export const notificationTarget = (notification) => {
    if ( ! isShareNotification(notification) ) return null;
    const path = notification.fields?.target?.path;
    if ( typeof path === 'string' && path.startsWith('/') ) {
        return { kind: 'shared-item', path };
    }
    return { kind: 'shared' };
};

/** What the badge shows for a count: nothing, the number, or a cap. */
export const badgeLabel = (count) => {
    if ( ! Number.isFinite(count) || count <= 0 ) return '';
    return count > 99 ? '99+' : String(count);
};

const TITLE_BADGE = /^\((\d+\+?)\) /;

/**
 * The document title with the unread count in front, replacing any count
 * already there so repeated application never stacks prefixes.
 *
 * @param {string} title
 * @param {number} count
 * @returns {string}
 */
export const titleWithBadge = (title, count) => {
    const base = String(title ?? '').replace(TITLE_BADGE, '');
    const label = badgeLabel(count);
    return label ? `(${label}) ${base}` : base;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, in the reader's language: "now", "5 minutes ago",
 * "yesterday", then a short date once it's more than a week old. Uses the
 * platform's formatters so nothing here needs translating; falls back to a
 * plain date where they're missing.
 *
 * @param {number} at - Epoch ms
 * @param {number} now - Epoch ms
 * @param {string} [locale]
 * @returns {string}
 */
export const formatRelativeTime = (at, now, locale = 'en') => {
    const diff = Math.max(0, now - at);
    const rtf = relativeFormatter(locale);
    if ( diff < 45_000 ) return rtf ? rtf.format(0, 'second') : 'now';
    if ( diff < 45 * MINUTE ) {
        const minutes = Math.max(1, Math.round(diff / MINUTE));
        return rtf ? rtf.format(-minutes, 'minute') : `${minutes}m`;
    }
    if ( diff < 22 * HOUR ) {
        const hours = Math.max(1, Math.round(diff / HOUR));
        return rtf ? rtf.format(-hours, 'hour') : `${hours}h`;
    }
    if ( diff < 7 * DAY ) {
        const days = Math.max(1, Math.round(diff / DAY));
        return rtf ? rtf.format(-days, 'day') : `${days}d`;
    }
    const then = new Date(at);
    const sameYear = then.getFullYear() === new Date(now).getFullYear();
    const dtf = dateFormatter(locale, {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
    });
    return dtf ? dtf.format(then) : then.toLocaleDateString();
};

/**
 * The full moment, for a tooltip behind the relative form.
 *
 * @param {number} at - Epoch ms
 * @param {string} [locale]
 * @returns {string}
 */
export const formatAbsoluteTime = (at, locale = 'en') => {
    const dtf = dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return dtf ? dtf.format(new Date(at)) : new Date(at).toLocaleString();
};

const tryMake = (make) => {
    try {
        return make();
    } catch {
        return null;
    }
};

// An unknown locale tag throws; the English formatter beats none at all.
const relativeFormatter = (locale) => {
    if ( typeof Intl === 'undefined' || ! Intl.RelativeTimeFormat ) return null;
    return tryMake(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }))
        ?? tryMake(() => new Intl.RelativeTimeFormat('en', { numeric: 'auto' }));
};

const dateFormatter = (locale, options) => {
    if ( typeof Intl === 'undefined' || ! Intl.DateTimeFormat ) return null;
    return tryMake(() => new Intl.DateTimeFormat(locale, options))
        ?? tryMake(() => new Intl.DateTimeFormat('en', options));
};

/**
 * How many toasts a burst may raise before the rest are folded into one
 * "N new notifications" summary — a reconnect after a busy day must not
 * cover the screen.
 */
export const MAX_BURST_TOASTS = 3;

/**
 * Split a burst into the entries that get their own toast and the number
 * that don't.
 *
 * @param {NotificationEntry[]} entries - Newest first
 * @param {number} [max]
 * @returns {{ shown: NotificationEntry[], folded: number }}
 */
export const planBurstToasts = (entries, max = MAX_BURST_TOASTS) => {
    if ( entries.length <= max ) return { shown: entries, folded: 0 };
    // One over the cap is no quieter shown as a summary than as a toast.
    if ( entries.length === max + 1 ) return { shown: entries, folded: 0 };
    return { shown: entries.slice(0, max), folded: entries.length - max };
};
