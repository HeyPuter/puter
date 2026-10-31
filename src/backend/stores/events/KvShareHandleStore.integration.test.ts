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
 * The store against a real database: column-width guards, listings, quota
 * counts and retention.
 */

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
import { isHttpError } from '../../core/http/HttpError.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { KV_SHARE_HANDLE_WIDTHS } from './columnWidths.js';
import type { MintKvShareHandleInput } from './KvShareHandleStore.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let ownerUserId: number;
let granteeUserId: number;

const store = () => env.server.stores.kvShareHandle;

const input = (
    over: Partial<MintKvShareHandleInput> = {},
): MintKvShareHandleInput => ({
    ownerUserId,
    granteeUserId,
    appUid: 'app-column-widths',
    keyPrefix: 'workspace:',
    permission: 'kv-share:owner-uuid:app-column-widths:workspace',
    ...over,
});

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    const owner = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    ownerUserId = owner!.id;
    const grantee = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    granteeUserId = grantee!.id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('minting rejects a value the column would truncate', () => {
    it('accepts a `keyPrefix` right at the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.keyPrefix.max;
        const row = await store().mint(input({ keyPrefix: 'a'.repeat(max) }));
        expect(row.keyPrefix).toBe('a'.repeat(max));
    });

    it('refuses a `keyPrefix` one character over the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.keyPrefix.max;
        await expect(
            store().mint(input({ keyPrefix: 'a'.repeat(max + 1) })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });

    it('accepts a `permission` right at the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.permission.max;
        const row = await store().mint(input({ permission: 'a'.repeat(max) }));
        expect(row.permission).toBe('a'.repeat(max));
    });

    it('refuses a `permission` one character over the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.permission.max;
        await expect(
            store().mint(input({ permission: 'a'.repeat(max + 1) })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });
});

describe('the owner listing', () => {
    it('pages on a cursor that says nothing about where the row sits', async () => {
        const appUid = 'app-listing-cursor';
        for (let i = 0; i < 3; i++)
            await store().mint(
                input({
                    appUid,
                    keyPrefix: `cursor-${i}:`,
                    permission: `kv-share:owner-uuid:${appUid}:cursor-${i}`,
                }),
            );

        const first = await store().listForOwner(ownerUserId, {
            appUid,
            limit: 2,
        });
        expect(first.cursor).toBeDefined();
        expect(
            Buffer.from(first.cursor!, 'base64').toString('utf8'),
        ).not.toContain('"id"');

        const second = await store().listForOwner(ownerUserId, {
            appUid,
            limit: 2,
            cursor: first.cursor,
        });
        expect(second.items.map((row) => row.keyPrefix)).toEqual(['cursor-2:']);
        expect(second.cursor).toBeUndefined();
    });
});

describe('retiring an app`s handles', () => {
    it('works through them a batch at a time, as the platform', async () => {
        const appUid = 'app-retire-batches';
        const minted = [];
        for (let i = 0; i < 3; i++)
            minted.push(
                await store().mint(
                    input({
                        appUid,
                        keyPrefix: `batch-${i}:`,
                        permission: `kv-share:owner-uuid:${appUid}:batch-${i}`,
                    }),
                ),
            );

        const batches: number[] = [];
        for (;;) {
            const batch = await store().listLiveForApps([appUid], 2);
            batches.push(batch.length);
            if (batch.length === 0) break;
            await store().retireMany(
                batch.map((row) => row.handle),
                'system',
            );
        }
        expect(batches).toEqual([2, 1, 0]);
        for (const { handle } of minted)
            expect(await store().getByHandle(handle)).toMatchObject({
                revokedBy: 'system',
                revokedAt: expect.any(Number),
            });
    });
});

describe('changing a live handle', () => {
    it('never brings a retired one back', async () => {
        const row = await store().mint(input({ keyPrefix: 'cas:' }));
        await store().retire(row.handle, ownerUserId);
        const after = await store().update(row.handle, ownerUserId, {
            permission: 'kv-share-write:owner-uuid:app-column-widths:cas',
            label: 'late',
        });
        expect(after).toMatchObject({
            revokedAt: expect.any(Number),
            permission: row.permission,
            label: null,
        });
    });

    it('is scoped to the owner', async () => {
        const row = await store().mint(input({ keyPrefix: 'scoped:' }));
        expect(
            await store().update(row.handle, granteeUserId, { label: 'x' }),
        ).toBeNull();
        expect((await store().getByHandle(row.handle))?.label).toBeNull();
    });
});

