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

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    NOTIFICATION_SUBJECTS,
    applyToastMark,
    createNotificationFeed,
    eventsNotificationsAvailable,
    markForToast,
    notificationFromEvent,
    replayCandidates,
} from './notificationFeed.js';

const TS = Date.UTC(2026, 7, 27, 12, 0, 0);

const event = (uid, over = {}) => ({
    id: uid,
    subject: 'notif:account',
    op: 'post',
    uid,
    type: 'share.received',
    audience: 'account',
    appUid: null,
    notification: { title: 'Shared with you' },
    self: true,
    ts: TS,
    seq: 0,
    ...over,
});

/** Let everything the feed kicked off without awaiting finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An SDK whose subscriptions and fetches are answered from `opts`. */
const fakeSdk = ({ pages = {}, onSubscribe } = {}) => {
    const subs = [];
    return {
        subs,
        events: {
            onLocal: vi.fn(async (subject, handler, options) => {
                if ( onSubscribe ) await onSubscribe(subject);
                const sub = { subject, handler, options, off: vi.fn(async () => {}) };
                subs.push(sub);
                return sub;
            }),
            fetch: vi.fn(async ({ subject }) => ({ items: pages[subject] ?? [] })),
        },
    };
};

const startFeed = async ({ sdk, mailbox = {}, params = { eventsNotifications: true } }) => {
    const delivered = [];
    const feed = createNotificationFeed({
        deliver: (items, meta) => delivered.push([items, meta]),
        sdk,
        params,
        mailbox: {
            undismissed: async () => new Set(),
            claimShown: async () => true,
            ...mailbox,
        },
    });
    const started = await feed.start();
    await settle();
    return { feed, delivered, started };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('eventsNotificationsAvailable', () => {
    const sdk = { events: { onLocal: () => {}, fetch: () => {} } };

    it('needs the server to advertise it', () => {
        expect(eventsNotificationsAvailable({}, sdk)).toBe(false);
        expect(eventsNotificationsAvailable(undefined, sdk)).toBe(false);
        expect(eventsNotificationsAvailable({ eventsNotifications: 'yes' }, sdk)).toBe(false);
        expect(eventsNotificationsAvailable({ eventsNotifications: true }, sdk)).toBe(true);
    });

    it('needs the loaded SDK to have the surface', () => {
        const params = { eventsNotifications: true };
        expect(eventsNotificationsAvailable(params, {})).toBe(false);
        expect(eventsNotificationsAvailable(params, { events: {} })).toBe(false);
        expect(eventsNotificationsAvailable(params, { events: { onLocal: () => {} } })).toBe(false);
    });
});

describe('notificationFromEvent', () => {
    it('hands the payload over as the wire carries it', () => {
        const payload = { title: 'Shared with you', text: 'report.pdf', fields: { count: 1 } };
        expect(notificationFromEvent(event('n1', { notification: payload }))).toEqual({
            uid: 'n1',
            notification: { ...payload, type: 'share.received' },
            created_at: TS,
        });
    });

    it('leaves a payload that names its own type alone', () => {
        const payload = { title: 'x', type: 'share.claimed' };
        expect(notificationFromEvent(event('n1', { notification: payload })).notification.type)
            .toBe('share.claimed');
    });

    it('adds no type when the event has none either', () => {
        const item = notificationFromEvent(event('n1', { type: '', notification: { title: 'x' } }));
        expect(item.notification).toEqual({ title: 'x' });
    });

    it('is nothing for a gap marker or an event with no uid', () => {
        expect(notificationFromEvent({ id: 'g1', op: 'gap', reason: 'delivery_rate_limit' })).toBe(null);
        expect(notificationFromEvent(event(undefined, { id: undefined }))).toBe(null);
        expect(notificationFromEvent(null)).toBe(null);
        expect(notificationFromEvent('notif')).toBe(null);
    });

    it('falls back to the event id when the projection names no uid', () => {
        expect(notificationFromEvent({ id: 'n9', op: 'post', notification: {} }).uid).toBe('n9');
    });
});

describe('replayCandidates', () => {
    const unacknowledged = new Set(['n1', 'n2']);

    it('keeps only what is still undismissed, in the order it arrived', () => {
        const out = replayCandidates(
            [event('n1'), event('gone'), event('n2')],
            { unacknowledged },
        );
        expect(out.map((item) => item.uid)).toEqual(['n1', 'n2']);
    });

    it('skips what already came through live', () => {
        const out = replayCandidates(
            [event('n1'), event('n2')],
            { unacknowledged, delivered: new Set(['n1']) },
        );
        expect(out.map((item) => item.uid)).toEqual(['n2']);
    });

    it('keeps the newest copy of a uid sent twice, at its later position', () => {
        const out = replayCandidates(
            [event('n1', { notification: { title: 'one share' } }), event('n2'),
                event('n1', { notification: { title: 'two shares' } })],
            { unacknowledged },
        );
        expect(out.map((item) => item.uid)).toEqual(['n2', 'n1']);
        expect(out[1].notification.title).toBe('two shares');
    });

    it('drops gap markers rather than replaying them', () => {
        const out = replayCandidates([{ id: 'g', op: 'gap' }, event('n1')], { unacknowledged });
        expect(out.map((item) => item.uid)).toEqual(['n1']);
    });
});

describe('markForToast', () => {
    it('marks a rendering shown only where the events path can say so', () => {
        expect(markForToast('shown', { eventsPath: true })).toBe('shown');
        expect(markForToast('shown', { eventsPath: false })).toBe(null);
        expect(markForToast('shown')).toBe(null);
    });

    it('acknowledges a dismissal on either path', () => {
        expect(markForToast('dismissed', { eventsPath: true })).toBe('ack');
        expect(markForToast('dismissed', { eventsPath: false })).toBe('ack');
    });
});

describe('applyToastMark', () => {
    const api = () => ({ shown: vi.fn(async () => true), ack: vi.fn(async () => {}) });

    it('routes each phase to its own call', async () => {
        const calls = api();
        await applyToastMark('shown', 'n1', { eventsPath: true, api: calls });
        await applyToastMark('dismissed', 'n1', { eventsPath: true, api: calls });
        expect(calls.shown).toHaveBeenCalledWith('n1');
        expect(calls.ack).toHaveBeenCalledWith('n1');
    });

    it('marks nothing for a rendering on the socket wire', async () => {
        const calls = api();
        await applyToastMark('shown', 'n1', { eventsPath: false, api: calls });
        expect(calls.shown).not.toHaveBeenCalled();
        expect(calls.ack).not.toHaveBeenCalled();
    });

    it('does not fail a render when the mailbox is unreachable', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const calls = { ack: vi.fn(async () => { throw new Error('offline'); }) };
        await expect(applyToastMark('dismissed', 'n1', { api: calls })).resolves.toBeUndefined();
    });
});

