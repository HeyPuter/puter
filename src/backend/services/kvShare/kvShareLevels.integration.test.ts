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
 * Share levels against the real grant machinery: the ladder, level changes in
 * place, owner revoke and holder unshare at every level, nested handles, the
 * holder's listing, app deletion, and the handle cache.
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
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from '../events/EventsService.js';
import {
    kvShareGrantAtEveryLevel,
    kvShareManagePermission,
    kvSharePermission,
    type KvShareAccess,
} from './kvShares.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'kv-levels-socket';
const GLOBAL = 'os-global';

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
    uuid: string;
}

let env: PuterTestEnv;
let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;
let delivered: DeliveryEnvelope[];

const shares = () => env.server.services.kvShare;
const events = () => env.server.services.events;
const permissions = () => env.server.services.permission;
const handles = () => env.server.stores.kvShareHandle;

/** The live config the services read, for flipping a flag inside one test. */
const liveConfig = () => (shares() as unknown as { config: IConfig }).config;

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
        uuid: row!.uuid as string,
    };
};

/** A fresh region, so grants left by one test never cover another's. */
const region = (label = 'r') => `${label}-${uuidv4().slice(0, 8)}:`;

const share = (
    prefix: string,
    access: KvShareAccess,
    opts: {
        holder?: TestUser;
        actor?: Actor;
        label?: unknown;
        appUid?: string;
    } = {},
) =>
    shares().mintKvHandle(
        opts.actor ?? owner.actor,
        {
            prefix,
            recipient: { username: (opts.holder ?? guest).username },
            access,
            ...(opts.label !== undefined ? { label: opts.label } : {}),
            ...(opts.appUid ? { appUid: opts.appUid } : {}),
        },
        { defaultAccess: 'read' },
    );

const holds = (
    user: TestUser,
    prefix: string,
    access: KvShareAccess,
    appUid = GLOBAL,
) =>
    permissions().check(
        user.actor,
        kvSharePermission(owner.uuid, appUid, prefix, access),
    );

/** Grant rows standing on a region at any level, for one holder. */
const grantRows = async (holder: TestUser, prefix: string, appUid = GLOBAL) =>
    (
        await env.server.clients.db.pread(
            'SELECT `permission` FROM `user_to_user_permissions` ' +
                'WHERE `holder_user_id` = ? AND `permission` IN (?, ?, ?)',
            [
                holder.id,
                ...kvShareGrantAtEveryLevel(
                    kvSharePermission(owner.uuid, appUid, prefix),
                ),
            ],
        )
    ).map((row) => String(row.permission));

const suspendedReason = async (subId: string) => {
    const [row] = await env.server.clients.db.pread(
        'SELECT `suspended_reason` FROM `event_subscriptions` WHERE `sub_id` = ?',
        [subId],
    );
    return (row as { suspended_reason: unknown } | undefined)?.suspended_reason;
};

const ownerWrites = (key: string, value: unknown, appUid?: string) =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.drivers.kvStore.set({
            key,
            value,
            ...(appUid ? { optConfig: { appUuid: appUid } } : {}),
        }),
    );

/** A call through a handle, as the holder (or `actor`). */
const guestCall = <T>(
    call: (driver: typeof env.server.drivers.kvStore) => Promise<T>,
    actor = guest.actor,
) => runWithContext({ actor }, () => call(env.server.drivers.kvStore));

const guestSet = (handle: string, key: string, value: unknown) =>
    guestCall((driver) => driver.set({ key, value, optConfig: { handle } }));

const guestGet = (handle: string, key: string) =>
    guestCall((driver) => driver.get({ key, optConfig: { handle } }));

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

const makeApp = async () => {
    const name = `kv-levels-${uuidv4().slice(0, 8)}`;
    const app = await env.server.stores.app.create(
        {
            name,
            title: 'Levels App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId: owner.id },
    );
    return app;
};

const appActorFor = (user: TestUser, app: { uid: string; id: number }) =>
    makeActor({
        user: user.actor.user as never,
        app: { uid: app.uid, id: app.id },
    });

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        kv: { shareHandles: true },
        unlimitedMetering: true,
    } as IConfig);

    const strangerName = `kv-lvl-${uuidv4().slice(0, 8)}`;
    await createTestUser(env.server, {
        username: strangerName,
        password: 'pw-test-1234',
    });

    owner = await userFor(env.users.user.username);
    guest = await userFor(env.users.other.username);
    stranger = await userFor(strangerName);

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

// Every mint, revoke and unshare spends the 60/min budget, and this file makes
// more than that.
beforeEach(async () => {
    for (const user of [owner, guest, stranger])
        await env.server.clients.redis.del(
            `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${user.id}`,
        );
});

