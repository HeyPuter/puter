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
 * The schedule table against a real database: the create order, caps and the
 * race between creates, the version every write bumps, and the reads a
 * reconcile pages through.
 */

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EVENTS_SCHEDULE_TOMBSTONE_TTL_MS } from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import {
    isScheduleOrphan,
    SCHEDULE_ORPHAN_AGE_MS,
    type ScheduleInput,
    type ScheduleQuota,
} from './ScheduleStore.js';
import { scheduleToken } from './types.js';

const NS = 'test.example';
const REGION = 'region-a';
const HOUR = 60 * 60 * 1000;

let server: PuterServer;
let userId: number;
let appUid: string;

const store = () => server.stores.schedule;
const durable = () => server.stores.durableSubscription;
const db = () => server.clients.db;

const roomy: ScheduleQuota = {
    recurringPerUser: 1000,
    recurringPerApp: 100,
    oneShotsPerUser: 5000,
    oneShotsPerApp: 1000,
    budgetPerUser: 18_000_000,
    budgetPerApp: 1_800_000,
};

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
    namespace: NS,
    region: REGION,
    kind: 'recurring',
    holderUserId: userId,
    appUid,
    startAt: Date.parse('2026-11-02T00:00:00Z'),
    everyMs: HOUR,
    cron: null,
    tz: 'UTC',
    endsAt: null,
    ratePerHour: 1000,
    minGapMs: HOUR,
    handlerDepth: 0,
    subscription: {
        handlerName: 'tick',
        context: '{"team":"design"}',
        permission: 'events:background',
    },
    quota: roomy,
    ...over,
});

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
    try {
        await run;
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const [row] = await db().read(sql, params);
    return Number(row?.n ?? 0);
};

const scheduleRows = () => count('SELECT COUNT(*) AS n FROM `event_schedules`');
const scheduleSubRows = () =>
    count(
        "SELECT COUNT(*) AS n FROM `event_subscriptions` WHERE `token` LIKE 'schedule:%'",
    );

const newUser = async (): Promise<number> => {
    const created = await server.stores.user.create({
        username: `sched_${uuidv4().slice(0, 8)}`,
        uuid: uuidv4(),
        password: null,
        email: null,
    });
    return created.id;
};

beforeAll(async () => {
    server = await setupTestServer();
    userId = await newUser();
}, 120_000);

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(async () => {
    appUid = `app-${uuidv4()}`;
    await db().write('DELETE FROM `event_schedules`', []);
    await db().write('DELETE FROM `event_subscriptions`', []);
});

