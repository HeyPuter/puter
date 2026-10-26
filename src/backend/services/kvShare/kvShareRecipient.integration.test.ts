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
 * What the recipient of a key-value share sees and controls: the notification
 * that tells their app a share arrived, kept off their desktop, and the share
 * blocks that refuse one.
 */

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_KV_HANDLE_LIMIT,
    KV_SHARE_NOTICE_LIMIT,
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from '../events/EventsService.js';
import type { KvShareAccess } from './kvShares.js';

const BOOT_TIMEOUT_MS = 120_000;

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
    uuid: string;
}

/** One server, its two users, and a fresh app the owner can share data of. */
const bootEnv = (config: Record<string, unknown>) => {
    const state = {
        env: null as unknown as PuterTestEnv,
        owner: null as unknown as TestUser,
        guest: null as unknown as TestUser,
    };

    const userFor = async (username: string): Promise<TestUser> => {
        const row = await state.env.server.stores.user.getByUsername(username);
        return {
            actor: makeActor({ user: row as never }),
            username,
            id: row!.id,
            uuid: row!.uuid as string,
        };
    };

    beforeAll(async () => {
        state.env = await setupPuterTestEnv({
            events: { enabled: true, kvHandles: true },
            kv: { shareHandles: true },
            unlimitedMetering: true,
            ...config,
        } as IConfig);
        state.owner = await userFor(state.env.users.user.username);
        state.guest = await userFor(state.env.users.other.username);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await state.env?.shutdown();
    });

    beforeEach(async () => {
        for (const user of [state.owner, state.guest])
            await state.env.server.clients.redis.del(
                `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${user.id}`,
            );
        await state.env.server.clients.redis.del(
            `rate:${KV_SHARE_NOTICE_LIMIT.scope}:${state.owner.id}:${state.guest.id}`,
        );
    });

    const makeApp = async () => {
        const name = `kv-recipient-${uuidv4().slice(0, 8)}`;
        return state.env.server.stores.app.create(
            {
                name,
                title: 'Recipient App',
                index_url: `https://${name}.example.test/index.html`,
            },
            { ownerUserId: state.owner.id },
        );
    };

    const share = (
        prefix: string,
        access: KvShareAccess,
        opts: { appUid?: string; label?: unknown } = {},
    ) =>
        state.env.server.services.kvShare.mintKvHandle(
            state.owner.actor,
            {
                prefix,
                recipient: { username: state.guest.username },
                access,
                ...(opts.appUid ? { appUid: opts.appUid } : {}),
                ...(opts.label !== undefined ? { label: opts.label } : {}),
            },
            { defaultAccess: 'read' },
        );

    /** The holder's share notifications naming one handle. */
    const notificationsFor = async (handle: string) =>
        (
            await state.env.server.clients.db.pread(
                'SELECT `uid`, `app_uid`, `audience`, `value` FROM `notification` ' +
                    "WHERE `user_id` = ? AND `type` = 'kv.share.received'",
                [state.guest.id],
            )
        )
            .map((row) => ({
                uid: String(row.uid),
                appUid: row.app_uid,
                audience: row.audience,
                value: (typeof row.value === 'string'
                    ? JSON.parse(row.value)
                    : row.value) as Record<string, unknown>,
            }))
            .filter((row) => row.value.handle === handle);

    return { state, makeApp, share, notificationsFor };
};

const region = (label: string) => `${label}-${uuidv4().slice(0, 8)}:`;

