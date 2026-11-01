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
 * The table and the region cache in front of it, against a real database. What
 * is on the hook here is that the two never disagree — a row that exists is
 * cached, a row that goes is uncached, and a region that has not looked knows
 * it has not looked.
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
import {
    EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
    EVENTS_REVOKED_SUBSCRIPTIONS_KEPT,
} from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENT_SUBSCRIPTION_WIDTHS } from './columnWidths.js';
import type { DurableSubscriptionInput } from './DurableSubscriptionStore.js';
import { scheduleToken } from './types.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let userId: number;
let otherUserId: number;
let anchorUid: string;
let anchorPath: string;

const durable = () => env.server.stores.durableSubscription;
const cache = () => env.server.stores.eventSubscription;

const token = () => `f#${anchorUid}`;

const input = (
    over: Partial<DurableSubscriptionInput> = {},
): DurableSubscriptionInput => ({
    holderUserId: userId,
    ownerUserId: userId,
    appUid: null,
    subject: `fs:${anchorPath}`,
    token: token(),
    anchorUid,
    anchorPath,
    match: null,
    op: null,
    delivery: 'broadcast',
    handlerName: null,
    context: null,
    permission: 'list',
    expiresAt: null,
    ...over,
});

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

type GuardedColumn = keyof typeof EVENT_SUBSCRIPTION_WIDTHS;

const atWidth = (column: GuardedColumn): string =>
    'a'.repeat(EVENT_SUBSCRIPTION_WIDTHS[column].max);

const overWidth = (column: GuardedColumn): string =>
    'a'.repeat(EVENT_SUBSCRIPTION_WIDTHS[column].max + 1);

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    const other = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    otherUserId = other!.id;

    anchorPath = `/${env.users.user.username}/durable-store`;
    await env.server.services.fs.mkdir(userId, {
        path: anchorPath,
        createMissingParents: true,
    });
    const entry = await env.server.stores.fsEntry.getEntryByPath(anchorPath);
    anchorUid = entry!.uid;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    await cache().markRegionCold(userId);
    await cache().rebuildDurable(userId, []);
});

