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
 * The subscription lifecycle hands schedules' rows, and only theirs, to
 * `services.schedules` with the change each path made. Without it every path
 * still runs.
 */

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
import type {
    ScheduleServiceContract,
    ScheduleSubscriptionChange,
} from '../../core/schedules.js';
import type { PuterServer } from '../../server.js';
import type { DurableSubscriptionInput } from '../../stores/events/DurableSubscriptionStore.js';
import {
    isScheduleRow,
    scheduleToken,
    type DurableSubscription,
} from '../../stores/events/types.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';

const BOOT_TIMEOUT_MS = 120_000;
const APP_UID = 'app-seam';

let server: PuterServer;
let userId: number;
let anchorUid: string;
let anchorPath: string;
let saved: unknown;

const durable = () => server.stores.durableSubscription;
const slot = () => server.services as unknown as { schedules?: unknown };
/** Put `schedules` in the slot, or leave the slot empty. */
const setSchedules = (schedules: unknown): void => {
    if (schedules === undefined) delete slot().schedules;
    else slot().schedules = schedules;
};

const recording = () => {
    const calls: Array<{
        subIds: string[];
        change: ScheduleSubscriptionChange;
    }> = [];
    const schedules = {
        onSubscriptionsChanged: vi.fn(
            async (
                rows: readonly DurableSubscription[],
                change: ScheduleSubscriptionChange,
            ) => {
                calls.push({ subIds: rows.map((r) => r.subId), change });
            },
        ),
        createFor: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        receivePeerChanges: vi.fn(),
        prepareSendAt: vi.fn(),
        createDeferredAppMessage: vi.fn(),
    } satisfies ScheduleServiceContract;
    setSchedules(schedules);
    return calls;
};

const plainRow = async (
    over: Partial<DurableSubscriptionInput> = {},
): Promise<DurableSubscription> =>
    (
        await durable().create({
            holderUserId: userId,
            ownerUserId: userId,
            appUid: APP_UID,
            subject: `fs:${anchorPath}`,
            token: `f#${anchorUid}`,
            anchorUid,
            anchorPath,
            match: null,
            op: null,
            delivery: 'broadcast',
            handlerName: 'onWrite',
            context: null,
            permission: 'list',
            expiresAt: null,
            ...over,
        })
    ).row;

const scheduleRow = async (
    over: Partial<DurableSubscriptionInput> = {},
): Promise<DurableSubscription> => {
    const uid = uuidv4();
    return plainRow({
        subject: scheduleToken(uid),
        token: scheduleToken(uid),
        anchorUid: uid,
        anchorPath: '',
        delivery: 'single',
        handlerName: 'tick',
        permission: 'events:background',
        ...over,
    });
};

const pendingCalls = () => {
    const pending = server.stores.pendingDelivery;
    return [
        vi.spyOn(pending, 'purge'),
        vi.spyOn(pending, 'hold'),
        vi.spyOn(pending, 'releaseHold'),
    ];
};