describe('the share notification', () => {
    const { state, makeApp, share, notificationsFor } = bootEnv({});

    it('reaches the holder once, in the app the data belongs to, without the owner', async () => {
        const app = await makeApp();
        const prefix = region('notify');
        const shared = await share(prefix, 'write', {
            appUid: app.uid,
            label: 'Groceries',
        });

        const rows = await notificationsFor(shared.handle);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            appUid: app.uid,
            audience: 'app-user',
        });
        expect(rows[0].value).toEqual({
            type: 'kv.share.received',
            handle: shared.handle,
            access: 'write',
            label: 'Groceries',
            createdAt: shared.createdAt,
        });
        const wire = JSON.stringify(rows);
        expect(wire).not.toContain(state.owner.uuid);
        expect(wire).not.toContain(state.owner.username);
        expect(wire).not.toContain(prefix);
    });

    it('is not sent again for a re-share, a level change or a label change', async () => {
        const app = await makeApp();
        const prefix = region('again');
        const { handle } = await share(prefix, 'read', { appUid: app.uid });
        await share(prefix, 'read', { appUid: app.uid });
        await share(prefix, 'write', { appUid: app.uid });
        await share(prefix, 'write', { appUid: app.uid, label: 'Renamed' });
        expect(await notificationsFor(handle)).toHaveLength(1);
    });

    it('is sent at most five times an hour per owner and holder, and the share is made anyway', async () => {
        const app = await makeApp();
        const prefix = region('churn');
        const handles: string[] = [];
        for (let i = 0; i < KV_SHARE_NOTICE_LIMIT.limit + 2; i++) {
            const { handle } = await share(prefix, 'read', { appUid: app.uid });
            handles.push(handle);
            await state.env.server.services.kvShare.removeKvShare(
                state.owner.actor,
                handle,
            );
        }
        expect(new Set(handles).size).toBe(handles.length);
        const counts = await Promise.all(
            handles.map(
                async (handle) => (await notificationsFor(handle)).length,
            ),
        );
        expect(counts.reduce((sum, n) => sum + n, 0)).toBe(
            KV_SHARE_NOTICE_LIMIT.limit,
        );
        expect(counts.slice(KV_SHARE_NOTICE_LIMIT.limit)).toEqual([0, 0]);
    });

    it('is not sent for a share with no app', async () => {
        const { handle } = await share(region('global'), 'read');
        expect(await notificationsFor(handle)).toEqual([]);
    });

    it('never reaches the desktop wire, and the mint stands when it fails', async () => {
        const app = await makeApp();
        const emit = vi.spyOn(state.env.server.clients.event, 'emit');
        try {
            const { handle } = await share(region('wire'), 'read', {
                appUid: app.uid,
            });
            const [row] = await notificationsFor(handle);
            const pushed = emit.mock.calls.filter(
                ([key, data]) =>
                    key === 'outer.gui.notif.message' &&
                    JSON.stringify(data).includes(row.uid),
            );
            expect(pushed).toEqual([]);
        } finally {
            emit.mockRestore();
        }

        const notify = vi
            .spyOn(state.env.server.services.notification, 'notify')
            .mockRejectedValueOnce(new Error('mailbox down'));
        try {
            await expect(
                share(region('failing'), 'read', { appUid: app.uid }),
            ).resolves.toMatchObject({ access: 'read' });
        } finally {
            notify.mockRestore();
        }
    });

    it('stays out of the whole-mailbox listing, but not out of the app`s slice', async () => {
        const app = await makeApp();
        const { handle } = await share(region('select'), 'read', {
            appUid: app.uid,
        });
        const [row] = await notificationsFor(handle);
        const select = (actor: Actor, args: Record<string, unknown> = {}) =>
            runWithContext({ actor }, () =>
                state.env.server.drivers.notifications.select(args),
            ) as Promise<Array<{ uid: unknown }>>;
        const uids = (rows: Array<{ uid: unknown }>) =>
            rows.map((one) => one.uid);

        expect(uids(await select(state.guest.actor))).not.toContain(row.uid);
        expect(
            uids(
                await select(state.guest.actor, { subject: 'notif:app-user' }),
            ),
        ).not.toContain(row.uid);
        expect(
            uids(
                await select(state.guest.actor, {
                    subject: `notif:${app.uid}:app-user`,
                }),
            ),
        ).toContain(row.uid);
        const appActor = makeActor({
            user: state.guest.actor.user as never,
            app: { uid: app.uid, id: app.id },
        });
        expect(uids(await select(appActor))).toContain(row.uid);
    });

    it('is left out of the unread replay a desktop gets on connecting', async () => {
        const app = await makeApp();
        const { handle } = await share(region('replay'), 'read', {
            appUid: app.uid,
        });
        const [row] = await notificationsFor(handle);
        const emit = vi.spyOn(state.env.server.clients.event, 'emit');
        try {
            state.env.server.clients.event.emit(
                'web.socket.user-connected',
                { user: { id: state.guest.id } } as never,
                {},
            );
            // The replay is debounced by two seconds.
            await new Promise((resolve) => setTimeout(resolve, 2_300));
            const replayed = emit.mock.calls.filter(
                ([key, data]) =>
                    key === 'outer.gui.notif.unreads' &&
                    JSON.stringify(data).includes(row.uid),
            );
            expect(replayed).toEqual([]);
        } finally {
            emit.mockRestore();
        }
    });
});