describe('finding the live handle on a region', () => {
    it('matches the prefix byte for byte, and reports one that differs only in case', async () => {
        const appUid = `app-case-${Date.now().toString(36)}`;
        const region = { ownerUserId, granteeUserId, appUid };
        const minted = await store().mint(
            input({
                appUid,
                keyPrefix: 'Notes:',
                permission: `kv-share:o:${appUid}:Notes`,
            }),
        );

        expect(
            await store().findLive({ ...region, keyPrefix: 'Notes:' }),
        ).toMatchObject({ handle: minted.handle });
        expect(
            await store().findLive({ ...region, keyPrefix: 'notes:' }),
        ).toBeNull();
        expect(
            await store().hasLiveCaseVariant({
                ...region,
                keyPrefix: 'notes:',
            }),
        ).toBe(true);
        expect(
            await store().hasLiveCaseVariant({
                ...region,
                keyPrefix: 'Notes:',
            }),
        ).toBe(false);
        expect(
            await store().hasLiveCaseVariant({
                ...region,
                keyPrefix: 'other:',
            }),
        ).toBe(false);

        await store().retire(minted.handle, ownerUserId);
        expect(
            await store().hasLiveCaseVariant({
                ...region,
                keyPrefix: 'notes:',
            }),
        ).toBe(false);
    });
});

describe('the holder listing', () => {
    it('carries no owner, prefix or grant string', async () => {
        const row = await store().mint(
            input({
                appUid: 'app-holder-listing',
                keyPrefix: 'secret-prefix:',
                permission:
                    'kv-share-read:owner-uuid:app-holder-listing:secret-prefix',
                label: 'Shown',
            }),
        );
        const page = await store().listLiveForGrantee(granteeUserId, {
            appUid: 'app-holder-listing',
        });
        expect(page.items).toEqual([
            {
                handle: row.handle,
                appUid: 'app-holder-listing',
                access: 'read',
                label: 'Shown',
                createdAt: row.createdAt,
            },
        ]);
    });
});

describe('live handles by owner and app', () => {
    it('lists only the owner\'s live handles in that app, oldest first', async () => {
        const appUid = 'app-owner-listing';
        const first = await store().mint(
            input({ appUid, keyPrefix: 'owned-a:' }),
        );
        const second = await store().mint(
            input({ appUid, keyPrefix: 'owned-b:' }),
        );
        const retired = await store().mint(
            input({ appUid, keyPrefix: 'owned-c:' }),
        );
        await store().retireMany([retired.handle], 'owner');
        await store().mint(
            input({ appUid: 'app-owner-listing-other', keyPrefix: 'x:' }),
        );
        const theirs = await store().mint(
            input({
                appUid,
                keyPrefix: 'theirs:',
                ownerUserId: granteeUserId,
                granteeUserId: ownerUserId,
            }),
        );

        const rows = await store().listLiveForOwnerApp(ownerUserId, appUid);
        expect(rows.map((row) => row.handle)).toEqual([
            first.handle,
            second.handle,
        ]);
        expect(
            await store().listLiveForOwnerApp(ownerUserId, appUid, 1),
        ).toHaveLength(1);
        // Other tests count the other account's live handles from zero.
        await store().retireMany([theirs.handle], 'owner');
    });
});

describe('a cutoff on the retire listings', () => {
    it('leaves out handles made after it', async () => {
        const appUid = 'app-cutoff';
        const old = await store().mint(input({ appUid, keyPrefix: 'old:' }));
        const fresh = await store().mint(
            input({ appUid, keyPrefix: 'fresh:' }),
        );
        await env.server.clients.db.write(
            'UPDATE `kv_share_handles` SET `created_at` = ? WHERE `handle` = ?',
            [old.createdAt - 10, old.handle],
        );
        const cutoff = old.createdAt - 5;

        expect(
            (await store().listLiveForApps([appUid], 10, cutoff)).map(
                (row) => row.handle,
            ),
        ).toEqual([old.handle]);
        expect(
            (
                await store().listLiveForOwnerApp(
                    ownerUserId,
                    appUid,
                    10,
                    cutoff,
                )
            ).map((row) => row.handle),
        ).toEqual([old.handle]);
        expect(await store().listLiveForApps([appUid], 10)).toHaveLength(2);
        await store().retireMany([old.handle, fresh.handle], 'owner');
    });
});