describe('creating a schedule', () => {
    it('writes the schedule row, then its subscription row, then links them', async () => {
        const row = await store().create(input());

        expect(row).toMatchObject({
            namespace: NS,
            region: REGION,
            kind: 'recurring',
            holderUserId: userId,
            appUid,
            everyMs: HOUR,
            state: 'active',
            deletedAt: null,
            endReason: null,
            // Insert, then the update that links the subscription row.
            version: 2,
        });
        expect(row.createdAt).toBeLessThanOrEqual(row.updatedAt);

        const sub = await durable().getBySubId(row.subId!);
        expect(sub).toMatchObject({
            token: scheduleToken(row.uid),
            subject: scheduleToken(row.uid),
            anchorUid: row.uid,
            anchorPath: '',
            holderUserId: userId,
            ownerUserId: userId,
            appUid,
            delivery: 'single',
            permission: 'events:background',
            handlerName: 'tick',
            context: '{"team":"design"}',
            expiresAt: null,
        });
    });

    it('inserts the schedule unlinked, then the subscription row, then links them', async () => {
        const steps: string[] = [];
        const realInsert = db().insert.bind(db());
        const realWrite = db().write.bind(db());
        const insert = vi
            .spyOn(db(), 'insert')
            .mockImplementation(async (table, data) => {
                steps.push(
                    table === 'event_schedules'
                        ? `insert ${table} sub_id=${String(data.sub_id)}`
                        : `insert ${table}`,
                );
                return realInsert(table, data);
            });
        const write = vi
            .spyOn(db(), 'write')
            .mockImplementation(async (sql, params) => {
                if (/UPDATE `event_schedules` SET `sub_id`/.test(sql))
                    steps.push('link event_schedules');
                return realWrite(sql, params);
            });
        try {
            await store().create(input());
        } finally {
            insert.mockRestore();
            write.mockRestore();
        }
        expect(steps).toEqual([
            'insert event_schedules sub_id=null',
            'insert event_subscriptions',
            'link event_schedules',
        ]);
    });

    it('stores a `once` one-shot ending at its start, with no rate or gap', async () => {
        const at = Date.parse('2026-11-05T10:00:00Z');
        const row = await store().create(
            input({
                kind: 'once',
                startAt: at,
                everyMs: null,
                endsAt: null,
                ratePerHour: 1000,
                minGapMs: HOUR,
            }),
        );
        expect(row).toMatchObject({
            kind: 'once',
            startAt: at,
            endsAt: at,
            ratePerHour: 0,
            minGapMs: null,
        });
        expect(row.subId).not.toBeNull();
    });

    it('gives a deferred row no subscription row', async () => {
        const at = Date.parse('2026-11-05T10:00:00Z');
        const row = await store().create(
            input({
                kind: 'deferred',
                startAt: at,
                everyMs: null,
                subscription: undefined,
                action: 'notifications.appMessage',
                payload: '{"message":{"title":"hi"}}',
            }),
        );
        expect(row).toMatchObject({
            kind: 'deferred',
            subId: null,
            version: 1,
            endsAt: at,
            action: 'notifications.appMessage',
            payload: '{"message":{"title":"hi"}}',
        });
        await expect(scheduleSubRows()).resolves.toBe(0);
    });

    it('leaves nothing behind when the subscription row is refused', async () => {
        await expect(
            codeOf(
                store().create(
                    input({
                        subscription: {
                            handlerName: 'tick',
                            context: JSON.stringify({ x: 'y'.repeat(5000) }),
                            permission: 'events:background',
                        },
                    }),
                ),
            ),
        ).resolves.toBe('events_context_too_large');
        await expect(scheduleRows()).resolves.toBe(0);
        await expect(scheduleSubRows()).resolves.toBe(0);
    });
});

describe('caps', () => {
    it('refuses a recurring schedule past the per-app cap', async () => {
        const quota = { ...roomy, recurringPerApp: 2 };
        await store().create(input({ quota }));
        await store().create(input({ quota }));
        await expect(codeOf(store().create(input({ quota })))).resolves.toBe(
            'events_schedule_limit',
        );
        // Another app of the same account still has room.
        await store().create(input({ quota, appUid: `app-${uuidv4()}` }));
        await expect(scheduleRows()).resolves.toBe(3);
        await expect(scheduleSubRows()).resolves.toBe(3);
    });

    it('refuses a recurring schedule past the per-account cap', async () => {
        const quota = { ...roomy, recurringPerUser: 1 };
        await store().create(input({ quota }));
        await expect(
            codeOf(store().create(input({ quota, appUid: `app-${uuidv4()}` }))),
        ).resolves.toBe('events_schedule_limit');
    });

    it('counts once and deferred rows against the one-shot caps only', async () => {
        const quota = { ...roomy, recurringPerApp: 1, oneShotsPerApp: 2 };
        const at = Date.parse('2026-11-05T10:00:00Z');
        const oneShot = { startAt: at, everyMs: null, quota };
        await store().create(input({ ...oneShot, kind: 'once' }));
        await store().create(
            input({
                ...oneShot,
                kind: 'deferred',
                subscription: undefined,
                action: 'notifications.appMessage',
                payload: '{}',
            }),
        );
        await expect(
            codeOf(store().create(input({ ...oneShot, kind: 'once' }))),
        ).resolves.toBe('events_schedule_limit');
        // The recurring cap and the budget never saw them.
        await store().create(input({ quota }));
        const usage = await store().usageForHolder(userId, appUid);
        expect(usage).toEqual({
            recurring: { total: 1, forApp: 1 },
            oneShots: { total: 2, forApp: 2 },
            rate: { total: 1000, forApp: 1000 },
        });
    });

    it('refuses a schedule that would exceed the fire budget', async () => {
        const quota = { ...roomy, budgetPerApp: 2500 };
        await store().create(input({ quota, ratePerHour: 2000 }));
        await expect(
            codeOf(store().create(input({ quota, ratePerHour: 1000 }))),
        ).resolves.toBe('events_schedule_budget');
        await store().create(input({ quota, ratePerHour: 500 }));
    });

    it('sums the budget over live recurring rows only', async () => {
        const live = await store().create(input({ ratePerHour: 1000 }));
        const ended = await store().create(input({ ratePerHour: 4000 }));
        await store().end([ended], 'removed');
        const usage = await store().usageForHolder(userId, appUid);
        expect(usage.rate).toEqual({ total: 1000, forApp: 1000 });
        expect(usage.recurring.total).toBe(1);
        expect(live.deletedAt).toBeNull();
    });

    it('never lets racing creates end up past the cap', async () => {
        const quota = { ...roomy, recurringPerApp: 3 };
        const results = await Promise.allSettled(
            Array.from({ length: 8 }, () => store().create(input({ quota }))),
        );
        const made = results.filter((r) => r.status === 'fulfilled').length;
        const refused = results.filter((r) => r.status === 'rejected');
        // At the last slots a race may refuse more than it had to, never
        // fewer.
        expect(made).toBeLessThanOrEqual(3);
        for (const r of refused)
            expect(
                isHttpError((r as PromiseRejectedResult).reason) &&
                    (r as PromiseRejectedResult).reason.legacyCode,
            ).toBe('events_schedule_limit');
        // The losers took their subscription rows with them.
        await expect(scheduleRows()).resolves.toBe(made);
        await expect(scheduleSubRows()).resolves.toBe(made);
        // Nothing they left holds a slot.
        for (let i = made; i < 3; i++) await store().create(input({ quota }));
        await expect(codeOf(store().create(input({ quota })))).resolves.toBe(
            'events_schedule_limit',
        );
    });
});