describe('the share notification with notification dispatch on', () => {
    const { state, makeApp, share, notificationsFor } = bootEnv({
        events: {
            enabled: true,
            kvHandles: true,
            notificationsFoldIn: true,
        },
    });

    it('reaches the app`s notif:app-user subscription and never the desktop', async () => {
        const app = await makeApp();
        const delivered: DeliveryEnvelope[] = [];
        state.env.server.services.events.onDelivered = (envelope) =>
            delivered.push(envelope);
        const appActor = makeActor({
            user: state.guest.actor.user as never,
            app: { uid: app.uid, id: app.id },
        });
        await state.env.server.services.events.subscribe(
            appActor,
            'kv-recipient-socket',
            { subject: 'notif:app-user' },
        );
        const send = vi.spyOn(state.env.server.services.socket, 'send');
        try {
            const { handle } = await share(region('folded'), 'read', {
                appUid: app.uid,
            });
            const [row] = await notificationsFor(handle);

            await vi.waitFor(
                () =>
                    expect(
                        delivered.some(
                            (one) =>
                                (one.event as { uid?: string }).uid === row.uid,
                        ),
                    ).toBe(true),
                { timeout: EVENTS_COALESCE_WINDOW_MS * 12, interval: 25 },
            );
            const desktop = send.mock.calls.filter(
                ([, key, data]) =>
                    key === 'notif.message' &&
                    JSON.stringify(data).includes(row.uid),
            );
            expect(desktop).toEqual([]);
        } finally {
            send.mockRestore();
            await state.env.server.services.events.reapSocket(
                state.guest.id,
                'kv-recipient-socket',
            );
        }
    });

    it('stays out of the desktop`s own notif:app-user feed, live and fetched', async () => {
        const events = state.env.server.services.events;
        const app = await makeApp();
        const delivered: DeliveryEnvelope[] = [];
        events.onDelivered = (envelope) => delivered.push(envelope);
        const appActor = makeActor({
            user: state.guest.actor.user as never,
            app: { uid: app.uid, id: app.id },
        });
        const { sub: desktopSub } = await events.subscribe(
            state.guest.actor,
            'kv-recipient-desktop',
            { subject: 'notif:app-user' },
        );
        const { sub: appSub } = await events.subscribe(
            appActor,
            'kv-recipient-app',
            { subject: 'notif:app-user' },
        );
        const deliveredTo = (subId: string, uid: string) =>
            delivered.some(
                (one) =>
                    one.subId === subId &&
                    (one.event as { uid?: string }).uid === uid,
            );
        // Deliveries on one subject within the coalesce window collapse to the
        // last, so each notification is waited out before the next is sent.
        const waitFor = (check: () => boolean) =>
            vi.waitFor(() => expect(check()).toBe(true), {
                timeout: EVENTS_COALESCE_WINDOW_MS * 12,
                interval: 25,
            });
        try {
            const { handle } = await share(region('desktop'), 'read', {
                appUid: app.uid,
            });
            const [row] = await notificationsFor(handle);
            await waitFor(() => deliveredTo(appSub.subId, row.uid));

            // Another app-user row about the same app still reaches the desktop.
            const ended = (await state.env.server.services.notification.notify(
                [state.guest.id],
                { title: 'Subscription ended' },
                { type: 'app.events.ended', appUid: app.uid },
            ))!;
            await waitFor(() => deliveredTo(desktopSub.subId, ended));
            expect(deliveredTo(desktopSub.subId, row.uid)).toBe(false);

            const fetched = async (subject: string) =>
                (
                    await events.fetchMissed(state.guest.actor, { subject })
                ).items.map((item) => item.uid);
            const generic = await fetched('notif:app-user');
            expect(generic).toContain(ended);
            expect(generic).not.toContain(row.uid);
            expect(await fetched(`notif:${app.uid}:app-user`)).toContain(
                row.uid,
            );
        } finally {
            for (const socketId of ['kv-recipient-desktop', 'kv-recipient-app'])
                await events.reapSocket(state.guest.id, socketId);
        }
    });
});