describe('creating a subscription', () => {
    it('round-trips the row and names it after the app that made it', async () => {
        const appUid = `app-${uuidv4()}`;
        const { row } = await durable().create(
            input({
                appUid,
                handlerName: 'onWrite',
                match: '*.txt',
            }),
        );

        expect(row.subId.startsWith(`${appUid}#`)).toBe(true);
        await expect(durable().getBySubId(row.subId)).resolves.toMatchObject({
            subId: row.subId,
            appUid,
            handlerName: 'onWrite',
            match: '*.txt',
            delivery: 'broadcast',
            durable: true,
        });
    });

    it('writes the legacy targets column and never reads it back', async () => {
        const appUid = `app-${uuidv4()}`;
        const { row: appRow } = await durable().create(input({ appUid }));
        const { row: accountRow } = await durable().create(input());

        const stored = async (subId: string) => {
            const [raw] = await env.server.clients.db.read(
                'SELECT `targets` FROM `event_subscriptions` WHERE `sub_id` = ?',
                [subId],
            );
            const value = (raw as { targets: unknown }).targets;
            return typeof value === 'string' ? JSON.parse(value) : value;
        };
        await expect(stored(appRow.subId)).resolves.toEqual([
            'socket',
            'worker',
        ]);
        await expect(stored(accountRow.subId)).resolves.toEqual(['socket']);
        expect(
            (await durable().getBySubId(appRow.subId)) as unknown as Record<
                string,
                unknown
            >,
        ).not.toHaveProperty('targets');
    });

    it('reads any stored delivery other than `single` as a broadcast', async () => {
        const { row } = await durable().create(input());
        await env.server.clients.db.write(
            'UPDATE `event_subscriptions` SET `delivery` = ? WHERE `sub_id` = ?',
            ['fanout', row.subId],
        );
        await expect(durable().getBySubId(row.subId)).resolves.toMatchObject({
            delivery: 'broadcast',
        });
    });

    it('remembers whether deliveries carry the value, off by default', async () => {
        const { row: asking } = await durable().create(
            input({ includeValue: true }),
        );
        const { row: silent } = await durable().create(input());

        await expect(durable().getBySubId(asking.subId)).resolves.toMatchObject(
            { includeValue: true },
        );
        await expect(
            durable().getBySubId(silent.subId),
        ).resolves.not.toHaveProperty('includeValue');
    });

    it('names a session`s row for the account, not an app', async () => {
        const { row } = await durable().create(input());
        expect(row.subId.startsWith('user#')).toBe(true);
        expect(row.appUid).toBeNull();
    });

    it('caches the row and watches its token before returning', async () => {
        const { row } = await durable().create(input());

        await expect(cache().userHasAny(userId)).resolves.toBe(true);
        await expect(cache().watchedTokens(userId, [token()])).resolves.toEqual(
            [token()],
        );
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            row,
        ]);
        // The region has read the table, so nothing else has to.
        await expect(cache().isRegionWarm(userId)).resolves.toBe(true);
    });

    // A snapshot taken any earlier widens the window in which a concurrent
    // removal of the owner's other rows gets cached again.
    it('reads the rows it caches only once the recount is back', async () => {
        const db = env.server.clients.db;
        const realPread = db.pread.bind(db);
        let recounts = 0;
        let readBeforeRecount = false;
        const pread = vi
            .spyOn(db, 'pread')
            .mockImplementation(async (sql, ...rest) => {
                const text = String(sql);
                if (
                    text.includes(
                        '`owner_user_id` = ? AND `suspended_at` IS NULL',
                    ) &&
                    recounts < 2
                )
                    readBeforeRecount = true;
                const rows = await realPread(sql, ...rest);
                if (text.includes('AS `for_app`')) recounts++;
                return rows;
            });
        try {
            const { row } = await durable().create(input());
            expect(readBeforeRecount).toBe(false);
            await expect(
                cache().getForTokens(userId, [token()]),
            ).resolves.toEqual([row]);
        } finally {
            pread.mockRestore();
        }
    });

    it('indexes a shared anchor under its owner, not its subscriber', async () => {
        const { row, bump } = await durable().create(
            input({ holderUserId: otherUserId }),
        );

        expect(bump.userId).toBe(userId);
        expect(row.holderUserId).toBe(otherUserId);
        await expect(cache().userHasAny(otherUserId)).resolves.toBe(false);
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            row,
        ]);
    });

    it('advances the owner`s generation', async () => {
        const first = await durable().create(input());
        const second = await durable().create(input());
        expect(second.bump.generation).toBeGreaterThan(first.bump.generation);
    });
});

describe('validation at the row write', () => {
    it('refuses a context past the hard cap', async () => {
        await expect(
            durable().create(input({ context: 'x'.repeat(4097) })),
        ).rejects.toSatisfy(codeOf('events_context_too_large'));
        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            total: 0,
        });
    });

    it('accepts a context right up to it', async () => {
        const { row } = await durable().create(
            input({ context: 'x'.repeat(4096) }),
        );
        await expect(durable().getBySubId(row.subId)).resolves.toMatchObject({
            context: 'x'.repeat(4096),
        });
    });
});