describe('the level ladder', () => {
    it.each([
        ['watch', { watch: true, read: false, write: false }],
        ['read', { watch: true, read: true, write: false }],
        ['write', { watch: true, read: true, write: true }],
    ] as const)(
        'a %s share answers the levels at or below it',
        async (access, expected) => {
            const prefix = region(access);
            await share(prefix, access);
            for (const level of ['watch', 'read', 'write'] as const) {
                expect(await holds(guest, prefix, level)).toBe(expected[level]);
                // Prefix implication composes with the ladder.
                expect(await holds(guest, `${prefix}deep:key`, level)).toBe(
                    expected[level],
                );
            }
            expect(await holds(stranger, prefix, 'watch')).toBe(false);
        },
    );

    it.each(['watch', 'read', 'write'] as const)(
        'lets the holder subscribe through a %s handle, storing the watch grant',
        async (access) => {
            const prefix = region(`sub-${access}`);
            const { handle } = await share(prefix, access);

            const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            });
            const rows =
                await env.server.stores.eventSubscription.listForSocket(
                    guest.id,
                    SOCKET_ID,
                );
            const row = rows.find((one) => one.subId === sub.subId);
            expect(row?.permission).toBe(
                kvSharePermission(owner.uuid, GLOBAL, prefix, 'watch'),
            );
            await events().reapSocket(guest.id, SOCKET_ID);
        },
    );

    it('defaults to read on the share route and to watch on the alias', async () => {
        const viaShares = await shares().mintKvHandle(
            owner.actor,
            { prefix: region(), recipient: { username: guest.username } },
            { defaultAccess: 'read' },
        );
        const viaAlias = await shares().mintKvHandle(
            owner.actor,
            { prefix: region(), recipient: { username: guest.username } },
            { defaultAccess: 'watch' },
        );
        expect(viaShares.access).toBe('read');
        expect(viaAlias.access).toBe('watch');
    });

    it('refuses an access level that does not exist', async () => {
        await expect(
            share(region(), 'delete' as KvShareAccess),
        ).rejects.toMatchObject({ legacyCode: 'kv_share_access_invalid' });
    });

    it('caps each level`s prefix at what the grant column leaves, naming the limit', async () => {
        // 255 less the root, the owner uuid, `os-global` and two separators.
        const longest = { watch: 200, read: 195, write: 194 } as const;
        for (const access of ['watch', 'read', 'write'] as const) {
            const tag = uuidv4().slice(0, 8);
            const over = `${tag}${'a'.repeat(longest[access] - tag.length)}:`;
            await expect(share(over, access)).rejects.toMatchObject({
                legacyCode: 'invalid_kv_share_prefix',
                message: expect.stringContaining(
                    `${longest[access]} characters`,
                ),
            });
            await expect(share(over.slice(1), access)).resolves.toMatchObject({
                access,
            });
        }
    });

    it('needs kv.shareHandles for read and write, but not for watch', async () => {
        const config = liveConfig();
        config.kv = { shareHandles: false };
        try {
            for (const access of ['read', 'write'] as const)
                await expect(share(region(), access)).rejects.toMatchObject({
                    legacyCode: 'kv_handles_disabled',
                });
            await expect(share(region(), 'watch')).resolves.toMatchObject({
                access: 'watch',
            });
        } finally {
            config.kv = { shareHandles: true };
        }
    });
});

describe('changing a share`s level', () => {
    it('keeps the handle id and moves the grant, up and down', async () => {
        const prefix = region('change');
        const first = await share(prefix, 'watch');
        const before = await handles().countLiveForOwner(owner.id);

        for (const access of ['read', 'write', 'read', 'watch'] as const) {
            const changed = await share(prefix, access);
            expect(changed.handle).toBe(first.handle);
            expect(changed.access).toBe(access);
            expect(await grantRows(guest, prefix)).toEqual([
                kvSharePermission(owner.uuid, GLOBAL, prefix, access),
            ]);
            expect(await holds(guest, prefix, 'write')).toBe(
                access === 'write',
            );
        }
        // A level change takes no slot.
        expect(await handles().countLiveForOwner(owner.id)).toEqual(before);
    });

    it('leaves durable subscriptions on the handle alone', async () => {
        const prefix = region('durable');
        const { handle } = await share(prefix, 'watch');
        const { sub } = await events().subscribeDurable(guest.actor, {
            subject: `kv:${handle}:*`,
        });

        await share(prefix, 'write');
        await share(prefix, 'read');
        await quiet();
        expect(await suspendedReason(sub.subId)).toBeNull();

        delivered.length = 0;
        await ownerWrites(`${prefix}note`, 'still here');
        await vi.waitFor(
            () =>
                expect(delivered.some((one) => one.subId === sub.subId)).toBe(
                    true,
                ),
            { timeout: EVENTS_COALESCE_WINDOW_MS * 12, interval: 25 },
        );
        await events().unsubscribeDurable(guest.actor, { subId: sub.subId });
    });

    it('refuses an upgrade while kv.shareHandles is off, leaving the share as it was', async () => {
        const prefix = region('gated');
        const { handle } = await share(prefix, 'watch');
        const config = liveConfig();
        config.kv = { shareHandles: false };
        try {
            await expect(share(prefix, 'write')).rejects.toMatchObject({
                legacyCode: 'kv_handles_disabled',
            });
        } finally {
            config.kv = { shareHandles: true };
        }
        expect((await handles().getByHandle(handle))?.permission).toBe(
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'watch'),
        );
        expect(await holds(guest, prefix, 'read')).toBe(false);
    });

    it('withdraws a write grant without the read one beside it answering for it', async () => {
        // A narrower write handle under a wider read one: once the write one
        // is revoked, the read grant still answers reads there, never writes.
        const prefix = region('stale');
        await share(prefix, 'read');
        const narrow = await share(`${prefix}w:`, 'write');

        await shares().removeKvShare(owner.actor, narrow.handle);

        expect(await holds(guest, `${prefix}w:`, 'write')).toBe(false);
        expect(await holds(guest, `${prefix}w:k`, 'read')).toBe(true);
    });
});

describe('labels', () => {
    it('are set, changed, kept when omitted and cleared with null', async () => {
        const prefix = region('label');
        const first = await share(prefix, 'read', {
            label: '  Trip · from dan ',
        });
        expect(first.label).toBe('Trip · from dan');

        const changed = await share(prefix, 'read', { label: 'Trip 2027' });
        expect(changed.handle).toBe(first.handle);
        expect(changed.label).toBe('Trip 2027');

        expect((await share(prefix, 'write')).label).toBe('Trip 2027');
        expect(
            (await share(prefix, 'write', { label: null })).label,
        ).toBeNull();
        expect((await share(prefix, 'write', { label: 'again' })).label).toBe(
            'again',
        );
    });

    it('show in both listings and never in the handle cache', async () => {
        const prefix = region('listed');
        const { handle } = await share(prefix, 'read', { label: 'Groceries' });

        const byMe = await shares().listKvHandles(owner.actor, { limit: 200 });
        expect(byMe.items.find((row) => row.handle === handle)).toMatchObject({
            label: 'Groceries',
            access: 'read',
        });
        const withMe = await shares().listKvSharesWithMe(guest.actor, {
            limit: 200,
        });
        expect(withMe.items.find((row) => row.handle === handle)).toEqual(
            expect.objectContaining({ label: 'Groceries', access: 'read' }),
        );

        const live = await handles().getLive(handle);
        expect(live).not.toBeNull();
        expect(JSON.stringify(live)).not.toContain('Groceries');
    });

    it('refuses one with a text-direction override', async () => {
        await expect(
            share(region(), 'read', { label: 'a‮b' }),
        ).rejects.toMatchObject({ legacyCode: 'kv_share_label_invalid' });
    });
});