describe('versions', () => {
    it('bumps on every update', async () => {
        const row = await store().create(input());
        expect(row.version).toBe(2);

        const [suspended] = await store().applySubscriptionChange(
            NS,
            [row.subId!],
            null,
        );
        expect(suspended.version).toBe(3);
        expect(suspended.deletedAt).toBeNull();

        const [ended] = await store().end([row], 'removed');
        expect(ended).toMatchObject({
            version: 4,
            state: 'done',
            endReason: 'removed',
        });
        expect(ended.deletedAt).not.toBeNull();
    });

    it('keeps the first end reason of a row already ended', async () => {
        const row = await store().create(input());
        await store().end([row], 'removed');
        const [again] = await store().applySubscriptionChange(
            NS,
            [row.subId!],
            { reason: 'ended' },
        );
        expect(again).toMatchObject({ endReason: 'removed', version: 3 });
    });

    it('touches only its own namespace', async () => {
        const row = await store().create(input());
        await expect(
            store().applySubscriptionChange('elsewhere', [row.subId!], null),
        ).resolves.toEqual([]);
        await expect(store().get(NS, row.uid)).resolves.toMatchObject({
            version: 2,
        });
    });
});

describe('reading changes for a reconcile', () => {
    const setUpdatedAt = (id: number, updatedAt: number) =>
        db().write(
            'UPDATE `event_schedules` SET `updated_at` = ? WHERE `id` = ?',
            [updatedAt, id],
        );

    it('pages by (updated_at, id) and resumes from the last row it returned', async () => {
        const a = await store().create(input());
        const b = await store().create(input());
        const c = await store().create(input());
        // Two rows in the same millisecond still page apart, by id.
        await setUpdatedAt(a.id, 5_000);
        await setUpdatedAt(b.id, 5_000);
        await setUpdatedAt(c.id, 7_000);

        const first = await store().changedSince(
            NS,
            REGION,
            { updatedAt: 0, id: 0 },
            2,
        );
        expect(first.rows.map((r) => r.id)).toEqual([a.id, b.id]);
        expect(first.last).toEqual({ updatedAt: 5_000, id: b.id });
        expect(first.more).toBe(true);

        const second = await store().changedSince(NS, REGION, first.last!, 2);
        expect(second.rows.map((r) => r.id)).toEqual([c.id]);
        expect(second.last).toEqual({ updatedAt: 7_000, id: c.id });
        expect(second.more).toBe(false);

        await expect(
            store().changedSince(NS, REGION, second.last!, 2),
        ).resolves.toEqual({ rows: [], last: null, more: false });
    });

    it('reads each row with its subscription row', async () => {
        const row = await store().create(input());
        const [read] = (
            await store().changedSince(NS, REGION, { updatedAt: 0, id: 0 }, 10)
        ).rows;
        expect(read.sub).toEqual({
            suspendedAt: null,
            suspendedReason: null,
            handlerName: 'tick',
            context: '{"team":"design"}',
        });
        expect(read.uid).toBe(row.uid);
    });

    it('keeps namespaces and regions apart', async () => {
        const mine = await store().create(input());
        await store().create(input({ namespace: 'other.example' }));
        await store().create(input({ region: 'region-b' }));

        const changed = await store().changedSince(
            NS,
            REGION,
            { updatedAt: 0, id: 0 },
            10,
        );
        expect(changed.rows.map((r) => r.id)).toEqual([mine.id]);
        const page = await store().listRegionPage(NS, REGION, 0, 10);
        expect(page.rows.map((r) => r.id)).toEqual([mine.id]);
        await expect(
            store().get('other.example', mine.uid),
        ).resolves.toBeNull();
    });

    it('includes ended rows, which a reconcile turns into tombstones', async () => {
        const row = await store().create(input());
        await store().end([row], 'removed');
        const changed = await store().changedSince(
            NS,
            REGION,
            { updatedAt: 0, id: 0 },
            10,
        );
        expect(changed.rows[0]).toMatchObject({
            id: row.id,
            state: 'done',
            endReason: 'removed',
        });
    });

    it('pages a whole region by id', async () => {
        const ids: number[] = [];
        for (let i = 0; i < 5; i++)
            ids.push((await store().create(input())).id);
        const first = await store().listRegionPage(NS, REGION, 0, 3);
        expect(first.rows.map((r) => r.id)).toEqual(ids.slice(0, 3));
        expect(first.nextId).toBe(ids[2]);
        const second = await store().listRegionPage(
            NS,
            REGION,
            first.nextId!,
            3,
        );
        expect(second.rows.map((r) => r.id)).toEqual(ids.slice(3));
        expect(second.nextId).toBeNull();
    });
});

