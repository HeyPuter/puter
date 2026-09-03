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
 * Notifications delivered through events dispatch.
 *
 * Two things have to hold at once: the desktop's wire does not change, and a
 * socket receives each notification once however many regions the fan reaches.
 * The peer is simulated the way `BroadcastService`'s own tests do it — axios
 * mocked at the SDK boundary, and the webhook fed back in as a peer region
 * would receive it.
 */

import { createHmac } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { NOTIF_DELIVERY_EVENT } from '../notification/notificationSocket.js';
import { EVENTS_DELIVERY_CHANNEL, type DeliveryEnvelope } from './EventsService.js';

const { axiosRequestMock } = vi.hoisted(() => ({
    axiosRequestMock: vi.fn(),
}));

vi.mock('axios', () => ({
    default: { request: axiosRequestMock },
    request: axiosRequestMock,
}));

const SELF_PEER_ID = 'self-node';
const SELF_SECRET = 'self-shared-secret';
const PEER_ID = 'peer-a';
const PEER_SECRET = 'peer-a-shared-secret';
const PEER_URL = 'http://notif-peer.invalid/broadcast/webhook';

const broadcastConfig = {
    webhook: { peerId: SELF_PEER_ID, secret: SELF_SECRET },
    peers: [
        {
            peerId: PEER_ID,
            webhook: true,
            webhook_url: PEER_URL,
            webhook_secret: PEER_SECRET,
        },
    ],
    outbound_flush_ms: 25,
};

let nonceCounter = 2_000_000;

/** One socket push, as the service addressed it. */
interface Sent {
    room: unknown;
    key: string;
    data: unknown;
}

const withServer = (config: IConfig) => {
    const state: {
        server: PuterServer;
        sent: Sent[];
        delivered: DeliveryEnvelope[];
    } = { server: null as never, sent: [], delivered: [] };

    beforeAll(async () => {
        state.server = await setupTestServer({
            broadcast: broadcastConfig,
            ...config,
        } as never);
        vi.spyOn(state.server.services.socket, 'send').mockImplementation(
            async (specifier, key, data) => {
                const spec = Array.isArray(specifier)
                    ? specifier[0]
                    : specifier;
                state.sent.push({ room: spec.room ?? spec.socket, key, data });
            },
        );
        state.server.services.events.onDelivered = (envelope) => {
            state.delivered.push(envelope);
        };
    });

    afterAll(async () => {
        await state.server?.shutdown();
    });

    beforeEach(() => {
        state.sent.length = 0;
        state.delivered.length = 0;
        axiosRequestMock.mockReset();
        axiosRequestMock.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            data: 'ok',
        });
    });

    afterEach(() => {
        // Left armed: a flush scheduled by this test may land in the next one,
        // and an unarmed mock resolves undefined into the sender.
        axiosRequestMock.mockClear();
    });

    return state;
};

const makeUser = async (
    server: PuterServer,
): Promise<{ id: number; uuid: string; username: string }> => {
    const username = `fold-${Math.random().toString(36).slice(2, 10)}`;
    const uuid = uuidv4();
    const created = await server.stores.user.create({
        username,
        uuid,
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    return { id: created.id, uuid, username };
};

/** An app row the user owns, so `developer` rows have somewhere to point. */
const makeApp = async (
    server: PuterServer,
    ownerUserId: number,
): Promise<string> => {
    const uid = `app-${uuidv4()}`;
    await server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, ownerUserId],
    );
    return uid;
};

const settle = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 50));

const waitFor = async (
    predicate: () => boolean,
    timeoutMs = 3000,
): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 10));
    }
};

const notifSends = (sent: Sent[]): Sent[] =>
    sent.filter((s) => s.key === 'notif.message');

/** Every event the outbound queue has posted to a peer so far. */
const forwarded = (): Array<{ key: string; data: unknown }> => {
    const events: Array<{ key: string; data: unknown }> = [];
    for (const call of axiosRequestMock.mock.calls) {
        const body = (call[0] as { data?: string } | undefined)?.data;
        if (typeof body !== 'string') continue;
        const parsed = JSON.parse(body) as {
            events?: Array<{ key: string; data: unknown }>;
        };
        for (const event of parsed.events ?? []) events.push(event);
    }
    return events;
};