describe('owner revoke', () => {
    it('withdraws the region at every level and retires narrower handles at any level', async () => {
        const prefix = region('revoke');
        const broad = await share(prefix, 'write');
        const narrow = await share(`${prefix}inner:`, 'read');
        // What an interrupted level change leaves behind.
        await permissions().grantUserUserPermission(
            owner.actor,
            guest.username,
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'watch'),
        );

        const revoked = await shares().removeKvShare(owner.actor, broad.handle);
        expect(revoked.handle).toBe(broad.handle);

        expect(await grantRows(guest, prefix)).toEqual([]);
        expect(await grantRows(guest, `${prefix}inner:`)).toEqual([]);
        for (const handle of [broad.handle, narrow.handle]) {
            expect(await handles().getByHandle(handle)).toMatchObject({
                revokedBy: 'owner',
            });
            expect(await handles().getLive(handle)).toBeNull();
        }
    });

    it('answers a stranger and an unknown handle the same way', async () => {
        const { handle } = await share(region(), 'read');
        const unknown = `kvh-${uuidv4()}`;
        for (const [actor, named] of [
            [stranger.actor, handle],
            [stranger.actor, unknown],
            [owner.actor, unknown],
            [guest.actor, unknown],
        ] as const)
            await expect(
                shares().removeKvShare(actor, named),
            ).rejects.toMatchObject({
                statusCode: 404,
                legacyCode: 'subject_does_not_exist',
                message: `No such handle: ${named}`,
            });
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();
    });
});