describe('orphans', () => {
    it('ends a row whose subscription row never landed, once it is old enough', async () => {
        const row = await store().create(input());
        // What a crash between the two inserts leaves.
        await durable().removeScheduleSubscription(row.uid);
        const [read] = (await store().listRegionPage(NS, REGION, 0, 10)).rows;
        expect(read.sub).toBeNull();
        expect(isScheduleOrphan(read, read.updatedAt + 60_000)).toBe(false);
        expect(
            isScheduleOrphan(read, read.updatedAt + SCHEDULE_ORPHAN_AGE_MS),
        ).toBe(true);

        const ended = await store().endOrphan(read);
        expect(ended).toMatchObject({ state: 'done', endReason: 'orphaned' });
    });

    it('deletes a subscription row the schedule never pointed at', async () => {
        const row = await store().create(input());
        await db().write(
            'UPDATE `event_schedules` SET `sub_id` = NULL WHERE `id` = ?',
            [row.id],
        );
        const [read] = (await store().listRegionPage(NS, REGION, 0, 10)).rows;
        expect(read.sub).toBeNull();
        await store().endOrphan(read);
        await expect(scheduleSubRows()).resolves.toBe(0);
    });

    it('never calls a deferred row an orphan', async () => {
        await store().create(
            input({
                kind: 'deferred',
                everyMs: null,
                subscription: undefined,
                action: 'notifications.appMessage',
                payload: '{}',
            }),
        );
        const [read] = (await store().listRegionPage(NS, REGION, 0, 10)).rows;
        expect(
            isScheduleOrphan(read, Date.now() + 2 * SCHEDULE_ORPHAN_AGE_MS),
        ).toBe(false);
    });
});