/** The forwards carrying one user's notifications, whichever flush took them. */
const forwardedFor = (
    userId: number,
): Array<{ key: string; data: unknown }> =>
    forwarded().filter(
        (event) => (event.data as { userId?: number })?.userId === userId,
    );

/** Replay one forwarded event into a server, exactly as a peer region does. */
const applyAsPeer = async (
    server: PuterServer,
    event: { key: string; data: unknown },
): Promise<void> => {
    const body = { events: [{ ...event, meta: {} }] };
    const raw = Buffer.from(JSON.stringify(body));
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = ++nonceCounter;
    // Both halves of the fan are this one process, so the peer's own identity
    // is what signs and what verifies.
    const result = await (
        server.services.broadcast as unknown as {
            verifyAndEmit: (
                raw: Buffer,
                body: unknown,
                headers: Record<string, string>,
            ) => Promise<{ ok: boolean }>;
        }
    ).verifyAndEmit(raw, body, {
        peerId: PEER_ID,
        timestamp: String(timestamp),
        nonce: String(nonce),
        signature: createHmac('sha256', PEER_SECRET)
            .update(`${timestamp}.${nonce}.${raw.toString()}`)
            .digest('hex'),
    });
    expect(result.ok).toBe(true);
};

describe('notifications with the fold-in on', () => {
    const state = withServer({
        events: { enabled: true, notificationsFoldIn: true },
    } as IConfig);

    it('delivers the desktop wire unchanged, through dispatch', async () => {
        const user = await makeUser(state.server);
        const legacy: unknown[] = [];
        const handler = (_k: string, data: unknown) => legacy.push(data);
        state.server.clients.event.on('outer.gui.notif.message', handler);

        await state.server.services.notification.notify(
            [user.id],
            { title: 'shared with you' },
            { type: 'share.received' },
        );
        await waitFor(() => notifSends(state.sent).length > 0);

        expect(notifSends(state.sent)).toHaveLength(1);
        const [sent] = notifSends(state.sent);
        expect(sent.room).toBe(user.id);
        const [row] = await state.server.stores.notification.listByUserId(
            user.id,
            {},
        );
        expect(sent.data).toEqual({
            uid: row.uid,
            notification: { title: 'shared with you', type: 'share.received' },
        });
        // Off the GUI mutation fan entirely: riding both is how a socket ends
        // up with two copies.
        expect(legacy).toEqual([]);
        state.server.clients.event.off?.('outer.gui.notif.message', handler);
    });

    it('sends each socket one copy across a region fan', async () => {
        const user = await makeUser(state.server);

        await state.server.services.notification.notify(
            [user.id],
            { title: 'once' },
            { type: 'share.received' },
        );
        await waitFor(() => notifSends(state.sent).length > 0);
        await waitFor(() => forwardedFor(user.id).length > 0);

        // The emitting region sent once, and forwarded once — to the peer, not
        // to its own siblings.
        expect(notifSends(state.sent)).toHaveLength(1);
        const forwards = forwardedFor(user.id);
        expect(forwards).toHaveLength(1);
        expect(forwards[0].key).toBe(NOTIF_DELIVERY_EVENT);
        expect(forwarded().map((event) => event.key)).not.toContain(
            'outer.gui.notif.message',
        );

        // The peer region applies it and sends to its own sockets — one more
        // send in total, which is one copy per socket.
        await applyAsPeer(state.server, forwards[0]);
        await settle();
        expect(notifSends(state.sent)).toHaveLength(2);
        expect(notifSends(state.sent)[1].data).toEqual(
            notifSends(state.sent)[0].data,
        );
    });

    it('delivers to a subscription on the mailbox slice, and to no other', async () => {
        const user = await makeUser(state.server);
        const appUid = await makeApp(state.server, user.id);
        const actor = {
            user: { id: user.id, uuid: user.uuid, username: user.username },
            effectiveApp: null,
        };

        await state.server.services.events.subscribe(
            actor as never,
            'socket-account',
            { subject: 'notif:account' },
        );
        await state.server.services.events.subscribe(
            actor as never,
            'socket-developer',
            { subject: `notif:${appUid}:developer` },
        );

        await state.server.services.notification.notify(
            [user.id],
            { title: 'account news' },
            { type: 'share.received' },
        );
        await waitFor(() => state.delivered.length > 0);
        await settle();

        expect(state.delivered).toHaveLength(1);
        const [envelope] = state.delivered;
        const [row] = await state.server.stores.notification.listByUserId(
            user.id,
            {},
        );
        expect(envelope.event).toEqual({
            // The row's uid is the event id, so a fetched copy and a pushed
            // copy of one notification are the same event.
            id: row.uid,
            subject: `notif:${user.uuid}:account`,
            op: 'post',
            uid: row.uid,
            type: 'share.received',
            audience: 'account',
            appUid: null,
            notification: { title: 'account news', type: 'share.received' },
            self: true,
            ts: expect.any(Number),
            seq: 0,
        });
        expect(state.sent.some((s) => s.key === EVENTS_DELIVERY_CHANNEL)).toBe(
            true,
        );

        await state.server.services.events.reapSocket(user.id, 'socket-account');
        await state.server.services.events.reapSocket(
            user.id,
            'socket-developer',
        );
    });

    it('never hands an app-context subscription an account notification', async () => {
        const user = await makeUser(state.server);
        const appUid = await makeApp(state.server, user.id);
        const appActor = {
            user: { id: user.id, uuid: user.uuid, username: user.username },
            app: { uid: appUid },
            effectiveApp: { uid: appUid },
        };

        // The two-segment form expands to the app's own rows; an app never
        // names an app uid.
        await state.server.services.events.subscribe(
            appActor as never,
            'socket-app',
            { subject: 'notif:app-user' },
        );

        await state.server.services.notification.notify(
            [user.id],
            { title: 'account only' },
            { type: 'share.received' },
        );
        await settle();
        expect(state.delivered).toHaveLength(0);

        await state.server.services.notification.notify(
            [user.id],
            { title: 'your app finished' },
            { type: 'app.events.ended', appUid },
        );
        await waitFor(() => state.delivered.length > 0);
        expect(state.delivered).toHaveLength(1);
        expect(state.delivered[0].event).toMatchObject({
            audience: 'app-user',
            appUid,
        });

        await state.server.services.events.reapSocket(user.id, 'socket-app');
    });

    it('delivers a developer row naming an app to its owner\'s own generic subscription', async () => {
        const user = await makeUser(state.server);
        const appUid = await makeApp(state.server, user.id);
        const actor = {
            user: { id: user.id, uuid: user.uuid, username: user.username },
            effectiveApp: null,
        };

        // The two-segment sugar form a session's own feed subscribes with —
        // it never names the app, unlike an app subscribing to its own rows.
        await state.server.services.events.subscribe(
            actor as never,
            'socket-developer-any',
            { subject: 'notif:developer' },
        );

        await state.server.services.notification.notify(
            [user.id],
            { title: 'a handler was suspended' },
            { type: 'app.events.suspended', appUid },
        );
        await waitFor(() => state.delivered.length > 0);
        await settle();

        expect(state.delivered).toHaveLength(1);
        expect(state.delivered[0].event).toMatchObject({
            audience: 'developer',
            appUid,
        });

        await state.server.services.events.reapSocket(
            user.id,
            'socket-developer-any',
        );
    });

    it('never widens a generic subscription to an app its holder no longer owns', async () => {
        const owner = await makeUser(state.server);
        const buyer = await makeUser(state.server);
        const appUid = await makeApp(state.server, owner.id);
        const actor = {
            user: { id: owner.id, uuid: owner.uuid, username: owner.username },
            effectiveApp: null,
        };

        await state.server.services.events.subscribe(
            actor as never,
            'socket-developer-transferred',
            { subject: 'notif:developer' },
        );
        // Ownership moves on; the row is still addressed to the original
        // owner; the delivery-time recheck is what has to catch this, since
        // the match filter alone no longer pins the row to one app.
        await state.server.clients.db.write(
            'UPDATE `apps` SET `owner_user_id` = ? WHERE `uid` = ?',
            [buyer.id, appUid],
        );

        await state.server.services.notification.notify(
            [owner.id],
            { title: 'a handler was suspended' },
            { type: 'app.events.suspended', appUid },
        );
        await settle();
        expect(state.delivered).toHaveLength(0);

        await state.server.services.events.reapSocket(
            owner.id,
            'socket-developer-transferred',
        );
    });

    it('replays a developer row naming an app through a generic fetch', async () => {
        const user = await makeUser(state.server);
        const appUid = await makeApp(state.server, user.id);
        const actor = {
            user: { id: user.id, uuid: user.uuid, username: user.username },
            effectiveApp: null,
        };

        await state.server.services.notification.notify(
            [user.id],
            { title: 'your worker deploy failed' },
            { type: 'app.worker.deployFailed', appUid },
        );

        const page = await state.server.services.events.fetchMissed(
            actor as never,
            { subject: 'notif:developer', limit: 50 },
        );
        expect(page.items.map((i) => i.appUid)).toContain(appUid);
    });

    it('refuses a mailbox slice the actor could never be shown', async () => {
        const owner = await makeUser(state.server);
        const other = await makeUser(state.server);
        const appUid = await makeApp(state.server, owner.id);
        const appActor = {
            user: { id: other.id, uuid: other.uuid, username: other.username },
            app: { uid: appUid },
            effectiveApp: { uid: appUid },
        };

        await expect(
            state.server.services.events.subscribe(
                appActor as never,
                'socket-nope',
                { subject: 'notif:account' },
            ),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });
});

describe('notifications with the fold-in off', () => {
    const state = withServer({ events: { enabled: true } } as IConfig);

    it('refuses a notif subscription rather than storing one that never fires', async () => {
        const user = await makeUser(state.server);
        await expect(
            state.server.services.events.subscribe(
                {
                    user: {
                        id: user.id,
                        uuid: user.uuid,
                        username: user.username,
                    },
                    effectiveApp: null,
                } as never,
                'socket-off',
                { subject: 'notif:account' },
            ),
        ).rejects.toMatchObject({ legacyCode: 'invalid_subject' });
    });

    it('takes the legacy path and produces the same wire', async () => {
        const user = await makeUser(state.server);
        const dispatched: unknown[] = [];
        const handler = (_k: string, data: unknown) => dispatched.push(data);
        state.server.clients.event.on(NOTIF_DELIVERY_EVENT, handler);

        await state.server.services.notification.notify(
            [user.id],
            { title: 'shared with you' },
            { type: 'share.received' },
        );
        await waitFor(() => notifSends(state.sent).length > 0);

        const [row] = await state.server.stores.notification.listByUserId(
            user.id,
            {},
        );
        expect(notifSends(state.sent)).toHaveLength(1);
        expect(notifSends(state.sent)[0].data).toEqual({
            uid: row.uid,
            notification: { title: 'shared with you', type: 'share.received' },
        });
        // Nothing dispatched: the events layer never sees the notification.
        expect(dispatched).toEqual([]);
        expect(state.delivered).toEqual([]);
        state.server.clients.event.off?.(NOTIF_DELIVERY_EVENT, handler);
    });
});

describe('notifications with events off', () => {
    const state = withServer({
        events: { notificationsFoldIn: true },
    } as IConfig);

    it('keeps the legacy path when the master switch is off', async () => {
        const user = await makeUser(state.server);
        const dispatched: unknown[] = [];
        const handler = (_k: string, data: unknown) => dispatched.push(data);
        state.server.clients.event.on(NOTIF_DELIVERY_EVENT, handler);

        await state.server.services.notification.notify(
            [user.id],
            { title: 'still delivered' },
            { type: 'share.received' },
        );
        await waitFor(() => notifSends(state.sent).length > 0);

        expect(notifSends(state.sent)).toHaveLength(1);
        expect(dispatched).toEqual([]);
        state.server.clients.event.off?.(NOTIF_DELIVERY_EVENT, handler);
    });
});