describe('column-width guards at the row write', () => {
    it('accepts an `anchorUid` right at the column width', async () => {
        await expect(
            durable().create(input({ anchorUid: atWidth('anchorUid') })),
        ).resolves.toMatchObject({ row: { anchorUid: atWidth('anchorUid') } });
    });

    it('refuses an `anchorUid` one character over the column width', async () => {
        await expect(
            durable().create(input({ anchorUid: overWidth('anchorUid') })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            total: 0,
        });
    });

    it('accepts a `token` right at the column width', async () => {
        await expect(
            durable().create(input({ token: atWidth('token') })),
        ).resolves.toMatchObject({ row: { token: atWidth('token') } });
    });

    it('refuses a `token` one character over the column width', async () => {
        await expect(
            durable().create(input({ token: overWidth('token') })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });

    it('refuses a `subject` one character over the column width', async () => {
        await expect(
            durable().create(input({ subject: overWidth('subject') })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });

    it('refuses an `anchorPath` one character over the column width', async () => {
        await expect(
            durable().create(input({ anchorPath: overWidth('anchorPath') })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });

    it('refuses an over-long `anchorPath` on reanchor and leaves the row unchanged', async () => {
        const { row } = await durable().create(input());

        await expect(
            durable().reanchor(row, {
                token: 'f#reanchored',
                anchorUid,
                anchorPath: overWidth('anchorPath'),
                match: 'm',
                ownerUserId: userId,
            }),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));

        await expect(durable().getBySubId(row.subId)).resolves.toMatchObject({
            token: row.token,
            anchorUid: row.anchorUid,
            anchorPath: row.anchorPath,
        });
    });
});

describe('the per-account cap', () => {
    const fill = async (count: number, appUid: string | null = null) => {
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < count; i++)
            await env.server.clients.db.insert('event_subscriptions', {
                sub_id: `${appUid ?? 'user'}#filler-${i}`,
                token: token(),
                owner_user_id: userId,
                holder_user_id: userId,
                app_uid: appUid,
                subject: `fs:${anchorPath}`,
                anchor_uid: anchorUid,
                anchor_path: anchorPath,
                match: null,
                delivery: 'broadcast',
                ops: null,
                handler_name: null,
                targets: '["socket"]',
                context: null,
                permission: 'list',
                expires_at: null,
                created_at: now,
            });
    };

    it('refuses the one past the limit with a stable code', async () => {
        await fill(EVENTS_DURABLE_SUBSCRIPTIONS_MAX);

        await expect(durable().create(input())).rejects.toSatisfy(
            codeOf('events_subscription_limit'),
        );
    });

    it('holds a row to the caps its caller resolved from a plan', async () => {
        const appUid = `app-${uuidv4()}`;
        await fill(2, appUid);

        await expect(
            durable().create(
                input({ appUid, limits: { perUser: 10, perApp: 2 } }),
            ),
        ).rejects.toSatisfy(codeOf('events_subscription_limit'));

        // The app is full; the account it belongs to is not.
        await expect(
            durable().create(input({ limits: { perUser: 10, perApp: 2 } })),
        ).resolves.toMatchObject({ row: { appUid: null } });
    });

    it('never lets a resolved cap exceed the structural one', async () => {
        await fill(EVENTS_DURABLE_SUBSCRIPTIONS_MAX);

        await expect(
            durable().create(
                input({ limits: { perUser: 10_000, perApp: 10_000 } }),
            ),
        ).rejects.toSatisfy(codeOf('events_subscription_limit'));
    });

    it('never lets concurrent creates take more than the slots left', async () => {
        const limits = { perUser: 5, perApp: 5 };
        await fill(limits.perUser - 1);

        const outcomes = await Promise.allSettled(
            Array.from({ length: 6 }, () =>
                durable().create(input({ limits })),
            ),
        );

        const created = outcomes.filter(
            (outcome) => outcome.status === 'fulfilled',
        );
        expect(created.length).toBeLessThanOrEqual(1);
        for (const outcome of outcomes)
            if (outcome.status === 'rejected')
                expect(
                    codeOf('events_subscription_limit')(outcome.reason),
                ).toBe(true);
        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            total: limits.perUser - 1 + created.length,
        });
    });

    it('takes a row that lost the race back out of every cache it reached', async () => {
        const limits = { perUser: 1, perApp: 1 };

        const outcomes = await Promise.allSettled([
            durable().create(input({ limits })),
            durable().create(input({ limits })),
        ]);

        const kept = outcomes.flatMap((outcome) =>
            outcome.status === 'fulfilled' ? [outcome.value.row.subId] : [],
        );
        const rows = await cache().getForTokens(userId, [token()]);
        expect(rows.map((row) => row.subId)).toEqual(kept);
        for (const outcome of outcomes)
            if (outcome.status === 'rejected')
                expect(outcome.reason.bump).toMatchObject({ userId });
    });

    it('counts the holder, not the owner, and one app`s share of it', async () => {
        const appUid = `app-${uuidv4()}`;
        await durable().create(input({ holderUserId: otherUserId }));
        await durable().create(input({ appUid }));

        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            total: 1,
            forApp: 0,
        });
        await expect(
            durable().countForHolder(userId, appUid),
        ).resolves.toMatchObject({ total: 1, forApp: 1 });
        await expect(
            durable().countForHolder(otherUserId),
        ).resolves.toMatchObject({ total: 1 });
    });

    it('does not count a row that has expired but not yet been swept', async () => {
        await durable().create(
            input({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
        );
        await durable().create(input());
        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            total: 1,
        });
    });
});

