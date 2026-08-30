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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER } from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DurableSubscriptionInput } from './DurableSubscriptionStore.js';

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
    targets: ['socket', 'worker'],
    handlerName: null,
    context: null,
    permission: 'list',
    expiresAt: null,
    ...over,
});

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

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
            input({ appUid, handlerName: 'onWrite', match: '*.txt' }),
        );

        expect(row.subId.startsWith(`${appUid}#`)).toBe(true);
        await expect(durable().getBySubId(row.subId)).resolves.toMatchObject({
            subId: row.subId,
            appUid,
            handlerName: 'onWrite',
            match: '*.txt',
            delivery: 'broadcast',
            targets: ['socket', 'worker'],
            durable: true,
        });
    });

    it('names a session`s row for the account, not an app', async () => {
        const { row } = await durable().create(input());
        expect(row.subId.startsWith('user#')).toBe(true);
        expect(row.appUid).toBeNull();
    });

    it('caches the row and watches its token before returning', async () => {
        const { row } = await durable().create(input());

        await expect(cache().userHasAny(userId)).resolves.toBe(true);
        await expect(
            cache().watchedTokens(userId, [token()]),
        ).resolves.toEqual([token()]);
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            row,
        ]);
        // The region has read the table, so nothing else has to.
        await expect(cache().isRegionWarm(userId)).resolves.toBe(true);
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
    it('refuses a target outside the known set', async () => {
        await expect(
            durable().create(
                input({ targets: ['socket', 'carrier-pigeon'] as never }),
            ),
        ).rejects.toSatisfy(codeOf('invalid_targets'));
    });

    it('refuses an empty target set', async () => {
        await expect(
            durable().create(input({ targets: [] })),
        ).rejects.toSatisfy(codeOf('invalid_targets'));
    });

    it('refuses a `single` row that wants a device notification', async () => {
        await expect(
            durable().create(
                input({
                    delivery: 'single',
                    handlerName: 'onWrite',
                    targets: ['socket', 'push'],
                }),
            ),
        ).rejects.toSatisfy(codeOf('invalid_targets'));
        await expect(durable().countForHolder(userId)).resolves.toBe(0);
    });

    it('keeps the same targets on a `broadcast` row, where push is fine', async () => {
        const { row } = await durable().create(
            input({ targets: ['socket', 'push'] }),
        );
        expect(row.targets).toEqual(['socket', 'push']);
    });

    it('refuses a context past the hard cap', async () => {
        await expect(
            durable().create(input({ context: 'x'.repeat(4097) })),
        ).rejects.toSatisfy(codeOf('events_context_too_large'));
        await expect(durable().countForHolder(userId)).resolves.toBe(0);
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

describe('the per-account cap', () => {
    it('refuses the one past the limit with a stable code', async () => {
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER; i++)
            await env.server.clients.db.insert('event_subscriptions', {
                sub_id: `user#filler-${i}`,
                token: token(),
                owner_user_id: userId,
                holder_user_id: userId,
                app_uid: null,
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

        await expect(durable().create(input())).rejects.toSatisfy(
            codeOf('events_subscription_limit'),
        );
    });

    it('counts the holder, not the owner', async () => {
        await durable().create(input({ holderUserId: otherUserId }));
        await expect(durable().countForHolder(userId)).resolves.toBe(0);
        await expect(durable().countForHolder(otherUserId)).resolves.toBe(1);
    });

    it('does not count a row that has expired but not yet been swept', async () => {
        await durable().create(
            input({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
        );
        await durable().create(input());
        await expect(durable().countForHolder(userId)).resolves.toBe(1);
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

        await expect(
            cache().watchedTokens(userId, [token()]),
        ).resolves.toEqual([token()]);
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            survivor.row,
        ]);
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

        await expect(durable().sweepExpired(500)).resolves.toBe(1);

        await expect(durable().getBySubId(expired.row.subId)).resolves.toBeNull();
        await expect(cache().getForTokens(userId, [token()])).resolves.toEqual([
            live.row,
        ]);
    });

    it('leaves a subscription with no expiry alone', async () => {
        await durable().create(input());
        await expect(durable().sweepExpired(500)).resolves.toBe(0);
        await expect(durable().countForHolder(userId)).resolves.toBe(1);
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