describe('holder unshare', () => {
    it('drops only that grant, leaving the holder`s other handles and other holders alone', async () => {
        const left = region('left');
        const kept = region('kept');
        const dropping = await share(left, 'read');
        const other = await share(kept, 'read');
        const strangers = await share(left, 'read', { holder: stranger });

        await shares().removeKvShare(guest.actor, dropping.handle);

        expect(await holds(guest, left, 'watch')).toBe(false);
        expect(await grantRows(guest, left)).toEqual([]);
        expect(await holds(guest, kept, 'read')).toBe(true);
        expect(
            (await handles().getByHandle(other.handle))?.revokedAt,
        ).toBeNull();
        expect(await holds(stranger, left, 'read')).toBe(true);
        expect(
            (await handles().getByHandle(strangers.handle))?.revokedAt,
        ).toBeNull();
    });

    it('shows the owner who stopped it, and answers a second call with the same row', async () => {
        const { handle } = await share(region('twice'), 'write');
        const first = await shares().removeKvShare(guest.actor, handle);
        const again = await shares().removeKvShare(guest.actor, handle);
        expect(again).toEqual(first);

        const page = await shares().listKvHandles(owner.actor, { limit: 200 });
        expect(page.items.find((row) => row.handle === handle)).toMatchObject({
            revokedBy: 'holder',
            revokedAt: first.revokedAt,
        });
    });

    it('ends durable subscriptions on the handle even where a wider grant covers it', async () => {
        const prefix = region('wider');
        const broad = await share(prefix, 'read');
        const narrow = await share(`${prefix}n:`, 'read');
        const { sub } = await events().subscribeDurable(guest.actor, {
            subject: `kv:${narrow.handle}:*`,
        });

        await shares().removeKvShare(guest.actor, narrow.handle);

        expect(await suspendedReason(sub.subId)).toBe('permission_revoked');
        // The wider share is still the holder's.
        expect(await holds(guest, `${prefix}n:k`, 'read')).toBe(true);
        expect(
            (await handles().getByHandle(broad.handle))?.revokedAt,
        ).toBeNull();
    });

    it('lets the holder`s app give up a share in its own namespace, and no other app', async () => {
        const app = await makeApp();
        const sibling = await makeApp();
        const { handle } = await share(region('app'), 'read', {
            appUid: app.uid,
        });

        await expect(
            shares().removeKvShare(appActorFor(guest, sibling), handle),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
        await expect(
            shares().removeKvShare(appActorFor(guest, app), handle),
        ).resolves.toMatchObject({ handle });
    });

    it('refuses a scoped token the account did not give its whole reach', async () => {
        const { handle } = await share(region('token'), 'read');
        const scoped = makeActor({
            user: guest.actor.user as never,
            accessToken: {
                uid: `tok-${uuidv4()}`,
                issuer: guest.actor,
                authorized: null,
                fullAccess: false,
            },
        });
        await expect(
            shares().removeKvShare(scoped, handle),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });
});

describe('nested handles at different levels', () => {
    const layout = async () => {
        const room = `shared:${uuidv4().slice(0, 8)}:`;
        const mine = `${room}u:${uuidv4().slice(0, 8)}:`;
        const broad = await share(room, 'read');
        const narrow = await share(mine, 'write');
        return { room, mine, broad, narrow };
    };

    it('coexist as two handles, and only the narrow one carries writes', async () => {
        const { room, mine, broad, narrow } = await layout();
        expect(narrow.handle).not.toBe(broad.handle);
        expect(await grantRows(guest, room)).toEqual([
            kvSharePermission(owner.uuid, GLOBAL, room, 'read'),
        ]);
        expect(await grantRows(guest, mine)).toEqual([
            kvSharePermission(owner.uuid, GLOBAL, mine, 'write'),
        ]);
        // A call is checked against the handle's own prefix and level.
        expect(await holds(guest, room, 'write')).toBe(false);
        expect(await holds(guest, mine, 'write')).toBe(true);
        expect(await holds(guest, room, 'read')).toBe(true);
    });

    it('both go when the owner revokes the broad one', async () => {
        const { mine, broad, narrow } = await layout();
        await shares().removeKvShare(owner.actor, broad.handle);
        expect(await holds(guest, mine, 'write')).toBe(false);
        for (const handle of [broad.handle, narrow.handle])
            expect(await handles().getByHandle(handle)).toMatchObject({
                revokedBy: 'owner',
            });
    });

    it('both go when the holder gives up the broad one', async () => {
        const { room, mine, broad, narrow } = await layout();
        await shares().removeKvShare(guest.actor, broad.handle);
        expect(await grantRows(guest, room)).toEqual([]);
        expect(await grantRows(guest, mine)).toEqual([]);
        for (const handle of [broad.handle, narrow.handle])
            expect(await handles().getByHandle(handle)).toMatchObject({
                revokedBy: 'holder',
            });
    });

    it('revoking the narrow one leaves the broad one standing', async () => {
        const { room, mine, broad, narrow } = await layout();
        await shares().removeKvShare(owner.actor, narrow.handle);
        expect(await holds(guest, mine, 'write')).toBe(false);
        expect(await holds(guest, room, 'read')).toBe(true);
        expect(
            (await handles().getByHandle(broad.handle))?.revokedAt,
        ).toBeNull();
    });
});

describe('what has been shared with me', () => {
    it('lists live shares by handle, level, app and label, and nothing of the owner', async () => {
        const prefix = region('withme');
        const live = await share(prefix, 'write', { label: 'Plans' });
        const gone = await share(region('gone'), 'read');
        await shares().removeKvShare(owner.actor, gone.handle);

        const page = await shares().listKvSharesWithMe(guest.actor, {
            limit: 200,
        });
        const item = page.items.find((row) => row.handle === live.handle);
        expect(item).toEqual({
            handle: live.handle,
            access: 'write',
            appUid: GLOBAL,
            label: 'Plans',
            createdAt: expect.any(Number),
        });
        expect(page.items.some((row) => row.handle === gone.handle)).toBe(
            false,
        );
        const wire = JSON.stringify(page);
        expect(wire).not.toContain(owner.uuid);
        expect(wire).not.toContain(owner.username);
        expect(wire).not.toContain(prefix);
    });

    it('shows an app the shares in its own namespace only', async () => {
        const app = await makeApp();
        const inApp = await share(region('in-app'), 'read', {
            appUid: app.uid,
        });
        const global = await share(region('global'), 'read');

        const page = await shares().listKvSharesWithMe(
            appActorFor(guest, app),
            { limit: 200 },
        );
        expect(page.items.map((row) => row.handle)).toEqual([inApp.handle]);
        expect(page.items.some((row) => row.handle === global.handle)).toBe(
            false,
        );
    });

    it('pages with a cursor and counts on request', async () => {
        await share(region('page'), 'read');
        await share(region('page'), 'read');
        const first = await shares().listKvSharesWithMe(guest.actor, {
            limit: 1,
            includeTotal: true,
        });
        expect(first.items).toHaveLength(1);
        expect(first.cursor).toBeTypeOf('string');
        expect(first.total).toBeGreaterThanOrEqual(2);
        const second = await shares().listKvSharesWithMe(guest.actor, {
            limit: 1,
            cursor: first.cursor,
        });
        expect(second.items[0].handle).not.toBe(first.items[0].handle);
    });

    it('shows a scoped token nothing', async () => {
        await share(region('scoped'), 'read');
        const scoped = makeActor({
            user: guest.actor.user as never,
            accessToken: {
                uid: `tok-${uuidv4()}`,
                issuer: guest.actor,
                authorized: null,
                fullAccess: false,
            },
        });
        await expect(shares().listKvSharesWithMe(scoped)).resolves.toEqual({
            items: [],
        });
    });
});

describe('a handle bound to its holder', () => {
    it('refuses another user whose own grant covers the region', async () => {
        const prefix = region('bound');
        await share(prefix, 'read', { holder: stranger });
        const guests = await share(`${prefix}inner:`, 'read');

        await expect(
            events().subscribe(stranger.actor, SOCKET_ID, {
                subject: `kv:${guests.handle}:*`,
            }),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
        await expect(
            events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${guests.handle}:*`,
            }),
        ).resolves.toBeDefined();
        await events().reapSocket(guest.id, SOCKET_ID);
    });
});

describe('an app minting at a level', () => {
    it('mints up to the level its consent names, and no higher', async () => {
        const app = await makeApp();
        const actor = appActorFor(owner, app);
        const writeRegion = region('consent-write');
        const watchRegion = region('consent-watch');
        await permissions().grantUserAppPermission(
            owner.actor,
            app.uid,
            kvShareManagePermission(
                kvSharePermission(owner.uuid, app.uid, writeRegion, 'write'),
            ),
        );
        await permissions().grantUserAppPermission(
            owner.actor,
            app.uid,
            kvShareManagePermission(
                kvSharePermission(owner.uuid, app.uid, watchRegion),
            ),
        );

        for (const access of ['watch', 'read', 'write'] as const)
            await expect(
                share(`${writeRegion}${access}:`, access, { actor }),
            ).resolves.toMatchObject({ access });
        await expect(
            share(`${watchRegion}a:`, 'watch', { actor }),
        ).resolves.toMatchObject({ access: 'watch' });
        await expect(
            share(`${watchRegion}b:`, 'read', { actor }),
        ).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_not_delegated',
        });
    });

    it.each(['watch', 'read', 'write'] as const)(
        'is refused while an unbounded %s consent exists on the namespace',
        async (level) => {
            const app = await makeApp();
            const actor = appActorFor(owner, app);
            const prefix = region('unbounded');
            await permissions().grantUserAppPermission(
                owner.actor,
                app.uid,
                kvShareManagePermission(
                    kvSharePermission(owner.uuid, app.uid, prefix, 'write'),
                ),
            );
            const root = kvShareManagePermission(
                kvSharePermission(owner.uuid, app.uid, '', level),
            );
            await env.server.stores.permission.upsertUserAppPerm(
                owner.id,
                app.id,
                root,
                {},
            );
            await permissions().bumpPermissionCacheForUsernames([
                owner.username,
            ]);

            await expect(
                share(prefix, 'write', { actor }),
            ).rejects.toMatchObject({
                legacyCode: 'events_kv_handle_not_delegated',
            });
        },
    );
});

describe('when an app is deleted', () => {
    it('retires every handle in its namespace as the platform`s, and ends their subscriptions', async () => {
        const app = await makeApp();
        const inApp = await share(region('deleted'), 'write', {
            appUid: app.uid,
        });
        const global = await share(region('survives'), 'read');
        const { sub } = await events().subscribeDurable(guest.actor, {
            subject: `kv:${inApp.handle}:*`,
        });

        const row = await env.server.stores.app.getByUid(app.uid);
        await env.server.clients.event.emitAndWait(
            'app.changed',
            { app_uid: app.uid, app: null, old_app: row, action: 'deleted' },
            {},
        );

        expect(await handles().getByHandle(inApp.handle)).toMatchObject({
            revokedBy: 'system',
        });
        expect(await handles().getLive(inApp.handle)).toBeNull();
        expect(await suspendedReason(sub.subId)).toBe('permission_revoked');
        expect(
            (await handles().getByHandle(global.handle))?.revokedAt,
        ).toBeNull();
    });
});

describe('the handle cache', () => {
    it('serves a live handle without the database, and forgets it on retire', async () => {
        const { handle } = await share(region('cache'), 'read');
        await handles().getLive(handle);

        const read = vi.spyOn(env.server.clients.db, 'read');
        const pread = vi.spyOn(env.server.clients.db, 'pread');
        try {
            const live = await handles().getLive(handle);
            expect(live).toMatchObject({
                row: { handle, granteeUserId: guest.id },
                ownerUuid: owner.uuid,
                ownerSuspended: false,
            });
            expect(read).not.toHaveBeenCalled();
            expect(pread).not.toHaveBeenCalled();
        } finally {
            read.mockRestore();
            pread.mockRestore();
        }

        await shares().removeKvShare(guest.actor, handle);
        expect(await handles().getLive(handle)).toBeNull();
    });

    it('remembers a miss for a moment', async () => {
        const unknown = `kvh-${uuidv4()}`;
        expect(await handles().getLive(unknown)).toBeNull();
        const read = vi.spyOn(env.server.clients.db, 'read');
        try {
            expect(await handles().getLive(unknown)).toBeNull();
            expect(read).not.toHaveBeenCalled();
        } finally {
            read.mockRestore();
        }
    });

    it('silences a session subscription on a retired handle even where a wider grant covers it', async () => {
        const prefix = region('silent');
        await share(prefix, 'read');
        const narrow = await share(`${prefix}n:`, 'read');
        const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${narrow.handle}:*`,
        });

        await handles().retireAsHolder(narrow.handle, guest.id);
        delivered.length = 0;
        await ownerWrites(`${prefix}n:k`, 'x');
        await quiet();
        expect(delivered.some((one) => one.subId === sub.subId)).toBe(false);
        await events().reapSocket(guest.id, SOCKET_ID);
    });
});

describe('with every feature flag off', () => {
    it('still lists, revokes and unshares', async () => {
        const { handle: ownerSide } = await share(region('off-a'), 'read');
        const { handle: holderSide } = await share(region('off-b'), 'read');
        const config = liveConfig();
        const saved = { events: config.events, kv: config.kv };
        config.events = { ...config.events, enabled: false, kvHandles: false };
        config.kv = { shareHandles: false };
        try {
            await expect(
                shares().listKvHandles(owner.actor),
            ).resolves.toHaveProperty('items');
            await expect(
                shares().listKvSharesWithMe(guest.actor),
            ).resolves.toHaveProperty('items');
            await expect(
                shares().removeKvShare(owner.actor, ownerSide),
            ).resolves.toMatchObject({ handle: ownerSide });
            await expect(
                shares().removeKvShare(guest.actor, holderSide),
            ).resolves.toMatchObject({ handle: holderSide });
        } finally {
            config.events = saved.events;
            config.kv = saved.kv;
        }
    });
});

describe('grants left behind by a retired handle', () => {
    it('go with an app deletion, so a later watch share of the region stays watch', async () => {
        const app = await makeApp();
        const prefix = region('stale');
        await share(prefix, 'write', { appUid: app.uid });
        await share(`${prefix}deep:`, 'write', { appUid: app.uid });

        const row = await env.server.stores.app.getByUid(app.uid);
        await env.server.clients.event.emitAndWait(
            'app.changed',
            { app_uid: app.uid, app: null, old_app: row, action: 'deleted' },
            {},
        );
        expect(await grantRows(guest, prefix, app.uid)).toEqual([]);
        expect(await grantRows(guest, `${prefix}deep:`, app.uid)).toEqual([]);

        // An origin-derived uid comes back when the app is registered again.
        const { handle } = await share(prefix, 'watch', { appUid: app.uid });
        await expect(guestSet(handle, 'k', 1)).rejects.toMatchObject({
            legacyCode: 'kv_handle_access_denied',
        });
    });

    it('go when a level change loses a race with a revoke', async () => {
        const prefix = region('race');
        await share(prefix, 'read');
        const store = handles();
        const update = store.update.bind(store);
        const raced = vi
            .spyOn(store, 'update')
            .mockImplementationOnce(async (named, ownerUserId, changes) => {
                // The revoke withdrew the region before the new grant landed,
                // and retires the row before this write.
                await store.retire(named, ownerUserId);
                return update(named, ownerUserId, changes);
            });
        try {
            await expect(share(prefix, 'write')).rejects.toMatchObject({
                legacyCode: 'subject_does_not_exist',
            });
        } finally {
            raced.mockRestore();
        }
        expect(await grantRows(guest, prefix)).toEqual([]);

        const { handle } = await share(prefix, 'watch');
        await expect(guestSet(handle, 'k', 1)).rejects.toMatchObject({
            legacyCode: 'kv_handle_access_denied',
        });
    });

    it('at another level on exactly the region are cleared by a new share, and nested ones are not', async () => {
        const prefix = region('fresh');
        const nested = await share(`${prefix}inner:`, 'write');
        await permissions().grantUserUserPermission(
            owner.actor,
            guest.username,
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'write'),
        );

        const { handle } = await share(prefix, 'watch');
        expect(await grantRows(guest, prefix)).toEqual([
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'watch'),
        ]);
        await expect(guestSet(handle, 'k', 1)).rejects.toMatchObject({
            legacyCode: 'kv_handle_access_denied',
        });
        await expect(guestSet(nested.handle, 'k', 1)).resolves.toBe(true);
    });
});

describe('revoking a share that already stopped', () => {
    it('answers with the same row and leaves a newer share of the region alone', async () => {
        const prefix = region('again');
        const first = await share(prefix, 'read');
        const revoked = await shares().removeKvShare(owner.actor, first.handle);
        const second = await share(prefix, 'read');
        expect(second.handle).not.toBe(first.handle);

        await expect(
            shares().removeKvShare(owner.actor, first.handle),
        ).resolves.toEqual(revoked);
        await expect(
            shares().revokeKvHandle(owner.actor, first.handle),
        ).resolves.toEqual(revoked);
        expect(await holds(guest, prefix, 'read')).toBe(true);
        expect(
            (await handles().getByHandle(second.handle))?.revokedAt,
        ).toBeNull();
    });
});

describe('a level change racing a retire', () => {
    it('loses to an owner revoke when it lands between the revoke and the retire', async () => {
        const prefix = region('race-owner');
        const { handle } = await share(prefix, 'read');
        const store = handles();
        const retire = store.retire.bind(store);
        const raced = vi
            .spyOn(store, 'retire')
            .mockImplementationOnce(async (...args) => {
                // The row still reads live, so the change goes through.
                await share(prefix, 'write');
                return retire(...args);
            });
        try {
            await shares().removeKvShare(owner.actor, handle);
        } finally {
            raced.mockRestore();
        }
        expect(await grantRows(guest, prefix)).toEqual([]);
        expect(await holds(guest, prefix, 'watch')).toBe(false);
    });

    it('loses to a holder unshare when it lands between the revoke and the retire', async () => {
        const prefix = region('race-holder');
        const { handle } = await share(prefix, 'read');
        const store = handles();
        const retireAsHolder = store.retireAsHolder.bind(store);
        const raced = vi
            .spyOn(store, 'retireAsHolder')
            .mockImplementationOnce(async (...args) => {
                await share(prefix, 'write');
                return retireAsHolder(...args);
            });
        try {
            await shares().removeKvShare(guest.actor, handle);
        } finally {
            raced.mockRestore();
        }
        expect(await grantRows(guest, prefix)).toEqual([]);
        expect(await holds(guest, prefix, 'watch')).toBe(false);
    });
});

describe('two level changes racing', () => {
    it('leaves only the grant the row names', async () => {
        const prefix = region('race-levels');
        const { handle } = await share(prefix, 'write');
        const store = handles();
        const update = store.update.bind(store);
        let second: unknown;
        const raced = vi
            .spyOn(store, 'update')
            .mockImplementationOnce(async (...args) => {
                // Another change starts and runs while this one is mid-way.
                try {
                    await share(prefix, 'read');
                } catch (err) {
                    second = err;
                }
                return update(...args);
            });
        try {
            await share(prefix, 'watch');
        } finally {
            raced.mockRestore();
        }

        const row = await handles().getByHandle(handle);
        expect(await grantRows(guest, prefix)).toEqual([row!.permission]);
        // The one that waited its turn was told to retry.
        expect(second).toMatchObject({ legacyCode: 'too_many_requests' });
        expect(row!.permission).toBe(
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'watch'),
        );
    });
});

describe('an app deletion that fails partway', () => {
    it('withdraws the grants before retiring the handles, so a retry finishes it', async () => {
        const app = await makeApp();
        const prefix = region('retry');
        const { handle } = await share(prefix, 'write', { appUid: app.uid });
        const row = await env.server.stores.app.getByUid(app.uid);
        const deleted = () =>
            env.server.clients.event.emitAndWait(
                'app.changed',
                {
                    app_uid: app.uid,
                    app: null,
                    old_app: row,
                    action: 'deleted',
                },
                {},
            );

        const failing = vi
            .spyOn(permissions(), 'revokeUserUserPermissionSubtree')
            .mockRejectedValueOnce(new Error('database went away'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await deleted();
        } finally {
            failing.mockRestore();
            warn.mockRestore();
        }
        expect((await handles().getByHandle(handle))?.revokedAt).toBeNull();

        await deleted();
        expect(await grantRows(guest, prefix, app.uid)).toEqual([]);
        expect(await handles().getByHandle(handle)).toMatchObject({
            revokedBy: 'system',
        });
    });
});

describe('when a developer`s account is deleted', () => {
    const allHeld = async (user: TestUser) => {
        const held: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await shares().listKvSharesWithMe(user.actor, {
                limit: 200,
                cursor,
            });
            held.push(...page.items.map((row) => row.handle));
            cursor = page.cursor;
        } while (cursor);
        return held;
    };

    it('retires the handles in their apps` namespaces and withdraws the grants', async () => {
        const devName = `kv-dev-${uuidv4().slice(0, 8)}`;
        await createTestUser(env.server, {
            username: devName,
            password: 'pw-test-1234',
        });
        const dev = await userFor(devName);
        const name = `kv-dev-app-${uuidv4().slice(0, 8)}`;
        const app = await env.server.stores.app.create(
            {
                name,
                title: 'Developer App',
                index_url: `https://${name}.example.test/index.html`,
            },
            { ownerUserId: dev.id },
        );
        const prefix = region('dev-gone');
        const { handle } = await share(prefix, 'write', { appUid: app.uid });
        const elsewhere = await share(region('dev-stays'), 'read');
        expect(await allHeld(guest)).toContain(handle);

        await env.server.services.userAccount.cascadeDelete(dev.id);

        await vi.waitFor(
            async () =>
                expect(await handles().getByHandle(handle)).toMatchObject({
                    revokedBy: 'system',
                }),
            { timeout: 5_000 },
        );
        expect(await grantRows(guest, prefix, app.uid)).toEqual([]);
        expect(await allHeld(guest)).not.toContain(handle);
        expect(
            (await handles().getByHandle(elsewhere.handle))?.revokedAt,
        ).toBeNull();
    });
});

describe('the app a share names', () => {
    const noNamespace = {
        statusCode: 400,
        legacyCode: 'bad_request',
        message: '`appUid` does not name a namespace',
    };

    it('has to exist when an account names it, refused like a malformed uid', async () => {
        await expect(
            share(region('bad-uid'), 'read', { appUid: 'not-an-app' }),
        ).rejects.toMatchObject(noNamespace);
        await expect(
            share(region('no-app'), 'read', { appUid: `app-${uuidv4()}` }),
        ).rejects.toMatchObject(noNamespace);

        const app = await makeApp();
        await env.server.stores.app.delete(app.id);
        await expect(
            share(region('gone-app'), 'read', { appUid: app.uid }),
        ).rejects.toMatchObject(noNamespace);
    });
});

describe('retiring several handles', () => {
    it('takes one statement for all the narrower handles of a revoke or an unshare', async () => {
        for (const by of [owner, guest]) {
            const prefix = region('many');
            const broad = await share(prefix, 'read');
            for (const inner of ['a', 'b', 'c'])
                await share(`${prefix}${inner}:`, 'write');

            const write = vi.spyOn(env.server.clients.db, 'write');
            try {
                await shares().removeKvShare(by.actor, broad.handle);
                const retires = write.mock.calls.filter(([sql]) =>
                    String(sql).startsWith(
                        'UPDATE `kv_share_handles` SET `revoked_at`',
                    ),
                );
                // The broad handle, then the three inside it.
                expect(retires).toHaveLength(2);
            } finally {
                write.mockRestore();
            }
        }
    });
});

describe('a fresh share`s leftover check', () => {
    it('revokes other levels on the region only when the holder has one', async () => {
        const revoke = vi.spyOn(permissions(), 'revokeUserUserPermissions');
        const prefix = region('leftover');
        try {
            await share(region('clean'), 'read');
            expect(revoke).not.toHaveBeenCalled();

            await permissions().grantUserUserPermission(
                owner.actor,
                guest.username,
                kvSharePermission(owner.uuid, GLOBAL, prefix, 'write'),
            );
            await share(prefix, 'read');
            expect(revoke).toHaveBeenCalledTimes(1);
        } finally {
            revoke.mockRestore();
        }
        expect(await holds(guest, prefix, 'write')).toBe(false);
    });

    it('also finds a leftover flat entry with no row behind it', async () => {
        const prefix = region('flat-only');
        const stale = kvSharePermission(owner.uuid, GLOBAL, prefix, 'write');
        await env.server.stores.permission.setFlatUserPerm(guest.id, stale, {
            permission: stale,
            issuer_user_id: owner.id,
            deleted: false,
        });
        await share(prefix, 'watch');
        expect(
            await env.server.stores.permission.getFlatUserPerms(guest.id, [
                stale,
            ]),
        ).toEqual([]);
    });
});

describe('a retired handle`s owner', () => {
    it('loses the durable subscriptions they made through it too', async () => {
        const { handle } = await share(region('owner-sub'), 'read');
        const { sub } = await events().subscribeDurable(owner.actor, {
            subject: `kv:${handle}:*`,
        });

        await shares().removeKvShare(guest.actor, handle);

        expect(await suspendedReason(sub.subId)).toBe('permission_revoked');
    });
});

describe('a holder`s unshare, settled', () => {
    it('announces the retired handles at once, and withdraws their grants in one delete each side of the retire', async () => {
        const prefix = region('batch');
        const broad = await share(prefix, 'read');
        const narrow = await share(`${prefix}n:`, 'write');
        const subs = await Promise.all(
            [broad, narrow].map(({ handle }) =>
                events().subscribeDurable(guest.actor, {
                    subject: `kv:${handle}:*`,
                }),
            ),
        );

        const bus = env.server.clients.event;
        const store = env.server.stores.permission;
        const announced = vi.spyOn(bus, 'emitAndWait');
        const emitted = vi.spyOn(bus, 'emit');
        const single = vi.spyOn(store, 'deleteUserUserPermByHolder');
        const batch = vi.spyOn(store, 'deleteUserUserPermsByHolder');
        try {
            await shares().removeKvShare(guest.actor, broad.handle);

            // One event for each side, since either may have subscribed.
            const retired = announced.mock.calls
                .filter(([key]) => key === 'kv.share.retired')
                .map(
                    ([, data]) => data as { userId: number; handles: string[] },
                );
            expect(retired.map(({ userId }) => userId).sort()).toEqual(
                [guest.id, owner.id].sort(),
            );
            for (const { handles } of retired)
                expect(handles.sort()).toEqual(
                    [broad.handle, narrow.handle].sort(),
                );
            expect(single).not.toHaveBeenCalled();
            expect(batch).toHaveBeenCalledTimes(2);
            // Every grant that went is still announced on its own.
            const revoked = emitted.mock.calls
                .filter(([key]) => key === 'permission.revoked')
                .map(([, data]) => (data as { permission: string }).permission);
            expect(revoked.sort()).toEqual(
                [
                    kvSharePermission(owner.uuid, GLOBAL, prefix, 'read'),
                    kvSharePermission(
                        owner.uuid,
                        GLOBAL,
                        `${prefix}n:`,
                        'write',
                    ),
                ].sort(),
            );
        } finally {
            announced.mockRestore();
            emitted.mockRestore();
            single.mockRestore();
            batch.mockRestore();
        }
        for (const { sub } of subs)
            expect(await suspendedReason(sub.subId)).toBe('permission_revoked');
    });
});

describe('an app changing a share', () => {
    it('needs the consent the existing share stands on, not only the one it asks for', async () => {
        const app = await makeApp();
        const actor = appActorFor(owner, app);
        const prefix = region('change');
        await share(prefix, 'write', { appUid: app.uid });
        await permissions().grantUserAppPermission(
            owner.actor,
            app.uid,
            kvShareManagePermission(
                kvSharePermission(owner.uuid, app.uid, prefix, 'read'),
            ),
        );

        for (const label of [undefined, 'Lowered'])
            await expect(
                share(prefix, 'read', { actor, label }),
            ).rejects.toMatchObject({
                legacyCode: 'events_kv_handle_not_delegated',
            });
        expect(await grantRows(guest, prefix, app.uid)).toEqual([
            kvSharePermission(owner.uuid, app.uid, prefix, 'write'),
        ]);
    });

    it('changes one its consent covers', async () => {
        const app = await makeApp();
        const actor = appActorFor(owner, app);
        const prefix = region('covered');
        await share(prefix, 'write', { appUid: app.uid });
        await permissions().grantUserAppPermission(
            owner.actor,
            app.uid,
            kvShareManagePermission(
                kvSharePermission(owner.uuid, app.uid, prefix, 'write'),
            ),
        );
        await expect(
            share(prefix, 'read', { actor, label: 'Lowered' }),
        ).resolves.toMatchObject({ access: 'read', label: 'Lowered' });
    });

    it('without the consent learns nothing about whether the recipient exists', async () => {
        const app = await makeApp();
        await expect(
            shares().mintKvHandle(
                appActorFor(owner, app),
                {
                    prefix: region('probe'),
                    recipient: { username: `nobody-${uuidv4().slice(0, 8)}` },
                    access: 'read',
                },
                { defaultAccess: 'read' },
            ),
        ).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_not_delegated',
        });
    });
});

describe('an app checking a share through its user', () => {
    const deepRegion = (prefix: string, depth: number) =>
        `${prefix}${Array.from({ length: depth }, (_, i) => `s${i}`).join(':')}:`;

    it('asks its user once, however deep the region', async () => {
        const app = await makeApp();
        const actor = appActorFor(guest, app);
        const permission = kvSharePermission(
            owner.uuid,
            app.uid,
            deepRegion(region('deep'), 70),
            'read',
        );
        const check = vi.spyOn(permissions(), 'check');
        try {
            expect(await permissions().check(actor, permission)).toBe(false);
            // The call itself, and the one check of its user.
            expect(check).toHaveBeenCalledTimes(2);
        } finally {
            check.mockRestore();
        }
    });

    it('answers from the user`s grant on any ancestor, at its level or above, until it is revoked', async () => {
        const app = await makeApp();
        const actor = appActorFor(guest, app);
        const prefix = region('ancestor');
        const { handle } = await share(prefix, 'read', { appUid: app.uid });
        const deep = deepRegion(prefix, 5);
        const asks = (access: KvShareAccess) =>
            permissions().check(
                actor,
                kvSharePermission(owner.uuid, app.uid, deep, access),
            );

        expect(await asks('watch')).toBe(true);
        expect(await asks('read')).toBe(true);
        expect(await asks('write')).toBe(false);
        await shares().removeKvShare(owner.actor, handle);
        expect(await asks('read')).toBe(false);
        expect(await asks('watch')).toBe(false);
    });
});

describe('the characters a new share`s prefix may use', () => {
    it.each(['Notes:', 'notes:Abc:', 'café:', 'a b:', 'emoji-\u{1F600}:'])(
        'refuses %s',
        async (prefix) => {
            await expect(share(prefix, 'read')).rejects.toMatchObject({
                legacyCode: 'invalid_kv_share_prefix',
            });
            await expect(share(prefix, 'watch')).rejects.toMatchObject({
                legacyCode: 'invalid_kv_share_prefix',
            });
        },
    );

    it('accepts lowercase letters, digits, `_`, `.` and `-`, and answers an exact re-share with the same handle', async () => {
        const prefix = `ok_1.a-b:${uuidv4().slice(0, 8)}:`;
        const first = await share(prefix, 'read');
        await expect(share(prefix, 'read')).resolves.toMatchObject({
            handle: first.handle,
        });
    });

    describe('on a share made before the rule', () => {
        const legacy = async (prefix: string) => {
            const permission = kvSharePermission(
                owner.uuid,
                GLOBAL,
                prefix,
                'read',
            );
            await permissions().grantUserUserPermission(
                owner.actor,
                guest.username,
                permission,
            );
            return handles().mint({
                ownerUserId: owner.id,
                granteeUserId: guest.id,
                appUid: GLOBAL,
                keyPrefix: prefix,
                permission,
            });
        };

        it('leaves it usable, and its level and label changeable', async () => {
            const prefix = `Notes-${uuidv4().slice(0, 8)}:`;
            const { handle } = await legacy(prefix);
            await ownerWrites(`${prefix}k`, 'v');
            expect(await guestGet(handle, 'k')).toBe('v');

            await expect(
                share(prefix, 'write', { label: 'Kept' }),
            ).resolves.toMatchObject({
                handle,
                access: 'write',
                label: 'Kept',
            });
            await expect(guestSet(handle, 'k', 'w')).resolves.toBe(true);
        });

        it('refuses a new share whose prefix differs from it only in case', async () => {
            const prefix = `Notes-${uuidv4().slice(0, 8)}:`;
            await legacy(prefix);
            await expect(
                share(prefix.toLowerCase(), 'read'),
            ).rejects.toMatchObject({ legacyCode: 'invalid_kv_share_prefix' });
            // Another holder's grants never collide with this one's.
            await expect(
                share(prefix.toLowerCase(), 'read', { holder: stranger }),
            ).resolves.toMatchObject({ access: 'read' });
        });
    });
});