describe('rows suspended for good', () => {
    /** Rows written straight to the table, suspended `reason` at `at`. */
    const seed = async (
        count: number,
        reason: string,
        opts: { appUid?: string | null; at?: (i: number) => number } = {},
    ) => {
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < count; i++)
            await env.server.clients.db.insert('event_subscriptions', {
                sub_id: `${opts.appUid ?? 'user'}#${reason}-${uuidv4()}`,
                token: token(),
                owner_user_id: userId,
                holder_user_id: userId,
                app_uid: opts.appUid ?? null,
                subject: `fs:${anchorPath}`,
                anchor_uid: anchorUid,
                anchor_path: anchorPath,
                match: null,
                delivery: 'broadcast',
                ops: null,
                handler_name: null,
                targets: '["socket"]',
                context: null,
                permission: 'list',
                expires_at: null,
                suspended_at: opts.at?.(i) ?? now,
                suspended_reason: reason,
                created_at: now,
            });
    };

    it('hold no slot, while rows that can resume keep theirs', async () => {
        const appUid = `app-${uuidv4()}`;
        await durable().create(input({ appUid }));
        await seed(3, 'permission_revoked', { appUid });
        await seed(1, 'handler_not_found', { appUid });
        await seed(1, 'failures');
        await seed(1, 'no_credit');

        await expect(durable().countForHolder(userId, appUid)).resolves.toEqual(
            { total: 4, forApp: 2, terminal: 3 },
        );
    });

    it('let a holder at the cap subscribe again, through the recount too', async () => {
        const limits = { perUser: 2, perApp: 2 };
        const first = await durable().create(input({ limits }));
        const second = await durable().create(input({ limits }));
        await durable().suspend([first.row, second.row], 'permission_revoked');

        await durable().create(input({ limits }));
        await durable().create(input({ limits }));
        await expect(durable().create(input({ limits }))).rejects.toSatisfy(
            codeOf('events_subscription_limit'),
        );
    });

    it('leave a resumable suspension holding its slot', async () => {
        const limits = { perUser: 1, perApp: 1 };
        const { row } = await durable().create(input({ limits }));
        await durable().suspend([row], 'failures');

        await expect(durable().create(input({ limits }))).rejects.toSatisfy(
            codeOf('events_subscription_limit'),
        );
    });

    it('are left out of what a revocation reads', async () => {
        const { row: live } = await durable().create(input());
        const { row: failing } = await durable().create(input());
        const { row: revoked } = await durable().create(input());
        await durable().suspend([failing], 'failures');
        await durable().suspend([revoked], 'permission_revoked');

        const { rows: held } = await durable().listActiveForHolderPage(
            userId,
            null,
            0,
            undefined,
            { includeSuspended: true },
        );
        expect(held.map((row) => row.subId).sort()).toEqual(
            [live.subId, failing.subId].sort(),
        );
    });

    it('are deleted oldest first once a holder keeps more than the limit', async () => {
        const base = Math.floor(Date.now() / 1000) - 10_000;
        await seed(
            EVENTS_REVOKED_SUBSCRIPTIONS_KEPT + 2,
            'permission_revoked',
            {
                at: (i) => base + i,
            },
        );

        await durable().create(input());

        await expect(durable().countForHolder(userId)).resolves.toEqual({
            total: 1,
            forApp: 0,
            terminal: EVENTS_REVOKED_SUBSCRIPTIONS_KEPT,
        });
        const [oldest] = await env.server.clients.db.pread(
            'SELECT MIN(`suspended_at`) AS `at` FROM `event_subscriptions` ' +
                'WHERE `suspended_reason` = ?',
            ['permission_revoked'],
        );
        expect(Number(oldest.at)).toBe(base + 2);
    });
});