describe('live handles one user holds', () => {
    it('come a batch at a time after an id, live ones only', async () => {
        const holderName = `kv-held-${Math.random().toString(36).slice(2, 10)}`;
        await createTestUser(env.server, {
            username: holderName,
            password: 'pw-test-1234',
        });
        const holderId = (await env.server.stores.user.getByUsername(
            holderName,
        ))!.id;
        const held = [];
        for (const keyPrefix of ['held-a:', 'held-b:', 'held-c:'])
            held.push(
                await store().mint(
                    input({ granteeUserId: holderId, keyPrefix }),
                ),
            );
        await store().retireMany([held[1].handle], 'owner');

        const first = await store().listLiveHeldBy(holderId, 0, 1);
        expect(first.map((row) => row.handle)).toEqual([held[0].handle]);
        const rest = await store().listLiveHeldBy(holderId, first[0].id);
        expect(rest.map((row) => row.handle)).toEqual([held[2].handle]);
        expect(rest[0].ownerUserId).toBe(ownerUserId);
    });
});

describe('the live cache across nodes', () => {
    const handleReads = (spy: ReturnType<typeof vi.spyOn>) =>
        spy.mock.calls.filter(([sql]) =>
            String(sql).includes('kv_share_handles'),
        ).length;

    it('tells other nodes to forget a handle it retires or changes', async () => {
        const first = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-a:' }),
        );
        const second = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-b:' }),
        );
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            await store().update(first.handle, ownerUserId, { label: 'x' });
            await store().retireMany([first.handle, second.handle], 'owner');
            const forgets = emit.mock.calls
                .filter(([key]) => key === 'outer.pubsub.kv.share.forget')
                .map(([, data]) => data);
            expect(forgets).toEqual([
                { handles: [first.handle] },
                { handles: [first.handle, second.handle] },
            ]);
        } finally {
            emit.mockRestore();
        }
    });

    it('drops its cached row when another node says to', async () => {
        const row = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-c:' }),
        );
        expect(await store().getLive(row.handle)).not.toBeNull();
        // Retired behind this node's back, as another node would.
        await env.server.clients.db.write(
            'UPDATE `kv_share_handles` SET `revoked_at` = 1 WHERE `handle` = ?',
            [row.handle],
        );
        expect(await store().getLive(row.handle)).not.toBeNull();

        // A local emit is ignored: the sender already forgot.
        env.server.clients.event.emit(
            'outer.pubsub.kv.share.forget',
            { handles: [row.handle] },
            {},
        );
        expect(await store().getLive(row.handle)).not.toBeNull();

        env.server.clients.event.emit(
            'outer.pubsub.kv.share.forget',
            { handles: [row.handle] },
            { from_outside: true },
        );
        await vi.waitFor(async () =>
            expect(await store().getLive(row.handle)).toBeNull(),
        );
    });

    it('doesn`t cache a row a retire overtook during the app lookup', async () => {
        const row = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-race:' }),
        );
        const apps = env.server.stores.app;
        const getByUid = apps.getByUid.bind(apps);
        const lookup = vi
            .spyOn(apps, 'getByUid')
            .mockImplementationOnce(async (...args) => {
                await store().retireMany([row.handle], 'owner');
                return getByUid(...args);
            });
        try {
            await store().getLive(row.handle);
        } finally {
            lookup.mockRestore();
        }
        expect(await store().getLive(row.handle)).toBeNull();
    });

    it('drops an owner\'s cached rows when the owner is suspended, here and on other nodes', async () => {
        const row = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-owner:' }),
        );
        expect((await store().getLive(row.handle))?.ownerSuspended).toBe(
            false,
        );
        const setSuspended = (value: number) =>
            env.server.clients.db.write(
                'UPDATE `user` SET `suspended` = ? WHERE `id` = ?',
                [value, ownerUserId],
            );
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            await setSuspended(1);
            expect((await store().getLive(row.handle))?.ownerSuspended).toBe(
                false,
            );

            env.server.clients.event.emit(
                'user.suspended',
                { userId: ownerUserId },
                {},
            );
            expect((await store().getLive(row.handle))?.ownerSuspended).toBe(
                true,
            );
            expect(
                emit.mock.calls.filter(
                    ([key]) => key === 'outer.pubsub.kv.share.forgetOwner',
                ),
            ).toEqual([
                [
                    'outer.pubsub.kv.share.forgetOwner',
                    { ownerUserId },
                    {},
                ],
            ]);

            // Another node lifting the suspension reaches this one's cache.
            await setSuspended(0);
            env.server.clients.event.emit(
                'outer.pubsub.kv.share.forgetOwner',
                { ownerUserId },
                { from_outside: true },
            );
            expect((await store().getLive(row.handle))?.ownerSuspended).toBe(
                false,
            );
        } finally {
            emit.mockRestore();
            await setSuspended(0);
        }
    });

    it('drops an owner\'s cached rows when the user store suspends or unsuspends them', async () => {
        const row = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-store:' }),
        );
        expect((await store().getLive(row.handle))?.ownerSuspended).toBe(
            false,
        );
        try {
            await env.server.stores.user.update(ownerUserId, {
                suspended: true,
            });
            await vi.waitFor(async () =>
                expect(
                    (await store().getLive(row.handle))?.ownerSuspended,
                ).toBe(true),
            );
            await env.server.stores.user.update(ownerUserId, {
                suspended: false,
            });
            await vi.waitFor(async () =>
                expect(
                    (await store().getLive(row.handle))?.ownerSuspended,
                ).toBe(false),
            );
        } finally {
            await env.server.stores.user.update(ownerUserId, {
                suspended: false,
            });
        }
    });

    describe('behind a lagging replica', () => {
        type Rows = Record<string, unknown>[];
        const db = () => env.server.clients.db;
        const isHandleRead = (sql: unknown) =>
            String(sql).includes('kv_share_handles');

        /** The row a read of one handle returns, as it stands now. */
        const rowsNow = async (handle: string): Promise<Rows> => {
            const read = vi.spyOn(db(), 'read');
            try {
                await store().getLive(handle);
                const at = read.mock.calls.findIndex(([sql]) =>
                    isHandleRead(sql),
                );
                return (await read.mock.results[at]?.value) as Rows;
            } finally {
                read.mockRestore();
            }
        };

        /**
         * Replica reads of a handle answer `answer()` from here on; primary
         * reads still reach the database (the test engine runs them through
         * `read` too).
         */
        const replicaAnswers = (answer: () => Promise<Rows>) => {
            const originalRead = db().read.bind(db());
            const originalPread = db().pread.bind(db());
            let primary = 0;
            const pread = vi
                .spyOn(db(), 'pread')
                .mockImplementation(async (sql, params) => {
                    primary++;
                    try {
                        return await originalPread(sql, params);
                    } finally {
                        primary--;
                    }
                });
            const read = vi
                .spyOn(db(), 'read')
                .mockImplementation(async (sql, params) =>
                    isHandleRead(sql) && primary === 0
                        ? answer()
                        : originalRead(sql, params),
                );
            return () => {
                read.mockRestore();
                pread.mockRestore();
            };
        };

        const forgetFromAnotherNode = (handle: string) =>
            env.server.clients.event.emit(
                'outer.pubsub.kv.share.forget',
                { handles: [handle] },
                { from_outside: true },
            );

        const revoke = (handle: string) =>
            db().write(
                'UPDATE `kv_share_handles` SET `revoked_at` = 1 WHERE `handle` = ?',
                [handle],
            );

        /** A handle cached live, with the window its mint opened behind it. */
        const cachedLive = async (keyPrefix: string) => {
            const row = await store().mint(
                input({ appUid: 'app-lag', keyPrefix }),
            );
            const stale = await rowsNow(row.handle);
            expect(stale).toHaveLength(1);
            vi.setSystemTime(Date.now() + 61_000);
            expect(await store().getLive(row.handle)).not.toBeNull();
            return { handle: row.handle, stale };
        };

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('reads a handle from the primary after a forget, so a stale replica can`t cache it live again', async () => {
            const { handle, stale } = await cachedLive('lag-a:');
            await revoke(handle);
            const restore = replicaAnswers(async () => stale);
            try {
                forgetFromAnotherNode(handle);
                await vi.waitFor(async () =>
                    expect(await store().getLive(handle)).toBeNull(),
                );
                // Nothing stale was cached either.
                expect(await store().getLive(handle)).toBeNull();
            } finally {
                restore();
            }
        });

        it('doesn`t cache what a replica returned while a forget landed', async () => {
            const { handle, stale } = await cachedLive('lag-b:');
            // Past the cached row's lifetime too, so the next call reads.
            vi.setSystemTime(Date.now() + 61_000);
            await revoke(handle);

            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            let started!: () => void;
            const reading = new Promise<void>((resolve) => (started = resolve));
            const restore = replicaAnswers(async () => {
                started();
                await gate;
                return stale;
            });
            try {
                const inFlight = store().getLive(handle);
                await reading;
                forgetFromAnotherNode(handle);
                release();
                expect(await inFlight).toBeNull();
                expect(await store().getLive(handle)).toBeNull();
            } finally {
                restore();
            }
        });

        it('reads an owner`s handles from the primary after a suspension', async () => {
            const { handle, stale } = await cachedLive('lag-owner:');
            expect(Number(stale[0]?.owner_suspended ?? 0)).toBe(0);

            const setSuspended = (value: number) =>
                db().write('UPDATE `user` SET `suspended` = ? WHERE `id` = ?', [
                    value,
                    ownerUserId,
                ]);
            const restore = replicaAnswers(async () => stale);
            try {
                await setSuspended(1);
                env.server.clients.event.emit(
                    'user.suspended',
                    { userId: ownerUserId },
                    {},
                );
                expect((await store().getLive(handle))?.ownerSuspended).toBe(
                    true,
                );
            } finally {
                restore();
                await setSuspended(0);
                env.server.clients.event.emit(
                    'user.unsuspended',
                    { userId: ownerUserId },
                    {},
                );
            }
        });
    });

    it('reads a handle once for concurrent misses', async () => {
        const row = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-concurrent:' }),
        );
        // The test engine runs primary reads through `read` too, so this
        // counts every query.
        const read = vi.spyOn(env.server.clients.db, 'read');
        try {
            const [first, second] = await Promise.all([
                store().getLive(row.handle),
                store().getLive(row.handle),
            ]);
            expect(first).not.toBeNull();
            expect(second).toBe(first);
            expect(handleReads(read)).toBe(1);
        } finally {
            read.mockRestore();
        }
    });

    it('reads nothing for an id whose mac does not verify', async () => {
        const row = await store().mint(
            input({ appUid: 'app-forget', keyPrefix: 'forget-d:' }),
        );
        const [id, mac] = row.handle.split('.');
        const forged = `${id}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
        const read = vi.spyOn(env.server.clients.db, 'read');
        const pread = vi.spyOn(env.server.clients.db, 'pread');
        try {
            expect(await store().getLive(forged)).toBeNull();
            expect(await store().getByHandle(forged)).toBeNull();
            expect(handleReads(read) + handleReads(pread)).toBe(0);
        } finally {
            read.mockRestore();
            pread.mockRestore();
        }
    });
});

describe('the owner listing by state', () => {
    it('defaults to every handle, and narrows to live or revoked', async () => {
        const appUid = 'app-listing-state';
        const live = await store().mint(
            input({ appUid, keyPrefix: 'state-live:' }),
        );
        const gone = await store().mint(
            input({ appUid, keyPrefix: 'state-gone:' }),
        );
        await store().retireMany([gone.handle], 'owner');
        const handlesIn = async (state?: 'live' | 'revoked' | 'all') =>
            (
                await store().listForOwner(ownerUserId, { appUid, state })
            ).items.map((row) => row.handle);

        expect(await handlesIn()).toEqual([live.handle, gone.handle]);
        expect(await handlesIn('all')).toEqual([live.handle, gone.handle]);
        expect(await handlesIn('live')).toEqual([live.handle]);
        expect(await handlesIn('revoked')).toEqual([gone.handle]);
        expect(
            (
                await store().listForOwner(ownerUserId, {
                    appUid,
                    state: 'live',
                    includeTotal: true,
                })
            ).total,
        ).toBe(1);
    });
});

describe('quota counts', () => {
    it('counts live handles per owner, per app and per holder, never retired ones', async () => {
        const appUid = 'app-quota-counts';
        const before = await store().countLiveForOwner(ownerUserId, appUid);
        const pairBefore = await store().countLiveForOwnerAndGrantee(
            ownerUserId,
            granteeUserId,
        );
        await store().mint(input({ appUid, keyPrefix: 'count-a:' }));
        await store().mint(
            input({ appUid: 'app-quota-other', keyPrefix: 'count-b:' }),
        );
        const gone = await store().mint(
            input({ appUid, keyPrefix: 'count-c:' }),
        );
        await store().retireMany([gone.handle], 'owner');

        expect(await store().countLiveForOwner(ownerUserId, appUid)).toEqual({
            total: before.total + 2,
            forApp: before.forApp + 1,
        });
        expect(
            await store().countLiveForOwnerAndGrantee(
                ownerUserId,
                granteeUserId,
            ),
        ).toBe(pairBefore + 2);
        expect(
            await store().countLiveForOwnerAndGrantee(
                granteeUserId,
                ownerUserId,
            ),
        ).toBe(0);
    });
});

describe('retired handle retention', () => {
    const DAY = 24 * 60 * 60;
    const now = () => Math.floor(Date.now() / 1000);

    const retiredAt = async (keyPrefix: string, at: number | null) => {
        const row = await store().mint(
            input({ appUid: 'app-retention', keyPrefix }),
        );
        if (at !== null)
            await env.server.clients.db.write(
                'UPDATE `kv_share_handles` SET `revoked_at` = ? WHERE `handle` = ?',
                [at, row.handle],
            );
        return row.handle;
    };

    const exists = async (handle: string) =>
        (await store().getByHandle(handle)) !== null;

    it('deletes rows retired before the cutoff, a batch at a time', async () => {
        const cutoff = now() - 30 * DAY;
        // Rows other tests retired long ago go first.
        await store().deleteRevokedBefore(cutoff, 1_000);
        const old = [
            await retiredAt('old-1:', cutoff - 10),
            await retiredAt('old-2:', cutoff - 5),
        ];
        const recent = await retiredAt('recent:', cutoff + 5);
        const live = await retiredAt('live:', null);

        expect(await store().deleteRevokedBefore(cutoff, 1)).toBe(1);
        // Oldest retirement first.
        expect(await exists(old[0])).toBe(false);
        expect(await exists(old[1])).toBe(true);
        expect(await store().deleteRevokedBefore(cutoff, 10)).toBe(1);
        expect(await store().deleteRevokedBefore(cutoff, 10)).toBe(0);

        expect(await exists(old[1])).toBe(false);
        expect(await exists(recent)).toBe(true);
        expect(await exists(live)).toBe(true);
    });

    it('purges once per day across nodes, keeping live and recent rows', async () => {
        const kvShare = env.server.services.kvShare;
        await env.server.clients.redis.del('kvShare:purge:gate');
        const old = await retiredAt('purge-old:', now() - 31 * DAY);
        const recent = await retiredAt('purge-recent:', now() - 29 * DAY);
        const live = await retiredAt('purge-live:', null);

        expect(await kvShare.purgeRevokedHandles()).toBeGreaterThanOrEqual(1);
        expect(await exists(old)).toBe(false);
        expect(await exists(recent)).toBe(true);
        expect(await exists(live)).toBe(true);

        // Another node checking the same day finds the gate held.
        const again = await retiredAt('purge-again:', now() - 31 * DAY);
        expect(await kvShare.purgeRevokedHandles()).toBeNull();
        expect(await exists(again)).toBe(true);
    });
});