describe('listing a holder`s schedules', () => {
    it('pages with a cursor and a total, scoped to one app when asked', async () => {
        const mine: string[] = [];
        for (let i = 0; i < 3; i++)
            mine.push((await store().create(input())).uid);
        await store().create(input({ appUid: `app-${uuidv4()}` }));

        const first = await store().listForHolder(NS, userId, {
            appUid,
            limit: 2,
            includeTotal: true,
        });
        expect(first.items.map((r) => r.uid)).toEqual(mine.slice(0, 2));
        expect(first.total).toBe(3);
        expect(first.cursor).toBeDefined();

        const second = await store().listForHolder(NS, userId, {
            appUid,
            limit: 2,
            cursor: first.cursor,
        });
        expect(second.items.map((r) => r.uid)).toEqual(mine.slice(2));
        expect(second.cursor).toBeUndefined();

        const all = await store().listForHolder(NS, userId, {
            includeTotal: true,
        });
        expect(all.total).toBe(4);
    });

    it('shows an ended schedule for a week, with why it ended', async () => {
        const row = await store().create(input());
        await store().end([row], 'app_deleted');
        const listed = await store().listForHolder(NS, userId, { appUid });
        expect(listed.items).toEqual([
            expect.objectContaining({ uid: row.uid, endReason: 'app_deleted' }),
        ]);

        await db().write(
            'UPDATE `event_schedules` SET `deleted_at` = ? WHERE `id` = ?',
            [Date.now() - EVENTS_SCHEDULE_TOMBSTONE_TTL_MS - 1, row.id],
        );
        await expect(
            store().listForHolder(NS, userId, { appUid }),
        ).resolves.toEqual({ items: [] });
    });
});

describe('deleting the holder', () => {
    it('takes the holder`s schedules with them', async () => {
        const holder = await newUser();
        await store().create(input({ holderUserId: holder }));
        await expect(scheduleRows()).resolves.toBe(1);
        await db().write('DELETE FROM `user` WHERE `id` = ?', [holder]);
        await expect(scheduleRows()).resolves.toBe(0);
        await expect(scheduleSubRows()).resolves.toBe(0);
    });
});

describe('the reconcile read', () => {
    it('starts its index range at the cursor rather than at the region`s first row', async () => {
        // The plan is sqlite's; the indexes are the same on every engine.
        if (db().engineName !== 'sqlite') return;
        await store().create(input());
        const read = vi.spyOn(db(), 'read');
        let call: [string, unknown[]] | undefined;
        try {
            await store().changedSince(
                NS,
                REGION,
                { updatedAt: 5_000, id: 0 },
                10,
            );
            const found = read.mock.calls.find(([sql]) =>
                /FROM `event_schedules` s LEFT JOIN/.test(String(sql)),
            );
            call = found && [String(found[0]), found[1] as unknown[]];
        } finally {
            read.mockRestore();
        }
        expect(call).toBeDefined();
        const plan = await db().read(
            `EXPLAIN QUERY PLAN ${call![0]}`,
            call![1],
        );
        const detail = plan.map((row) => String(row.detail)).join('\n');
        expect(detail).toMatch(/updated_at>/);
        expect(detail).not.toMatch(/TEMP B-TREE/);
    });
});

describe('the holder listing', () => {
    it('pages on an index rather than sorting the holder`s rows', async () => {
        // The plan is sqlite's; the indexes are the same on every engine.
        if (db().engineName !== 'sqlite') return;
        await store().create(input());
        const read = vi.spyOn(db(), 'read');
        try {
            await store().listForHolder(NS, userId, { limit: 2 });
            await store().listForHolder(NS, userId, { appUid, limit: 2 });
        } catch (err) {
            read.mockRestore();
            throw err;
        }
        const listings = read.mock.calls.filter(([sql]) =>
            /FROM `event_schedules` s LEFT JOIN .* WHERE s\.`holder_user_id`/.test(
                String(sql),
            ),
        );
        read.mockRestore();
        expect(listings).toHaveLength(2);
        for (const [sql, params] of listings) {
            const plan = await db().read(
                `EXPLAIN QUERY PLAN ${String(sql)}`,
                params as unknown[],
            );
            const detail = plan.map((row) => String(row.detail)).join('\n');
            expect(detail).not.toMatch(/TEMP B-TREE/);
        }
    });
});