describe('removal', () => {
    it('takes the row out of the table and the cache together', async () => {
        const { row } = await durable().create(input());

        await durable().remove(row);

        await expect(durable().getBySubId(row.subId)).resolves.toBeNull();
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual(
            [],
        );
        await expect(cache().userHasAny(userId)).resolves.toBe(false);
    });

    it('leaves a sibling on the same anchor watched', async () => {
        const { row } = await durable().create(input());
        const survivor = await durable().create(input());

        await durable().remove(row);

        await expect(cache().watchedTokens(userId, [token()])).resolves.toEqual(
            [token()],
        );
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            survivor.row,
        ]);
    });

    it('returns null and does not move the generation on a second remove', async () => {
        const { row } = await durable().create(input());
        const before = await cache().getGeneration(userId);

        const first = await durable().remove(row);
        expect(first).not.toBeNull();
        const afterFirst = await cache().getGeneration(userId);
        expect(afterFirst).toBeGreaterThan(before);

        const second = await durable().remove(row);
        expect(second).toBeNull();
        await expect(cache().getGeneration(userId)).resolves.toBe(afterFirst);
    });

    it('caches nothing and reports no bump when reanchor loses to a remove', async () => {
        const { row } = await durable().create(input());
        await durable().remove(row);

        const { bumps } = await durable().reanchor(row, {
            token: 'f#reanchored-after-remove',
            anchorUid,
            anchorPath,
            match: 'x',
            ownerUserId: userId,
        });

        expect(bumps).toEqual([]);
        await expect(
            cache().getForTokens(userId, ['f#reanchored-after-remove']),
        ).resolves.toEqual([]);
    });
});

describe('the holder listing', () => {
    const makeRows = async (count: number, appUid: string | null = null) => {
        const rows = [];
        for (let i = 0; i < count; i++)
            rows.push((await durable().create(input({ appUid }))).row);
        return rows;
    };

    it('pages with a cursor and stops offering one at the end', async () => {
        const rows = await makeRows(5);

        const first = await durable().listForHolder(userId, { limit: 2 });
        expect(first.items.map((row) => row.subId)).toEqual(
            rows.slice(0, 2).map((row) => row.subId),
        );
        expect(first.cursor).toBeDefined();
        expect(first.total).toBeUndefined();

        const second = await durable().listForHolder(userId, {
            limit: 2,
            cursor: first.cursor,
        });
        expect(second.items.map((row) => row.subId)).toEqual(
            rows.slice(2, 4).map((row) => row.subId),
        );

        const last = await durable().listForHolder(userId, {
            limit: 2,
            cursor: second.cursor,
        });
        expect(last.items.map((row) => row.subId)).toEqual([rows[4].subId]);
        expect(last.cursor).toBeUndefined();
    });

    it('hands out a cursor that says nothing about where the row sits', async () => {
        await makeRows(2);

        const first = await durable().listForHolder(userId, { limit: 1 });

        expect(
            Buffer.from(first.cursor!, 'base64').toString('utf8'),
        ).not.toContain('"id"');
    });

    it('adds a total only when asked, over the scope and not the page', async () => {
        await makeRows(3);

        const page = await durable().listForHolder(userId, {
            limit: 1,
            includeTotal: true,
        });
        expect(page.items).toHaveLength(1);
        expect(page.total).toBe(3);
    });

    it('confines an app to its own rows and shows a session everything', async () => {
        const mine = `app-${uuidv4()}`;
        const theirs = `app-${uuidv4()}`;
        await makeRows(2, mine);
        await makeRows(1, theirs);
        await makeRows(1);

        const scoped = await durable().listForHolder(userId, { appUid: mine });
        expect(scoped.items).toHaveLength(2);
        expect(scoped.items.every((row) => row.appUid === mine)).toBe(true);

        const account = await durable().listForHolder(userId, {
            includeTotal: true,
        });
        expect(account.total).toBe(4);
    });

    it('hides a row that has expired but not yet been swept', async () => {
        const { row } = await durable().create(
            input({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
        );

        const page = await durable().listForHolder(userId, {
            includeTotal: true,
        });
        expect(page.items).toEqual([]);
        expect(page.total).toBe(0);
        // Still on the table until the sweeper runs.
        await expect(durable().getBySubId(row.subId)).resolves.not.toBeNull();
    });

    it('returns an empty page for a holder with nothing', async () => {
        await expect(
            durable().listForHolder(otherUserId, { includeTotal: true }),
        ).resolves.toEqual({ items: [], total: 0 });
    });
});

describe('the expiry sweep', () => {
    it('reaps an expired row and stops the region delivering against it', async () => {
        const expired = await durable().create(
            input({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
        );
        const live = await durable().create(input());
        // The write-through caches only deliverable rows, so put the expired
        // one back to prove the sweep is what removes it.
        await cache().cacheDurable([expired.row]);

        expect((await durable().sweepExpired(500)).rows).toHaveLength(1);

        await expect(
            durable().getBySubId(expired.row.subId),
        ).resolves.toBeNull();
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            live.row,
        ]);
    });

    it('leaves a subscription with no expiry alone', async () => {
        await durable().create(input());
        expect((await durable().sweepExpired(500)).rows).toHaveLength(0);
        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            total: 1,
        });
    });
});

