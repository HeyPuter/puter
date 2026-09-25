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
 * Notifications over `puter.events`, where the server says it has them.
 *
 * The desktop and the dashboard have always rendered from the socket wire
 * (`notif.message` / `notif.unreads`). Where the events surface is
 * advertised, this feed renders instead: one subscription per slice of the
 * mailbox a session can name, and a fetch for what arrived while nothing was
 * listening. The socket listeners stay registered either way and ask
 * `isActive()` before rendering, so a lapsed subscription hands rendering
 * straight back to them rather than leaving the GUI deaf.
 */

import {
    listNotifications,
    markNotificationAcknowledged,
    markNotificationShown,
} from './notificationApi.js';

/**
 * Every slice of their own mailbox a user session can name: `notif:<audience>`
 * expands against the session, which covers the rows naming no app. Rows about
 * an app are addressed by its uid and are that app's own to watch.
 */
export const NOTIFICATION_SUBJECTS = Object.freeze([
    'notif:account',
    'notif:developer',
    'notif:app-user',
]);

/**
 * Notifications one page of a replay reads — the server's own cap, since a
 * fetch with no cursor starts at the oldest notification still kept and the
 * interesting ones are at the far end.
 */
const REPLAY_LIMIT = 200;

/**
 * Pages one replay walks. A mailbox deeper than this leaves its oldest
 * behind, which the notification center lists anyway.
 */
const REPLAY_PAGES = 3;

/** How far back the read-state filter looks. */
const UNACKNOWLEDGED_LIMIT = 200;

/**
 * @typedef {Object} FeedNotification
 * @property {string} uid
 * @property {Object} notification - The payload, as the socket wire carries it
 * @property {number} created_at - Epoch milliseconds
 */

/**
 * Whether the events path is usable: the server advertises it and the loaded
 * SDK has the surface. An older cached bundle is the reason for the second
 * half — the capability says what the backend can do, not what this page can
 * call.
 *
 * @param {Object} [params] - `window.gui_params`
 * @param {Object} [sdk] - `window.puter`
 * @returns {boolean}
 */
export const eventsNotificationsAvailable = (params, sdk) => (
    params?.eventsNotifications === true
    && typeof sdk?.events?.onLocal === 'function'
    && typeof sdk?.events?.fetch === 'function'
);

/**
 * One event projection in the shape the render paths take. The payload rides
 * the projection verbatim, so this only unwraps it — and folds in the
 * registry `type` where the payload predates it, since the predicates read
 * `type` first.
 *
 * `null` for anything that isn't a notification: a gap marker, or an event
 * with no uid to acknowledge it by.
 *
 * @param {Object} event
 * @returns {FeedNotification|null}
 */
export const notificationFromEvent = (event) => {
    if ( ! event || typeof event !== 'object' ) return null;
    if ( event.op !== 'post' ) return null;
    const uid = event.uid ?? event.id;
    if ( typeof uid !== 'string' || uid === '' ) return null;
    const payload = event.notification;
    const notification = payload && typeof payload === 'object' ? payload : {};
    const type = notification.type ?? (event.type || undefined);
    return {
        uid,
        notification: type === undefined ? notification : { ...notification, type },
        created_at: Number.isFinite(event.ts) ? event.ts : Date.now(),
    };
};

/**
 * What a replay should raise: the fetched events that are still undismissed
 * and haven't already come through live, in the order they were created. A
 * uid seen twice keeps its newest copy — the backend re-sends a notification
 * under its own uid when what it says has grown.
 *
 * @param {Object[]} events
 * @param {{ unacknowledged: Set<string>, delivered?: Set<string> }} state
 * @returns {FeedNotification[]}
 */
export const replayCandidates = (events, { unacknowledged, delivered = new Set() }) => {
    /** @type {Map<string, FeedNotification>} */
    const byUid = new Map();
    for ( const event of events ?? [] ) {
        const item = notificationFromEvent(event);
        if ( ! item ) continue;
        if ( ! unacknowledged.has(item.uid) || delivered.has(item.uid) ) continue;
        byUid.delete(item.uid);
        byUid.set(item.uid, item);
    }
    return [...byUid.values()];
};

/**
 * What a toast's lifecycle step records on the mailbox. Shown and dismissed
 * are one thing on the socket wire — both arrive as an ack, which means "take
 * it off screen" — so only the events path marks a rendering as shown.
 *
 * @param {'shown'|'dismissed'} phase
 * @param {{ eventsPath?: boolean }} [opts]
 * @returns {'shown'|'ack'|null}
 */
export const markForToast = (phase, { eventsPath = false } = {}) => {
    if ( phase === 'dismissed' ) return 'ack';
    if ( phase === 'shown' ) return eventsPath ? 'shown' : null;
    return null;
};

/**
 * Record a toast's lifecycle step on the mailbox, per {@link markForToast}.
 * Never rejects: nothing about a toast is worth failing a render over.
 *
 * @param {'shown'|'dismissed'} phase
 * @param {string} uid
 * @param {{ eventsPath?: boolean, api?: { shown: Function, ack: Function } }} [opts]
 * @returns {Promise<void>}
 */