describe('createNotificationFeed', () => {
    it('stays off, and subscribes to nothing, without the capability', async () => {
        const sdk = fakeSdk();
        const { feed, started } = await startFeed({ sdk, params: {} });
        expect(started).toBe(false);
        expect(feed.isActive()).toBe(false);
        expect(sdk.events.onLocal).not.toHaveBeenCalled();
    });

    it('watches every slice of the mailbox a session can name', async () => {
        const sdk = fakeSdk();
        const { feed } = await startFeed({ sdk });
        expect(feed.isActive()).toBe(true);
        expect(sdk.subs.map((sub) => sub.subject)).toEqual([...NOTIFICATION_SUBJECTS]);
    });

    it('hands a live delivery over as an arrival, not a replay', async () => {
        const sdk = fakeSdk();
        const { delivered, feed } = await startFeed({ sdk });
        sdk.subs[0].handler({ event: event('n1') });
        expect(delivered).toHaveLength(1);
        expect(delivered[0][0][0].uid).toBe('n1');
        expect(delivered[0][1]).toEqual({ replay: false });
        expect(feed.isActive()).toBe(true);
    });

    it('replays only what is undismissed and claimed here first', async () => {
        const sdk = fakeSdk({ pages: { 'notif:account': [event('n1'), event('n2'), event('n3')] } });
        const claimShown = vi.fn(async (uid) => uid !== 'n2');
        const { delivered } = await startFeed({
            sdk,
            mailbox: { undismissed: async () => new Set(['n1', 'n2']), claimShown },
        });
        expect(delivered.map(([items]) => items[0].uid)).toEqual(['n1']);
        expect(delivered[0][1]).toEqual({ replay: true });
        // n3 is dismissed, so it is never even claimed.
        expect(claimShown.mock.calls.map(([uid]) => uid)).toEqual(['n1', 'n2']);
    });

    it('does not replay what it already delivered live', async () => {
        const sdk = fakeSdk({
            pages: { 'notif:account': [event('n1')] },
            // Deliver live while the replay's own reads are in flight.
            onSubscribe: () => {},
        });
        const feedItems = [];
        const feed = createNotificationFeed({
            deliver: (items, meta) => feedItems.push([items[0].uid, meta.replay]),
            sdk,
            params: { eventsNotifications: true },
            mailbox: {
                undismissed: async () => new Set(['n1']),
                claimShown: async () => true,
            },
        });
        await feed.start();
        sdk.subs[0].handler({ event: event('n1') });
        await settle();
        expect(feedItems).toEqual([['n1', false]]);
    });

    it('reads every subject when catching up', async () => {
        const sdk = fakeSdk();
        await startFeed({ sdk });
        expect(sdk.events.fetch.mock.calls.map(([opts]) => opts.subject))
            .toEqual([...NOTIFICATION_SUBJECTS]);
    });

    it('follows the cursor to the end of a deep mailbox', async () => {
        // A page comes back with a cursor while there is more behind it.
        const pages = [
            { items: [event('n1')], cursor: 'c1' },
            { items: [event('n2')] },
        ];
        const sdk = fakeSdk();
        sdk.events.fetch = vi.fn(async ({ subject, after }) => {
            if ( subject !== 'notif:account' ) return { items: [] };
            return after === 'c1' ? pages[1] : pages[0];
        });
        const { delivered } = await startFeed({
            sdk,
            mailbox: { undismissed: async () => new Set(['n1', 'n2']) },
        });
        expect(delivered.map(([items]) => items[0].uid)).toEqual(['n1', 'n2']);
    });

    it('resumes a later read where the last one stopped', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sdk = fakeSdk();
        sdk.events.fetch = vi.fn(async ({ after }) => (
            after ? { items: [] } : { items: [event('n1')], cursor: 'c1' }
        ));
        const { feed } = await startFeed({
            sdk,
            mailbox: { undismissed: async () => new Set(['n1']) },
        });
        sdk.events.fetch.mockClear();

        sdk.subs[0].options.onError(new Error('connection lost'));
        await settle();
        expect(feed.isActive()).toBe(false);
        expect(sdk.events.fetch.mock.calls[0][0].after).toBe('c1');
    });

    it('stands down and fills the gap when a subscription lapses', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sdk = fakeSdk({ pages: { 'notif:account': [event('n1')] } });
        // Nothing was waiting at first; `n1` lands while the subscription is
        // on its way out.
        const unacknowledged = new Set();
        const { feed, delivered } = await startFeed({
            sdk,
            mailbox: { undismissed: async () => unacknowledged },
        });
        expect(delivered).toHaveLength(0);

        unacknowledged.add('n1');
        sdk.subs[0].options.onError(new Error('connection lost'));
        await settle();

        expect(feed.isActive()).toBe(false);
        for ( const sub of sdk.subs ) expect(sub.off).toHaveBeenCalled();
        // Whatever the lapse swallowed still reaches the user.
        expect(delivered.map(([items]) => items[0].uid)).toEqual(['n1']);
    });

    it('leaves the socket in charge when subscribing fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sdk = fakeSdk({
            onSubscribe: (subject) => {
                if ( subject === 'notif:developer' ) throw new Error('refused');
            },
        });
        const { feed, started, delivered } = await startFeed({ sdk });
        expect(started).toBe(false);
        expect(feed.isActive()).toBe(false);
        expect(delivered).toHaveLength(0);
        // Nothing is left subscribed behind a failed start.
        for ( const sub of sdk.subs ) expect(sub.off).toHaveBeenCalled();
    });

    it('stops watching when it is torn down', async () => {
        const sdk = fakeSdk();
        const { feed } = await startFeed({ sdk });
        await feed.stop();
        expect(feed.isActive()).toBe(false);
        for ( const sub of sdk.subs ) expect(sub.off).toHaveBeenCalled();
    });
});