describe('listHolderIdsForApp', () => {
    it('names every distinct holder bound to the app`s handlers', async () => {
        const appUid = `app-${uuidv4()}`;
        await durable().create(input({ appUid, holderUserId: userId }));
        await durable().create(
            input({
                appUid,
                holderUserId: otherUserId,
            }),
        );
        // A second row for the same holder must not double the name.
        await durable().create(input({ appUid, holderUserId: userId }));

        const holders = await durable().listHolderIdsForApp(appUid);
        expect(holders.sort()).toEqual([userId, otherUserId].sort());
    });

    it('finds a suspended row`s holder too', async () => {
        const appUid = `app-${uuidv4()}`;
        const { row } = await durable().create(input({ appUid }));
        await durable().suspend([row], 'handler_not_found');

        expect(await durable().listHolderIdsForApp(appUid)).toEqual([userId]);
    });

    it('answers an empty list for an app with nothing bound', async () => {
        expect(await durable().listHolderIdsForApp(`app-${uuidv4()}`)).toEqual(
            [],
        );
    });
});

describe('reapForApp', () => {
    it('deletes every row bound to the app and bumps its owner`s generation', async () => {
        const appUid = `app-${uuidv4()}`;
        const mine = await durable().create(input({ appUid }));
        const untouched = await durable().create(input());
        const before = await cache().getGeneration(userId);

        expect((await durable().reapForApp(appUid, 500)).rows).toHaveLength(1);

        await expect(durable().getBySubId(mine.row.subId)).resolves.toBeNull();
        await expect(
            durable().getBySubId(untouched.row.subId),
        ).resolves.not.toBeNull();
        await expect(cache().getGeneration(userId)).resolves.toBeGreaterThan(
            before,
        );
    });

    it('never touches another app`s rows', async () => {
        const appUid = `app-${uuidv4()}`;
        const otherAppUid = `app-${uuidv4()}`;
        await durable().create(input({ appUid }));
        const theirs = await durable().create(input({ appUid: otherAppUid }));

        await durable().reapForApp(appUid, 500);

        await expect(
            durable().getBySubId(theirs.row.subId),
        ).resolves.not.toBeNull();
    });

    it('answers 0 for an app with nothing to reap', async () => {
        expect(
            (await durable().reapForApp(`app-${uuidv4()}`, 500)).rows,
        ).toHaveLength(0);
    });
});

describe('warming a cold region', () => {
    it('reads the table once and then answers from the cache', async () => {
        const { row } = await durable().create(input());

        // A region that has never seen this user: no keys, no marker.
        await env.server.clients.redis.flushall();

        await expect(durable().warmRegion(userId)).resolves.toBe(true);
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            row,
        ]);
        await expect(durable().warmRegion(userId)).resolves.toBe(false);
    });

    it('drops a row another region removed while this one was warm', async () => {
        const { row } = await durable().create(input());
        await env.server.clients.db.write(
            'DELETE FROM `event_subscriptions` WHERE `sub_id` = ?',
            [row.subId],
        );

        await cache().markRegionCold(userId);
        await durable().warmRegion(userId);

        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual(
            [],
        );
        await expect(cache().userHasAny(userId)).resolves.toBe(false);
    });

    it('does not cache a suspended row', async () => {
        const { row } = await durable().create(input());
        await env.server.clients.db.write(
            'UPDATE `event_subscriptions` SET `suspended_at` = ?, ' +
                '`suspended_reason` = ? WHERE `sub_id` = ?',
            [Math.floor(Date.now() / 1000), 'permission_revoked', row.subId],
        );

        await cache().markRegionCold(userId);
        await durable().warmRegion(userId);

        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual(
            [],
        );
        // Suspended is still listed — it is a state, not a removal.
        const page = await durable().listForHolder(userId);
        expect(page.items[0]?.suspendedReason).toBe('permission_revoked');
    });
});