export const applyToastMark = async (phase, uid, { eventsPath = false, api = {} } = {}) => {
    const mark = markForToast(phase, { eventsPath });
    if ( mark === null ) return;
    try {
        if ( mark === 'ack' ) await (api.ack ?? markNotificationAcknowledged)(uid);
        else await (api.shown ?? markNotificationShown)(uid);
    } catch (err) {
        console.warn(`Could not mark notification ${mark}:`, err);
    }
};

/** The uids of everything the user has not dismissed. */
const undismissedUids = async () => {
    const rows = await listNotifications({
        predicate: 'unacknowledged',
        limit: UNACKNOWLEDGED_LIMIT,
    });
    return new Set(rows.map((row) => row.uid).filter(Boolean));
};

/**
 * The notification feed for one page.
 *
 * `deliver` is handed notifications in the socket wire's shape, so the
 * renderers are the ones already written against it. Every dependency is
 * injectable because the interesting parts — what replays, what is dropped as
 * a duplicate, when the socket takes over again — are worth testing without a
 * desktop around them.
 *
 * @param {Object} opts
 * @param {(items: FeedNotification[], meta: { replay: boolean }) => void} opts.deliver
 * @param {Object} [opts.sdk] - `window.puter`
 * @param {Object} [opts.params] - `window.gui_params`
 * @param {{ undismissed?: () => Promise<Set<string>>, claimShown?: (uid: string) => Promise<boolean> }} [opts.mailbox]
 * @returns {{ isActive: () => boolean, start: () => Promise<boolean>, stop: () => Promise<void> }}
 */
export function createNotificationFeed ({
    deliver,
    sdk = globalThis.puter,
    params = globalThis.gui_params,
    mailbox = {},
} = {}) {
    const undismissed = mailbox.undismissed ?? undismissedUids;
    const claimShown = mailbox.claimShown ?? markNotificationShown;

    let active = false;
    /** @type {Object[]} */
    let subscriptions = [];
    /** Uids this page has already rendered, so a replay never repeats one. */
    const delivered = new Set();
    /** How far each subject has been read, by subject. */
    const cursors = new Map();

    const hand = (items, replay) => {
        if ( items.length === 0 ) return;
        for ( const item of items ) delivered.add(item.uid);
        deliver(items, { replay });
    };

    // A live arrival is marked shown by whoever renders it — see
    // `applyToastMark` — so nothing is claimed here.
    const onDelivery = (event) => {
        const item = notificationFromEvent(event);
        if ( item ) hand([item], false);
    };

    /**
     * One subject's slice, from where the last read left off. A page comes
     * back without a cursor when it is the end of what there is, so a later
     * catch-up re-reads the tail rather than the whole mailbox.
     */
    const read = async (subject) => {
        const items = [];
        try {
            for ( let page = 0; page < REPLAY_PAGES; page++ ) {
                const after = cursors.get(subject);
                const result = await sdk.events.fetch({
                    subject,
                    limit: REPLAY_LIMIT,
                    ...(after ? { after } : {}),
                });
                items.push(...(result?.items ?? []));
                if ( typeof result?.cursor !== 'string' ) break;
                cursors.set(subject, result.cursor);
            }
        } catch (err) {
            console.warn(`Could not read missed notifications for ${subject}:`, err);
        }
        return items;
    };

    /**
     * What arrived while nothing was listening. The mailbox decides what is
     * still worth raising twice over: undismissed, and claimed here first —
     * `mark-shown` only succeeds for whoever gets there first, which is what
     * keeps a notification from being toasted once per open tab.
     */
    const replay = async () => {
        const [pages, unacknowledged] = await Promise.all([
            Promise.all(NOTIFICATION_SUBJECTS.map(read)),
            undismissed(),
        ]);

        for ( const item of replayCandidates(pages.flat(), { unacknowledged, delivered }) ) {
            const claimed = await claimShown(item.uid).catch(() => false);
            if ( claimed ) hand([item], true);
        }
    };

    /** The subscription is gone; the socket listeners render from here on. */
    const lapse = (err) => {
        if ( ! active ) return;
        console.warn('Notification events lapsed, falling back to the socket:', err);
        active = false;
        void stop();
        // Whatever the lapse swallowed is still in the mailbox, and the
        // socket only pushes what happens next.
        void replay().catch(() => {});
    };

    const start = async () => {
        if ( active ) return true;
        if ( ! eventsNotificationsAvailable(params, sdk) ) return false;

        const results = await Promise.allSettled(NOTIFICATION_SUBJECTS.map((subject) => (
            sdk.events.onLocal(subject, ({ event }) => onDelivery(event), { onError: lapse })
        )));
        // Held even when a sibling failed: a subscription nothing can turn
        // off would keep rendering behind the socket listeners' back.
        subscriptions = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        const refused = results.find((r) => r.status === 'rejected');
        if ( refused ) {
            console.warn('Could not subscribe to notification events:', refused.reason);
            await stop();
            return false;
        }
        // Subscribed before replaying, so nothing lands in the gap between
        // the two.
        active = true;
        void replay().catch((err) => {
            console.warn('Could not replay missed notifications:', err);
        });
        return true;
    };

    const stop = async () => {
        active = false;
        const held = subscriptions;
        subscriptions = [];
        await Promise.all(held.map((sub) => sub?.off?.()));
    };

    return { isActive: () => active, start, stop };
}