describe('recipient share blocks', () => {
    const { state, makeApp, share, notificationsFor } = bootEnv({});

    it('refuse a share from a sender the recipient blocked', async () => {
        await state.env.server.stores.userBlock.create(
            state.guest.id,
            state.owner.id,
        );
        try {
            const app = await makeApp();
            await expect(
                share(region('blocked'), 'read', { appUid: app.uid }),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'recipient_not_accepting_shares',
            });
            const listed =
                await state.env.server.services.kvShare.listKvHandles(
                    state.owner.actor,
                    { limit: 200 },
                );
            expect(
                listed.items.filter((row) => row.appUid === app.uid),
            ).toEqual([]);
        } finally {
            await state.env.server.stores.userBlock.deleteByPair(
                state.guest.id,
                state.owner.id,
            );
        }
    });

    it('refuse a share when the recipient refuses everyone', async () => {
        await state.env.server.stores.user.updateMetadata(state.guest.id, {
            blockAllShares: true,
        });
        try {
            await expect(share(region('all'), 'watch')).rejects.toMatchObject({
                legacyCode: 'recipient_not_accepting_shares',
            });
        } finally {
            await state.env.server.stores.user.updateMetadata(state.guest.id, {
                blockAllShares: false,
            });
        }
    });

    it('leave a share made before the block to be narrowed, its label cleared, and revoked', async () => {
        const app = await makeApp();
        const prefix = region('before');
        const { handle } = await share(prefix, 'write', {
            appUid: app.uid,
            label: 'Before',
        });
        await state.env.server.stores.userBlock.create(
            state.guest.id,
            state.owner.id,
        );
        try {
            await expect(
                share(prefix, 'read', { appUid: app.uid, label: null }),
            ).resolves.toMatchObject({
                handle,
                access: 'read',
                label: null,
            });
            await expect(
                state.env.server.services.kvShare.removeKvShare(
                    state.owner.actor,
                    handle,
                ),
            ).resolves.toMatchObject({ handle });
            // Still only the notification from before the block.
            expect(await notificationsFor(handle)).toHaveLength(1);
        } finally {
            await state.env.server.stores.userBlock.deleteByPair(
                state.guest.id,
                state.owner.id,
            );
        }
    });

    it.each([
        ['a raised level', { access: 'write' as const }],
        ['a new label', { label: 'Later' }],
        [
            'a lower level with a new label',
            { access: 'watch' as const, label: 'Later' },
        ],
    ])('refuse %s on a share made before the block', async (_name, change) => {
        const app = await makeApp();
        const prefix = region('raise');
        const { handle } = await share(prefix, 'read', { appUid: app.uid });
        await state.env.server.stores.userBlock.create(
            state.guest.id,
            state.owner.id,
        );
        try {
            await expect(
                share(prefix, 'access' in change ? change.access : 'read', {
                    appUid: app.uid,
                    ...('label' in change ? { label: change.label } : {}),
                }),
            ).rejects.toMatchObject({
                legacyCode: 'recipient_not_accepting_shares',
            });
            const row =
                await state.env.server.stores.kvShareHandle.getByHandle(handle);
            expect(row).toMatchObject({ revokedAt: null, label: null });
            expect(row?.permission.startsWith('kv-share-read:')).toBe(true);
        } finally {
            await state.env.server.stores.userBlock.deleteByPair(
                state.guest.id,
                state.owner.id,
            );
        }
    });
});