describe('suspending', () => {
    it('suspends a row once, and tells a later pass it was not the one', async () => {
        const { row } = await durable().create(input());

        const first = await durable().suspend([row], 'permission_revoked');
        expect(first.suspended.map((r) => r.subId)).toEqual([row.subId]);
        expect(first.bumps).toHaveLength(1);

        const second = await durable().suspend([row], 'permission_revoked');
        expect(second.suspended).toEqual([]);
        expect(second.bumps).toEqual([]);
    });
});

describe('rows a schedule owns', () => {
    const scheduleInput = (
        over: Partial<DurableSubscriptionInput> = {},
    ): DurableSubscriptionInput => {
        const uid = uuidv4();
        return input({
            subject: scheduleToken(uid),
            token: scheduleToken(uid),
            anchorUid: uid,
            anchorPath: '',
            appUid: 'app-scheduler',
            delivery: 'single',
            handlerName: 'tick',
            permission: 'events:background',
            ...over,
        });
    };

    it('are created past the durable quota, uncached and with no bump', async () => {
        const limits = { perUser: 1, perApp: 1 };
        await durable().create(input({ limits }));
        const before = await cache().getGeneration(userId);

        const created = await durable().create(scheduleInput({ limits }));

        expect(created.bump).toBeNull();
        await expect(cache().getGeneration(userId)).resolves.toBe(before);
        await expect(
            cache().getForTokens(userId, [created.row.token]),
        ).resolves.toEqual([]);
        await expect(
            durable().getBySubId(created.row.subId),
        ).resolves.toMatchObject({ token: created.row.token });
    });

    it('never enter the dispatch cache or what a cold region rebuilds', async () => {
        const { row } = await durable().create(scheduleInput());
        await expect(
            durable().listDeliverableForOwner(userId),
        ).resolves.toEqual([]);

        await cache().markRegionCold(userId);
        await durable().warmRegion(userId);
        await expect(cache().userHasAny(userId)).resolves.toBe(false);

        await durable().suspend([row], 'no_credit');
        await durable().resume([
            { ...row, suspendedAt: 1, suspendedReason: 'no_credit' },
        ]);
        await expect(
            cache().getForTokens(userId, [row.token]),
        ).resolves.toEqual([]);
        await expect(cache().userHasAny(userId)).resolves.toBe(false);
    });

    it('bump no generation when suspended or resumed', async () => {
        const { row } = await durable().create(scheduleInput());
        const before = await cache().getGeneration(userId);

        const { suspended, bumps } = await durable().suspend([row], 'failures');
        expect(suspended).toHaveLength(1);
        expect(bumps).toEqual([]);
        await expect(durable().resume(suspended)).resolves.toEqual([]);
        await expect(cache().getGeneration(userId)).resolves.toBe(before);
    });

    it('count toward no durable quota, and are not in the durable listing', async () => {
        await durable().create(input());
        await durable().create(scheduleInput());

        await expect(durable().countForHolder(userId)).resolves.toEqual({
            total: 1,
            forApp: 0,
            terminal: 0,
        });
        const listed = await durable().listForHolder(userId, {
            includeTotal: true,
        });
        expect(listed.total).toBe(1);
        expect(listed.items.map((row) => row.token)).toEqual([token()]);
    });

    it('are kept when the oldest revoked rows are trimmed', async () => {
        const base = Math.floor(Date.now() / 1000) - 10_000;
        const { row: scheduled } = await durable().create(scheduleInput());
        await env.server.clients.db.write(
            'UPDATE `event_subscriptions` SET `suspended_at` = ?, ' +
                '`suspended_reason` = ? WHERE `sub_id` = ?',
            [base - 1, 'permission_revoked', scheduled.subId],
        );
        for (let i = 0; i < EVENTS_REVOKED_SUBSCRIPTIONS_KEPT + 1; i++) {
            const { row } = await durable().create(input());
            await env.server.clients.db.write(
                'UPDATE `event_subscriptions` SET `suspended_at` = ?, ' +
                    '`suspended_reason` = ? WHERE `sub_id` = ?',
                [base + i, 'permission_revoked', row.subId],
            );
        }

        await durable().create(input());

        await expect(
            durable().getBySubId(scheduled.subId),
        ).resolves.not.toBeNull();
        await expect(durable().countForHolder(userId)).resolves.toMatchObject({
            terminal: EVENTS_REVOKED_SUBSCRIPTIONS_KEPT,
        });
    });

    it('are read, a page at a time, by what settles a holder', async () => {
        const made: string[] = [];
        for (let i = 0; i < 3; i++)
            made.push((await durable().create(scheduleInput())).row.subId);
        made.push((await durable().create(input())).row.subId);

        const first = await durable().listActiveForHolderPage(
            userId,
            null,
            0,
            2,
        );
        expect(first.rows.map((row) => row.subId)).toEqual(made.slice(0, 2));
        expect(first.nextId).not.toBeNull();
        const second = await durable().listActiveForHolderPage(
            userId,
            null,
            first.nextId!,
            2,
        );
        expect(second.rows.map((row) => row.subId)).toEqual(made.slice(2));
        // A full page always says to look again; the next one is empty.
        const third = await durable().listActiveForHolderPage(
            userId,
            null,
            second.nextId ?? Number.MAX_SAFE_INTEGER,
            2,
        );
        expect(third).toEqual({ rows: [], nextId: null });
    });

    it('are read, a page at a time, by what a top-up resumes', async () => {
        const rows = [];
        for (let i = 0; i < 3; i++)
            rows.push((await durable().create(scheduleInput())).row);
        await durable().suspend(rows, 'no_credit');

        const first = await durable().listSuspendedForHolderPage(
            userId,
            'no_credit',
            0,
            2,
        );
        expect(first.rows).toHaveLength(2);
        const second = await durable().listSuspendedForHolderPage(
            userId,
            'no_credit',
            first.nextId!,
            2,
        );
        expect(second.rows.map((row) => row.subId)).toEqual([rows[2].subId]);
        expect(second.nextId).toBeNull();
    });

    it('are found by handler and by app, like any other row', async () => {
        const { row } = await durable().create(scheduleInput());
        await expect(
            durable().listByHandler('app-scheduler', 'tick'),
        ).resolves.toEqual([expect.objectContaining({ subId: row.subId })]);
        await expect(
            durable().listHolderIdsForApp('app-scheduler'),
        ).resolves.toEqual([userId]);
    });

    it('come back from a reap without touching a backlog', async () => {
        const { row } = await durable().create(scheduleInput());
        const regular = await durable().create(
            input({ appUid: 'app-scheduler' }),
        );
        const purge = vi.spyOn(env.server.stores.pendingDelivery, 'purge');
        try {
            const reaped = await durable().reapForApp('app-scheduler', 500);
            expect(reaped.rows.map((r) => r.subId).sort()).toEqual(
                [row.subId, regular.row.subId].sort(),
            );
            expect(purge.mock.calls.map(([subId]) => subId)).toEqual([
                regular.row.subId,
            ]);
            // Only the cached row's owner was bumped.
            expect(reaped.bumps).toHaveLength(1);
        } finally {
            purge.mockRestore();
        }
    });

    it('are deleted by their schedule`s id, whether or not it recorded the row', async () => {
        const uid = uuidv4();
        await durable().create(
            scheduleInput({
                subject: scheduleToken(uid),
                token: scheduleToken(uid),
                anchorUid: uid,
            }),
        );
        await expect(durable().removeScheduleSubscription(uid)).resolves.toBe(
            true,
        );
        await expect(durable().removeScheduleSubscription(uid)).resolves.toBe(
            false,
        );
    });
});