beforeAll(async () => {
    server = await setupTestServer({ events: { enabled: true } } as IConfig);
    const username = `seam-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
    });
    userId = user.id;
    anchorPath = `/${username}/seam`;
    await server.services.fs.mkdir(userId, {
        path: anchorPath,
        createMissingParents: true,
    });
    anchorUid = (await server.stores.fsEntry.getEntryByPath(anchorPath))!.uid;
    saved = slot().schedules;
}, BOOT_TIMEOUT_MS);

beforeEach(async () => {
    await server.clients.db.write('DELETE FROM `event_subscriptions`', []);
});

afterEach(() => {
    setSchedules(saved);
    vi.restoreAllMocks();
});

afterAll(async () => {
    await server?.shutdown();
});

describe('the schedules lifecycle hook', () => {
    it('gets only schedule rows on a suspend, and their backlog is never touched', async () => {
        const calls = recording();
        const schedule = await scheduleRow();
        const plain = await plainRow();
        const [purge, hold, releaseHold] = pendingCalls();

        await server.services.events.suspendSubscriptions(
            [schedule],
            'no_credit',
        );
        expect(calls).toEqual([
            {
                subIds: [schedule.subId],
                change: { type: 'suspended', reason: 'no_credit' },
            },
        ]);
        expect(purge).not.toHaveBeenCalled();
        expect(hold).not.toHaveBeenCalled();

        calls.length = 0;
        await server.services.events.suspendSubscriptions([plain], 'no_credit');
        expect(calls).toEqual([]);

        calls.length = 0;
        const suspended = (await durable().getBySubId(schedule.subId))!;
        await server.services.events.resumeSubscriptions([suspended]);
        expect(calls).toEqual([
            { subIds: [schedule.subId], change: { type: 'resumed' } },
        ]);
        expect(releaseHold).not.toHaveBeenCalled();
    });

    it('ends schedules uninstalled when every grant to the app goes', async () => {
        const calls = recording();
        const schedule = await scheduleRow();
        await plainRow();

        await server.services.events.settleRevokedGrant({
            holderUserId: userId,
            appUid: APP_UID,
            permission: null,
        });
        expect(calls).toEqual([
            {
                subIds: [schedule.subId],
                change: {
                    type: 'suspended',
                    reason: 'permission_revoked',
                    endReason: 'uninstalled',
                },
            },
        ]);
    });

    it('reads no schedule rows to settle a specific grant, and still settles them when consent goes', async () => {
        const calls = recording();
        const schedule = await scheduleRow();
        const plain = await plainRow();
        const page = vi.spyOn(durable(), 'listActiveForHolderPage');
        const readSubIds = async () =>
            (await Promise.all(page.mock.results.map((r) => r.value))).flatMap(
                (p) => p.rows.map((row: DurableSubscription) => row.subId),
            );

        await server.services.events.settleRevokedGrant({
            holderUserId: userId,
            appUid: APP_UID,
            permission: `fs:${anchorUid}:list`,
        });
        const read = await readSubIds();
        expect(read).toContain(plain.subId);
        expect(read).not.toContain(schedule.subId);
        expect(calls).toEqual([]);

        page.mockClear();
        await server.services.events.settleRevokedGrant({
            holderUserId: userId,
            appUid: APP_UID,
            permission: EVENTS_BACKGROUND_PERMISSION,
        });
        expect(await readSubIds()).toContain(schedule.subId);
        expect(calls).toEqual([
            {
                subIds: [schedule.subId],
                change: { type: 'suspended', reason: 'permission_revoked' },
            },
        ]);
    });

    it('tells the holder once per kind when an uninstall settles several pages', async () => {
        recording();
        const plains = [await plainRow(), await plainRow(), await plainRow()];
        const schedules = [await scheduleRow(), await scheduleRow()];
        const store = durable();
        const listPage = store.listActiveForHolderPage.bind(store);
        vi.spyOn(store, 'listActiveForHolderPage').mockImplementation(
            (holder, app, afterId, _batchSize, opts) =>
                listPage(holder, app, afterId, 1, opts),
        );
        const notify = vi.spyOn(server.services.notification, 'notify');

        await expect(
            server.services.events.settleRevokedGrant({
                holderUserId: userId,
                appUid: APP_UID,
                permission: null,
            }),
        ).resolves.toBe(5);
        const ended = notify.mock.calls
            .filter(([, , meta]) => meta?.type === 'app.events.ended')
            .map(([, body]) => body as { count: number; subjects: string[] });
        expect(ended).toHaveLength(2);
        expect(ended.map((body) => body.count).sort()).toEqual([2, 3]);
        expect(ended.flatMap((body) => body.subjects).sort()).toEqual(
            [...plains, ...schedules].map((row) => row.subject).sort(),
        );
    });

    it('ends schedules app_deleted when their app is deleted', async () => {
        const calls = recording();
        const schedule = await scheduleRow();
        await plainRow();

        await server.services.events.settleDeletedApp(APP_UID);
        expect(calls).toEqual([
            {
                subIds: [schedule.subId],
                change: { type: 'ended', endReason: 'app_deleted' },
            },
        ]);
    });

    it('ends schedules whose rows expire', async () => {
        const calls = recording();
        const schedule = await scheduleRow({ expiresAt: 1 });
        await plainRow({ expiresAt: 1 });

        await server.services.events.sweepExpired();
        const handed = calls.flatMap((c) => c.subIds);
        expect(handed).toEqual([schedule.subId]);
        expect(calls[0].change).toEqual({ type: 'ended', endReason: 'ended' });
    });

    it('lets every path run without services.schedules', async () => {
        setSchedules(undefined);
        const schedule = await scheduleRow();
        await plainRow();

        await expect(
            server.services.events.suspendSubscriptions(
                [schedule],
                'no_credit',
            ),
        ).resolves.toBe(1);
        await expect(
            server.services.events.resumeSubscriptions([
                (await durable().getBySubId(schedule.subId))!,
            ]),
        ).resolves.toBe(1);
        await server.services.events.settleDeletedApp(APP_UID);
        const left = await server.clients.db.read(
            'SELECT `token` FROM `event_subscriptions`',
            [],
        );
        expect(
            left.filter((r) => isScheduleRow(r as { token: string })),
        ).toEqual([]);
    });
});
