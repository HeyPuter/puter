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
 * Key-value calls through a share handle, against the real stack: how a handle
 * resolves, what it confines a call to, every list option, private entries, app
 * and token scoping, what the writes publish, and what a warm call costs.
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
import type { DeliveryEnvelope } from '../../services/events/EventsService.js';
import {
    KV_HANDLE_KEY_MAX_BYTES,
    kvSharePermission,
    type KvShareAccess,
} from '../../services/kvShare/kvShares.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { openCursor } from '../../util/pagination.js';
import type { KVStoreDriver } from './KVStoreDriver.js';

const BOOT_TIMEOUT_MS = 120_000;
const GLOBAL = 'os-global';
/** Handle cursors are sealed under it; the tests open them to check the shape. */
const SECRET = 'kv-handle-cursor-test-secret';

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
    uuid: string;
    creds: TestUserCredentials;
}

let env: PuterTestEnv;
let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;
let delivered: DeliveryEnvelope[];

const kv = (): KVStoreDriver => env.server.drivers.kvStore;
const shares = () => env.server.services.kvShare;
const handles = () => env.server.stores.kvShareHandle;
const events = () => env.server.services.events;

/** The config the driver reads, for flipping a flag inside one test. */
const liveConfig = () => (kv() as unknown as { config: IConfig }).config;

const userFor = async (creds: TestUserCredentials): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(creds.username);
    return {
        actor: makeActor({ user: row as never }),
        username: creds.username,
        id: row!.id,
        uuid: row!.uuid as string,
        creds,
    };
};

const as = <T>(actor: Actor, call: (driver: KVStoreDriver) => Promise<T>) =>
    runWithContext({ actor }, () => call(kv()));

const via = (handle: string, extra: Record<string, unknown> = {}) => ({
    optConfig: { handle, ...extra },
});

/** A fresh region, so one test's grants and keys never meet another's. */
const region = (label = 'r') => `${label}-${uuidv4().slice(0, 8)}:`;

const share = (
    prefix: string,
    access: KvShareAccess,
    opts: { holder?: TestUser; appUid?: string; actor?: Actor } = {},
) =>
    shares().mintKvHandle(
        opts.actor ?? owner.actor,
        {
            prefix,
            recipient: { username: (opts.holder ?? guest).username },
            access,
            ...(opts.appUid ? { appUid: opts.appUid } : {}),
        },
        { defaultAccess: 'read' },
    );

/** A share made before new prefixes were held to lowercase ASCII. */
const legacyShare = async (prefix: string, access: KvShareAccess) => {
    const permission = kvSharePermission(owner.uuid, GLOBAL, prefix, access);
    await env.server.services.permission.grantUserUserPermission(
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

const ownerSet = (
    key: string,
    value: unknown,
    extra: { disableSharing?: boolean; expireAt?: number } = {},
) =>
    as(owner.actor, (driver) =>
        driver.set({
            key,
            value,
            ...(extra.expireAt ? { expireAt: extra.expireAt } : {}),
            ...(extra.disableSharing
                ? { optConfig: { disableSharing: true } }
                : {}),
        }),
    );

const ownerGet = (key: string | string[]) =>
    as(owner.actor, (driver) => driver.get({ key }));

const guestGet = (handle: string, key: unknown, actor = guest.actor) =>
    as(actor, (driver) => driver.get({ key, ...via(handle) }));

const guestSet = (handle: string, key: unknown, value: unknown) =>
    as(guest.actor, (driver) => driver.set({ key, value, ...via(handle) }));

const later = () => Math.floor(Date.now() / 1000) + 3600;
const earlier = () => Math.floor(Date.now() / 1000) - 10;

const makeApp = async (ownerUserId = owner.id) => {
    const name = `kv-handles-${uuidv4().slice(0, 8)}`;
    return env.server.stores.app.create(
        {
            name,
            title: 'Handles App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId },
    );
};

const appActorFor = (user: TestUser, app: { uid: string; id: number }) =>
    makeActor({
        user: user.actor.user as never,
        app: { uid: app.uid, id: app.id },
    });

/** One `/drivers/call` to the KV driver, the way the SDK makes it. */
const drive = async (
    token: string,
    method: string,
    args: Record<string, unknown>,
): Promise<{ status: number; text: string; body: Record<string, unknown> }> => {
    const res = await fetch(new URL('/drivers/call', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ interface: 'puter-kvstore', method, args }),
    });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) };
};

const decode = (cursor: unknown) => openCursor(String(cursor), SECRET);
const encode = (payload: unknown) =>
    Buffer.from(JSON.stringify(payload)).toString('base64');

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        kv: { shareHandles: true },
        unlimitedMetering: true,
        jwt_secret_v2: SECRET,
    } as IConfig);

    const strangerCreds = await createTestUser(env.server, {
        username: `kv-drv-${uuidv4().slice(0, 8)}`,
        password: 'pw-test-1234',
    });
    owner = await userFor(env.users.user);
    guest = await userFor(env.users.other);
    stranger = await userFor(strangerCreds);

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

// Every mint spends the 60/min budget, and this file makes more than that.
beforeEach(async () => {
    for (const user of [owner, guest, stranger]) {
        await env.server.clients.redis.del(
            `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${user.id}`,
        );
        await env.server.clients.redis.del(`rate:events:subscribe:${user.id}`);
    }
});

describe('a call through a handle', () => {
    it('reads the owner`s keys by their names under the handle', async () => {
        const prefix = region('read');
        await ownerSet(`${prefix}a`, 1);
        await ownerSet(`${prefix}b`, { two: 2 });
        await ownerSet(`x${prefix}a`, 'outside');
        const { handle } = await share(prefix, 'read');

        expect(await guestGet(handle, 'a')).toBe(1);
        expect(await guestGet(handle, ['a', 'b', 'missing'])).toEqual([
            1,
            { two: 2 },
            null,
        ]);
        expect(
            await as(guest.actor, (driver) =>
                driver.list({ as: 'keys', ...via(handle) }),
            ),
        ).toEqual(['a', 'b']);
    });

    it('writes into the owner`s namespace with every write method', async () => {
        const prefix = region('write');
        const { handle } = await share(prefix, 'write');
        const g = <T>(call: (driver: KVStoreDriver) => Promise<T>) =>
            as(guest.actor, call);

        await g((d) =>
            d.set({ key: 'doc', value: { list: [], n: 1 }, ...via(handle) }),
        );
        await g((d) =>
            d.update({
                key: 'doc',
                pathAndValueMap: { title: 'Trip' },
                ...via(handle),
            }),
        );
        await g((d) =>
            d.incr({ key: 'doc', pathAndAmountMap: { n: 2 }, ...via(handle) }),
        );
        await g((d) =>
            d.decr({ key: 'doc', pathAndAmountMap: { n: 1 }, ...via(handle) }),
        );
        await g((d) =>
            d.add({
                key: 'doc',
                pathAndValueMap: { list: 'x' },
                ...via(handle),
            }),
        );
        // A write level reads too, so the removal answers with the value.
        expect(
            await g((d) =>
                d.remove({ key: 'doc', paths: ['title'], ...via(handle) }),
            ),
        ).toEqual({ list: ['x'], n: 2 });
        await g((d) =>
            d.batchPut({
                items: [
                    { key: 'b1', value: 1 },
                    { key: 'b2', value: 2, expireAt: later() },
                ],
                ...via(handle),
            }),
        );
        await g((d) => d.expire({ key: 'b1', ttl: 3600, ...via(handle) }));
        await g((d) =>
            d.expireAt({ key: 'b2', timestamp: later(), ...via(handle) }),
        );
        await g((d) =>
            d.set({ key: 'gone', value: 1, expireAt: later(), ...via(handle) }),
        );
        await g((d) => d.del({ key: 'gone', ...via(handle) }));

        expect(await ownerGet(`${prefix}doc`)).toEqual({ list: ['x'], n: 2 });
        expect(
            await ownerGet([`${prefix}b1`, `${prefix}b2`, `${prefix}gone`]),
        ).toEqual([1, 2, null]);
        // Nothing landed in the holder's own namespace.
        expect(
            await as(guest.actor, (d) => d.get({ key: `${prefix}doc` })),
        ).toBeNull();
    });

    it('works for the owner too', async () => {
        const prefix = region('own');
        await ownerSet(`${prefix}k`, 'v');
        const { handle } = await share(prefix, 'read');
        expect(await guestGet(handle, 'k', owner.actor)).toBe('v');
    });
});

describe('the level a call needs', () => {
    const writes = (handle: string) => [
        (d: KVStoreDriver) => d.set({ key: 'k', value: 1, ...via(handle) }),
        (d: KVStoreDriver) =>
            d.batchPut({ items: [{ key: 'k', value: 1 }], ...via(handle) }),
        (d: KVStoreDriver) =>
            d.incr({ key: 'k', pathAndAmountMap: { '': 1 }, ...via(handle) }),
        (d: KVStoreDriver) =>
            d.update({ key: 'k', pathAndValueMap: { a: 1 }, ...via(handle) }),
        (d: KVStoreDriver) => d.del({ key: 'k', ...via(handle) }),
        (d: KVStoreDriver) => d.expire({ key: 'k', ttl: 60, ...via(handle) }),
    ];

    it('refuses a read through a watch handle', async () => {
        const { handle } = await share(region('watch'), 'watch');
        for (const call of [
            (d: KVStoreDriver) => d.get({ key: 'k', ...via(handle) }),
            (d: KVStoreDriver) => d.list({ ...via(handle) }),
        ])
            await expect(as(guest.actor, call)).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'kv_handle_access_denied',
            });
    });

    it('refuses every write through a read handle', async () => {
        const { handle } = await share(region('ro'), 'read');
        for (const call of writes(handle))
            await expect(as(guest.actor, call)).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'kv_handle_access_denied',
            });
    });

    it('refuses a write through the broad read handle into a narrower write region', async () => {
        const room = region('room');
        const mine = `${room}u:${uuidv4().slice(0, 8)}:`;
        const broad = await share(room, 'read');
        const narrow = await share(mine, 'write');
        const inMine = `${mine.slice(room.length)}msg`;

        await expect(
            guestSet(broad.handle, inMine, 'through the broad one'),
        ).rejects.toMatchObject({ legacyCode: 'kv_handle_access_denied' });
        await guestSet(narrow.handle, 'msg', 'through the narrow one');
        expect(await guestGet(broad.handle, inMine)).toBe(
            'through the narrow one',
        );
    });

    it('refuses a watch handle past the read prefix cap, even where a wider grant reads it', async () => {
        const room = region('cap');
        // Past 256 bytes while the grant stays under its character limit.
        const deep = `${room}${'é'.repeat(130)}:`;
        await ownerSet(`${deep}k`, 'v');
        const broad = await share(room, 'read');
        const watch = await legacyShare(deep, 'watch');

        expect(
            await guestGet(broad.handle, `${deep.slice(room.length)}k`),
        ).toBe('v');
        await expect(guestGet(watch.handle, 'k')).rejects.toMatchObject({
            legacyCode: 'kv_handle_access_denied',
        });
    });
});

describe('a call refused before the handle is looked at', () => {
    it('answers kv_handles_disabled while kv.shareHandles is off', async () => {
        const { handle } = await share(region(), 'read');
        const config = liveConfig();
        config.kv = { shareHandles: false };
        try {
            await expect(guestGet(handle, 'k')).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'kv_handles_disabled',
            });
        } finally {
            config.kv = { shareHandles: true };
        }
    });

    it('refuses appUuid, disableSharing, a non-string handle and flush', async () => {
        const { handle } = await share(region(), 'write');
        for (const call of [
            (d: KVStoreDriver) =>
                d.get({ key: 'k', ...via(handle, { appUuid: 'app-other' }) }),
            (d: KVStoreDriver) =>
                d.set({
                    key: 'k',
                    value: 1,
                    ...via(handle, { disableSharing: true }),
                }),
            (d: KVStoreDriver) => d.flush({ ...via(handle) }),
            (d: KVStoreDriver) =>
                d.get({ key: 'k', optConfig: { handle: 42 as never } }),
        ])
            await expect(as(guest.actor, call)).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'kv_handle_option_invalid',
            });
    });

    it('holds keys to the fixed relative limit, whatever the prefix', async () => {
        const { handle } = await share(region('len'), 'write');
        const longest = 'k'.repeat(KV_HANDLE_KEY_MAX_BYTES);
        await guestSet(handle, longest, 'fits');
        expect(await guestGet(handle, longest)).toBe('fits');

        const refusals = [
            () => guestSet(handle, `${longest}k`, 1),
            () => guestSet(handle, '', 1),
            () => guestGet(handle, ['ok', `${longest}k`]),
            () =>
                as(guest.actor, (d) =>
                    d.batchPut({
                        items: [{ key: `${longest}k`, value: 1 }],
                        ...via(handle),
                    }),
                ),
        ];
        for (const refused of refusals)
            await expect(refused()).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'kv_handle_key_invalid',
                message: expect.stringContaining(
                    `${KV_HANDLE_KEY_MAX_BYTES} bytes`,
                ),
            });
    });
});

describe('a list pattern through a handle', () => {
    it('is held to the relative key limit, so its length says nothing about the prefix', async () => {
        const { handle } = await share(region('pattern'), 'read');
        const longest = 'k'.repeat(KV_HANDLE_KEY_MAX_BYTES);
        await expect(
            as(guest.actor, (d) =>
                d.list({ pattern: longest, ...via(handle) }),
            ),
        ).resolves.toEqual([]);
        await expect(
            as(guest.actor, (d) =>
                d.list({ pattern: `${longest}k`, ...via(handle) }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'kv_handle_key_invalid',
            message: expect.stringContaining(
                `${KV_HANDLE_KEY_MAX_BYTES} bytes`,
            ),
        });
    });
});

describe('a handle that is not the caller`s', () => {
    it('answers every case with one identical body', async () => {
        const read = (handle: string, token = guest.creds.token) =>
            drive(token, 'get', { key: 'k', ...via(handle) });

        const retired = await share(region('retired'), 'read');
        await shares().removeKvShare(owner.actor, retired.handle);

        // The stranger holds their own grant on the same region.
        const overlapping = region('overlap');
        const guests = await share(overlapping, 'read');
        await share(overlapping, 'read', { holder: stranger });

        const app = await makeApp();
        const inDeletedApp = await share(region('app'), 'read', {
            appUid: app.uid,
        });
        await env.server.stores.app.delete(app.id);

        const suspendee = await userFor(
            await createTestUser(env.server, {
                username: `kv-susp-${uuidv4().slice(0, 8)}`,
                password: 'pw-test-1234',
            }),
        );
        const suspended = await share(region('susp'), 'read', {
            actor: suspendee.actor,
        });
        await env.server.clients.db.write(
            'UPDATE `user` SET `suspended` = 1 WHERE `id` = ?',
            [suspendee.id],
        );

        const answers = [
            await read(`kvh-${uuidv4()}`),
            await read('not-a-handle'),
            await read(retired.handle),
            await read(guests.handle, stranger.creds.token),
            await read(inDeletedApp.handle),
            await read(suspended.handle),
        ];
        for (const answer of answers) {
            expect(answer.status).toBe(404);
            expect(answer.text).toBe(answers[0].text);
        }
        expect(answers[0].body).toMatchObject({ code: 'kv_handle_not_found' });
    });

    it('refuses a handle whose row went stale in the cache once the grant is gone', async () => {
        const prefix = region('stale');
        await ownerSet(`${prefix}k`, 1);
        const { handle } = await share(prefix, 'read');
        expect(await guestGet(handle, 'k')).toBe(1);

        const stale = await handles().getLive(handle);
        await shares().removeKvShare(owner.actor, handle);
        // Another node's cache, still holding the row from before.
        const getLive = vi.spyOn(handles(), 'getLive').mockResolvedValue(stale);
        try {
            await expect(guestGet(handle, 'k')).rejects.toMatchObject({
                legacyCode: 'kv_handle_not_found',
            });
        } finally {
            getLive.mockRestore();
        }
    });

    it('refuses a stale write handle even where a wider read grant still stands', async () => {
        const room = region('room');
        const mine = `${room}u:me:`;
        await share(room, 'read');
        const narrow = await share(mine, 'write');
        const stale = await handles().getLive(narrow.handle);
        await shares().removeKvShare(owner.actor, narrow.handle);

        const getLive = vi.spyOn(handles(), 'getLive').mockResolvedValue(stale);
        try {
            await expect(
                guestSet(narrow.handle, 'msg', 1),
            ).rejects.toMatchObject({ legacyCode: 'kv_handle_access_denied' });
        } finally {
            getLive.mockRestore();
        }
        expect(await ownerGet(`${mine}msg`)).toBeNull();
    });
});

describe('confinement to the region', () => {
    it('lists nothing outside the region, whatever the pattern', async () => {
        const prefix = region('conf');
        await ownerSet(`${prefix}in`, 1);
        await ownerSet(`${prefix.slice(0, -1)}-sibling`, 2);
        await ownerSet(`other:${prefix}in`, 3);
        const { handle } = await share(prefix, 'read');

        for (const pattern of [undefined, '', '*', ' ', '  *', ':*'])
            expect(
                await as(guest.actor, (d) =>
                    d.list({
                        as: 'keys',
                        limit: 50,
                        includeTotal: true,
                        ...(pattern !== undefined ? { pattern } : {}),
                        ...via(handle),
                    }),
                ),
            ).toEqual(
                pattern === ':*'
                    ? { items: [], total: 0 }
                    : { items: ['in'], total: 1 },
            );
    });

    it('keeps a prefix that starts with whitespace from widening', async () => {
        const tail = region('ws');
        const prefix = ` ${tail}`;
        await ownerSet(`${prefix}in`, 1);
        await ownerSet(`${tail}out`, 2);
        const { handle } = await legacyShare(prefix, 'read');

        expect(
            await as(guest.actor, (d) =>
                d.list({
                    as: 'keys',
                    limit: 10,
                    includeTotal: true,
                    ...via(handle),
                }),
            ),
        ).toEqual({ items: ['in'], total: 1 });
    });

    it('hands out cursors relative to the handle, and refuses forged ones', async () => {
        const prefix = region('cur');
        for (const key of ['a', 'b', 'c'])
            await ownerSet(`${prefix}${key}`, key);
        const { handle } = await share(prefix, 'read');
        const list = (extra: Record<string, unknown>) =>
            as(guest.actor, (d) =>
                d.list({ as: 'keys', limit: 1, ...extra, ...via(handle) }),
            ) as Promise<{ items: string[]; cursor?: string }>;

        const first = await list({});
        expect(decode(first.cursor)).toEqual({ k: 'a' });

        const ownCursor = (
            (await as(owner.actor, (d) =>
                d.list({ as: 'keys', limit: 1, pattern: `${prefix}*` }),
            )) as { cursor: string }
        ).cursor;
        const forged = [
            // The owner's own cursor, naming their namespace and a whole key.
            ownCursor,
            // Another user's namespace.
            encode({
                namespace: `v1:${stranger.uuid}:${GLOBAL}`,
                key: `${prefix}a`,
            }),
            // A key outside the region, in the owner's namespace.
            { namespace: `v1:${owner.uuid}:${GLOBAL}`, key: 'elsewhere' },
            encode({ reverse: true, key: { namespace: 'x', key: 'y' } }),
            encode({ k: 'a', namespace: `v1:${stranger.uuid}:${GLOBAL}` }),
            encode({ k: 7 }),
            encode({ k: 'a', r: 'yes' }),
            encode(['a']),
        ];
        for (const cursor of forged)
            await expect(list({ cursor })).rejects.toMatchObject({
                statusCode: 400,
                message: 'invalid kv: cursor',
            });
    });

    it('never names a private key in a cursor, even one the page stopped on', async () => {
        const prefix = region('hid');
        await ownerSet(`${prefix}a-secret-name`, 'hidden', {
            disableSharing: true,
        });
        await ownerSet(`${prefix}b-open`, 'open');
        const { handle } = await share(prefix, 'read');

        const keys: string[] = [];
        let cursor: string | undefined;
        for (let pages = 0; pages < 5; pages++) {
            const page = (await as(guest.actor, (d) =>
                d.list({
                    as: 'keys',
                    limit: 1,
                    ...(cursor ? { cursor } : {}),
                    ...via(handle),
                }),
            )) as { items: string[]; cursor?: string };
            keys.push(...page.items);
            const shown = JSON.stringify(page);
            expect(shown).not.toContain('secret');
            expect(
                Buffer.from(String(page.cursor ?? ''), 'base64').toString(
                    'utf8',
                ),
            ).not.toContain('secret');
            cursor = page.cursor;
            if (!cursor) break;
        }
        expect(keys).toEqual(['b-open']);
    });
});

describe('listing through a handle', () => {
    const KEYS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
    let handle: string;

    beforeAll(async () => {
        await env.server.clients.redis.del(
            `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${owner.id}`,
        );
        const prefix = region('matrix');
        for (const [i, key] of KEYS.entries())
            await ownerSet(`${prefix}${key}`, i + 1);
        // Inside the order, and hidden: the private one takes a scan slot.
        await ownerSet(`${prefix}k35`, 'private', { disableSharing: true });
        await ownerSet(`${prefix.slice(0, -1)}`, 'the prefix itself');
        await ownerSet(`zz${prefix}k1`, 'outside');
        ({ handle } = await share(prefix, 'read'));
    });

    const list = (options: Record<string, unknown>) =>
        as(guest.actor, (d) => d.list({ ...options, ...via(handle) }));

    const shaped = (as: string, keys: string[]) =>
        keys.map((key) => {
            const value = KEYS.indexOf(key) + 1;
            if (as === 'keys') return key;
            if (as === 'values') return value;
            return { key, value };
        });

    const matrix = (['keys', 'values', 'entries'] as const).flatMap((as) =>
        [false, true].flatMap((reverse) =>
            [false, true].map((includeTotal) => ({
                as,
                reverse,
                includeTotal,
            })),
        ),
    );

    it.each(matrix)(
        'pages as $as, reverse $reverse, includeTotal $includeTotal',
        async ({ as, reverse, includeTotal }) => {
            const items: unknown[] = [];
            let cursor: string | undefined;
            let pages = 0;
            do {
                const page = (await list({
                    as,
                    limit: 3,
                    ...(reverse ? { reverse } : {}),
                    ...(includeTotal ? { includeTotal } : {}),
                    ...(cursor ? { cursor } : {}),
                })) as { items: unknown[]; cursor?: string; total?: number };
                items.push(...page.items);
                if (includeTotal) expect(page.total).toBe(KEYS.length);
                else expect(page).not.toHaveProperty('total');
                if (page.cursor) {
                    const next = decode(page.cursor);
                    expect(Object.keys(next).sort()).toEqual(
                        reverse ? ['k', 'r'] : ['k'],
                    );
                    if (reverse) expect(next.r).toBe(true);
                }
                cursor = page.cursor;
                pages++;
            } while (cursor && pages < 10);

            const order = reverse ? [...KEYS].reverse() : KEYS;
            expect(items).toEqual(shaped(as, order));
        },
    );

    it.each(['keys', 'values', 'entries'] as const)(
        'lists everything as %s without a limit',
        async (as) => {
            expect(await list({ as })).toEqual(shaped(as, KEYS));
        },
    );

    it('continues a reverse listing from its cursor alone, and refuses a direction that conflicts', async () => {
        const first = (await list({
            as: 'keys',
            limit: 2,
            reverse: true,
        })) as { items: string[]; cursor: string };
        expect(first.items).toEqual(['k7', 'k6']);
        expect(decode(first.cursor)).toEqual({ k: 'k6', r: true });

        const next = (await list({
            as: 'keys',
            limit: 2,
            cursor: first.cursor,
        })) as { items: string[] };
        expect(next.items).toEqual(['k5', 'k4']);
        await expect(
            list({
                as: 'keys',
                limit: 2,
                cursor: first.cursor,
                reverse: false,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('narrows by a pattern under the handle', async () => {
        expect(await list({ as: 'keys', pattern: 'k3*' })).toEqual(['k3']);
        expect(await list({ as: 'keys', pattern: 'k*' })).toEqual(KEYS);
    });

    it('fills a page past a hidden entry with fetchUntilFull', async () => {
        const plain = (await list({ as: 'keys', limit: 4 })) as {
            items: string[];
        };
        expect(plain.items).toEqual(['k1', 'k2', 'k3']);
        const filled = (await list({
            as: 'keys',
            limit: 4,
            fetchUntilFull: true,
        })) as { items: string[] };
        expect(filled.items).toEqual(['k1', 'k2', 'k3', 'k4']);
    });

    it('skips by offset', async () => {
        const page = (await list({
            as: 'keys',
            offset: 2,
            limit: 3,
            fetchUntilFull: true,
            includeTotal: true,
        })) as { items: string[]; total: number };
        expect(page.items).toEqual(['k3', 'k4', 'k5']);
        expect(page.total).toBe(KEYS.length);
    });
});

describe('a private entry in the region', () => {
    it('is absent to the holder, uncounted, and refuses every write', async () => {
        const prefix = region('priv');
        await ownerSet(`${prefix}open`, 1);
        await ownerSet(`${prefix}secret`, 's', { disableSharing: true });
        const { handle } = await share(prefix, 'write');

        expect(await guestGet(handle, 'secret')).toBeNull();
        expect(await guestGet(handle, ['open', 'secret'])).toEqual([1, null]);
        expect(
            await as(guest.actor, (d) =>
                d.list({
                    as: 'keys',
                    limit: 10,
                    includeTotal: true,
                    ...via(handle),
                }),
            ),
        ).toEqual({ items: ['open'], total: 1 });

        for (const call of [
            (d: KVStoreDriver) =>
                d.set({ key: 'secret', value: 'x', ...via(handle) }),
            (d: KVStoreDriver) => d.del({ key: 'secret', ...via(handle) }),
            (d: KVStoreDriver) =>
                d.update({
                    key: 'secret',
                    pathAndValueMap: { a: 1 },
                    ...via(handle),
                }),
            (d: KVStoreDriver) =>
                d.expire({ key: 'secret', ttl: 60, ...via(handle) }),
            (d: KVStoreDriver) =>
                d.batchPut({
                    items: [
                        { key: 'open', value: 2 },
                        { key: 'secret', value: 'x' },
                    ],
                    ...via(handle),
                }),
        ])
            await expect(as(guest.actor, call)).rejects.toMatchObject({
                statusCode: 403,
            });
        expect(
            await as(guest.actor, (d) =>
                d.set({
                    key: 'secret',
                    value: 'x',
                    ...via(handle, { onlyIfAbsent: true }),
                }),
            ),
        ).toBe(false);
        expect(await ownerGet(`${prefix}secret`)).toBe('s');
    });
});

describe('an app using a handle', () => {
    let app: { uid: string; id: number };
    let otherApp: { uid: string; id: number };

    beforeAll(async () => {
        app = await makeApp();
        otherApp = await makeApp();
    });

    it('works in the app whose data it is, and in the holder`s own session', async () => {
        const prefix = region('app');
        const { handle } = await share(prefix, 'write', { appUid: app.uid });
        await as(appActorFor(guest, app), (d) =>
            d.set({ key: 'k', value: 'from the app', ...via(handle) }),
        );
        expect(await guestGet(handle, 'k')).toBe('from the app');
        expect(
            await as(appActorFor(owner, app), (d) =>
                d.get({ key: `${prefix}k` }),
            ),
        ).toBe('from the app');
    });

    it('is absent to another app of the same holder', async () => {
        const { handle } = await share(region('app'), 'read', {
            appUid: app.uid,
        });
        await expect(
            guestGet(handle, 'k', appActorFor(guest, otherApp)),
        ).rejects.toMatchObject({ legacyCode: 'kv_handle_not_found' });
    });

    it('is absent to every app when the handle is on the app-less namespace', async () => {
        const { handle } = await share(region('global'), 'read');
        await expect(
            guestGet(handle, 'k', appActorFor(guest, app)),
        ).rejects.toMatchObject({ legacyCode: 'kv_handle_not_found' });
    });
});

describe('a token using a handle', () => {
    let prefix: string;
    let handle: string;
    let elsewhere: string;

    beforeAll(async () => {
        await env.server.clients.redis.del(
            `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${owner.id}`,
        );
        prefix = region('tok');
        elsewhere = region('tok-other');
        await ownerSet(`${prefix}k`, 'v');
        ({ handle } = await share(prefix, 'read'));
        await share(elsewhere, 'read');
    });

    /** A token carrying one permission, as the request edge resolves it. */
    const tokenActor = async (issuer: Actor, permission: string) => {
        const token = await env.server.services.auth.createAccessToken(issuer, [
            [permission],
        ]);
        return {
            token,
            actor: (await env.server.services.auth.authenticate(token)).actor!,
        };
    };

    it('gets nothing on a scoped token whose scope holds another region only', async () => {
        const { actor } = await tokenActor(
            guest.actor,
            kvSharePermission(owner.uuid, GLOBAL, elsewhere, 'read'),
        );
        await expect(guestGet(handle, 'k', actor)).rejects.toMatchObject({
            legacyCode: 'kv_handle_not_found',
        });
    });

    it('reads on a scoped token whose scope holds the grant', async () => {
        const { actor } = await tokenActor(
            guest.actor,
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'read'),
        );
        expect(await guestGet(handle, 'k', actor)).toBe('v');
    });

    it('reads over /drivers/call on a full-access token, where a scoped one is turned away first', async () => {
        const full = await drive(guest.creds.apiToken, 'get', {
            key: 'k',
            ...via(handle),
        });
        expect(full.status, full.text).toBe(200);
        expect(full.body.result).toBe('v');

        const { token } = await tokenActor(
            guest.actor,
            kvSharePermission(owner.uuid, GLOBAL, prefix, 'read'),
        );
        const scoped = await drive(token, 'get', { key: 'k', ...via(handle) });
        expect(scoped.status).toBe(403);
    });

    it('follows the grant on a token an app issued', async () => {
        const app = await makeApp();
        const appPrefix = region('apptok');
        const appElsewhere = region('apptok-other');
        await as(appActorFor(owner, app), (d) =>
            d.set({ key: `${appPrefix}k`, value: 'app value' }),
        );
        const inApp = await share(appPrefix, 'read', { appUid: app.uid });
        await share(appElsewhere, 'read', { appUid: app.uid });
        const appActor = appActorFor(guest, app);

        const carrying = await tokenActor(
            appActor,
            kvSharePermission(owner.uuid, app.uid, appPrefix, 'read'),
        );
        expect(carrying.actor.effectiveApp?.uid).toBe(app.uid);
        expect(await guestGet(inApp.handle, 'k', carrying.actor)).toBe(
            'app value',
        );

        const other = await tokenActor(
            appActor,
            kvSharePermission(owner.uuid, app.uid, appElsewhere, 'read'),
        );
        await expect(
            guestGet(inApp.handle, 'k', other.actor),
        ).rejects.toMatchObject({ legacyCode: 'kv_handle_not_found' });
    });
});

describe('onlyIfAbsent', () => {
    it('writes once, then answers false and leaves the value alone', async () => {
        const key = `once-${uuidv4()}`;
        const write = (value: unknown) =>
            as(guest.actor, (d) =>
                d.set({ key, value, optConfig: { onlyIfAbsent: true } }),
            );
        expect(await write('first')).toBe(true);
        expect(await write('second')).toBe(false);
        expect(await as(guest.actor, (d) => d.get({ key }))).toBe('first');
    });

    it('writes over an expired row that has not been swept', async () => {
        const key = `lapsed-${uuidv4()}`;
        await as(guest.actor, (d) =>
            d.set({ key, value: 'old', expireAt: earlier() }),
        );
        expect(
            await as(guest.actor, (d) =>
                d.set({ key, value: 'new', optConfig: { onlyIfAbsent: true } }),
            ),
        ).toBe(true);
        expect(await as(guest.actor, (d) => d.get({ key }))).toBe('new');
    });

    it('is refused on a batch write, and when it is not a boolean', async () => {
        await expect(
            as(guest.actor, (d) =>
                d.batchPut({
                    items: [{ key: 'a', value: 1 }],
                    optConfig: { onlyIfAbsent: true },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'invalid_request',
        });
        await expect(
            as(guest.actor, (d) =>
                d.set({
                    key: 'a',
                    value: 1,
                    optConfig: { onlyIfAbsent: 'yes' as never },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('needs write through a handle', async () => {
        const prefix = region('oia');
        const read = await share(prefix, 'read');
        const write = await share(`${prefix}w:`, 'write');
        const claim = (handle: string) =>
            as(guest.actor, (d) =>
                d.set({
                    key: 'room',
                    value: 'mine',
                    ...via(handle, { onlyIfAbsent: true }),
                }),
            );

        await expect(claim(read.handle)).rejects.toMatchObject({
            legacyCode: 'kv_handle_access_denied',
        });
        expect(await claim(write.handle)).toBe(true);
        expect(await claim(write.handle)).toBe(false);
    });
});

describe('what a write publishes', () => {
    const SOCKET = 'kv-driver-handles-socket';

    const deliveryFor = (subId: string, predicate = () => true) =>
        vi.waitFor(
            () => {
                const found = delivered.find(
                    (one) => one.subId === subId && predicate(),
                );
                expect(found).toBeDefined();
                return found!.event as Record<string, unknown>;
            },
            { timeout: EVENTS_COALESCE_WINDOW_MS * 12, interval: 25 },
        );

    const workerActor = async () =>
        (await env.server.services.auth.authenticate(owner.creds.workerToken))
            .actor!;

    it('tells the owner a holder`s write was not theirs, and the holder that it was', async () => {
        const prefix = region('self');
        const { handle } = await share(prefix, 'write');
        const ownerSub = (
            await events().subscribe(owner.actor, SOCKET, {
                subject: `kv:${GLOBAL}:${prefix}*`,
            })
        ).sub;
        const guestSub = (
            await events().subscribe(guest.actor, SOCKET, {
                subject: `kv:${handle}:*`,
            })
        ).sub;
        delivered.length = 0;

        await guestSet(handle, 'msg', 'hello');

        expect(await deliveryFor(ownerSub.subId)).toMatchObject({
            key: `${prefix}msg`,
            self: false,
            viaWorker: false,
        });
        expect(await deliveryFor(guestSub.subId)).toMatchObject({
            subject: `kv:${handle}:msg`,
            key: 'msg',
            self: true,
            viaWorker: false,
        });
    });

    it('marks the owner`s own writes as theirs, and a worker`s or handler`s as via a worker', async () => {
        const prefix = region('via');
        const sub = (
            await events().subscribe(owner.actor, SOCKET, {
                subject: `kv:${GLOBAL}:${prefix}*`,
            })
        ).sub;
        const worker = await workerActor();
        expect(worker.session?.kind).toBe('worker');
        const handler = makeActor({
            user: owner.actor.user as never,
            handlerDepth: 1,
        });

        for (const [writer, viaWorker] of [
            [owner.actor, false],
            [worker, true],
            [handler, true],
        ] as const) {
            delivered.length = 0;
            const key = `${prefix}${uuidv4().slice(0, 8)}`;
            await as(writer, (d) => d.set({ key, value: 1 }));
            const event = await deliveryFor(sub.subId);
            expect(event).toMatchObject({ key, self: true, viaWorker });
        }
    });

    it('marks fs writes by a worker or an events handler the same way', async () => {
        const folder = `/${owner.username}/via-${uuidv4().slice(0, 8)}`;
        const fs = env.server.services.fs;
        await fs.mkdir(owner.id, { path: folder, createMissingParents: true });
        const sub = (
            await events().subscribe(owner.actor, SOCKET, {
                subject: `fs:${folder}`,
            })
        ).sub;
        const worker = await workerActor();
        const handler = makeActor({
            user: owner.actor.user as never,
            handlerDepth: 1,
        });

        for (const [writer, viaWorker] of [
            [owner.actor, false],
            [worker, true],
            [handler, true],
        ] as const) {
            delivered.length = 0;
            const path = `${folder}/${uuidv4().slice(0, 8)}.txt`;
            await runWithContext({ actor: writer }, () =>
                fs.touch(owner.id, { path }),
            );
            const event = await deliveryFor(sub.subId);
            expect(event).toMatchObject({ path, self: true, viaWorker });
        }
    });
});

describe('what a call costs', () => {
    const dbCalls = () => {
        const db = env.server.clients.db;
        return (['read', 'pread', 'write', 'batchWrite'] as const).map(
            (method) => vi.spyOn(db, method),
        );
    };

    it.each([
        ['the app-less namespace', false],
        ['an app namespace', true],
    ])(
        'reads warm through a handle in %s with no SQL and one permission check',
        async (_name, inApp) => {
            const app = inApp ? await makeApp() : null;
            const prefix = region('warm');
            if (app)
                await as(appActorFor(owner, app), (d) =>
                    d.set({ key: `${prefix}k`, value: 1 }),
                );
            else await ownerSet(`${prefix}k`, 1);
            const { handle } = await share(prefix, 'read', {
                ...(app ? { appUid: app.uid } : {}),
            });
            await guestGet(handle, 'k');
            await guestGet(handle, ['k', 'j']);

            const sql = dbCalls();
            const check = vi.spyOn(env.server.services.permission, 'check');
            try {
                expect(await guestGet(handle, 'k')).toBe(1);
                expect(check).toHaveBeenCalledTimes(1);
                expect(await guestGet(handle, ['k', 'j'])).toEqual([1, null]);
                expect(check).toHaveBeenCalledTimes(2);
                for (const spy of sql) expect(spy).not.toHaveBeenCalled();
            } finally {
                for (const spy of sql) spy.mockRestore();
                check.mockRestore();
            }
        },
    );

    it('bills the holder for their reads and writes, and never the owner', async () => {
        const prefix = region('bill');
        const { handle } = await share(prefix, 'write');
        const metering = env.server.services.metering;
        const charged = vi.spyOn(metering, 'incrementUsage');
        try {
            await guestSet(handle, 'k', 1);
            await guestGet(handle, 'k');
            await vi.waitFor(() =>
                expect(charged.mock.calls.length).toBeGreaterThanOrEqual(2),
            );
            const billed = charged.mock.calls.map(
                ([actor]) => (actor as Actor).user.id,
            );
            expect(billed).toContain(guest.id);
            expect(billed).not.toContain(owner.id);
        } finally {
            charged.mockRestore();
        }
    });
});

describe('what a holder is ever shown', () => {
    it('names no owner, prefix or whole key in any answer, success or error', async () => {
        const prefix = region('scan');
        // Apart from the write region, which would otherwise answer for it.
        const readPrefix = region('scanro');
        const write = await share(prefix, 'write');
        const read = await share(readPrefix, 'read');
        await ownerSet(`${prefix}secret`, 's', { disableSharing: true });
        const token = guest.creds.token;
        const bodies: string[] = [];
        const call = async (
            method: string,
            args: Record<string, unknown>,
            handle = write.handle,
        ) => {
            const res = await drive(token, method, {
                ...args,
                optConfig: {
                    handle,
                    ...((args.optConfig as object | undefined) ?? {}),
                },
            });
            bodies.push(res.text);
            return res;
        };

        // Every method, succeeding.
        await call('set', { key: 'msg:1', value: { text: 'hi' } });
        await call('set', { key: 'msg:2', value: { text: 'there' } });
        await call('set', { key: 'n', value: 1 });
        await call('set', { key: 'list', value: [] });
        await call('get', { key: 'msg:1' });
        await call('get', { key: ['msg:1', 'msg:2', 'none', 'secret'] });
        for (const as of ['keys', 'values', 'entries'])
            await call('list', { as });
        const firstPage = await call('list', {
            as: 'entries',
            limit: 1,
            includeTotal: true,
        });
        await call('list', {
            as: 'entries',
            limit: 1,
            cursor: firstPage.body.result
                ? (firstPage.body.result as { cursor: string }).cursor
                : undefined,
        });
        const reversed = await call('list', {
            as: 'keys',
            limit: 1,
            reverse: true,
        });
        await call('list', {
            as: 'keys',
            limit: 1,
            cursor: (reversed.body.result as { cursor: string }).cursor,
        });
        await call('list', {
            as: 'keys',
            pattern: 'msg:*',
            offset: 1,
            limit: 5,
        });
        await call('update', { key: 'msg:1', pathAndValueMap: { seen: true } });
        await call('incr', { key: 'n', pathAndAmountMap: { '': 2 } });
        await call('decr', { key: 'n', pathAndAmountMap: { '': 1 } });
        await call('add', { key: 'list', pathAndValueMap: { '': 'x' } });
        await call('remove', { key: 'msg:1', paths: ['seen'] });
        await call('expire', { key: 'msg:2', ttl: 3600 });
        await call('expireAt', { key: 'msg:2', timestamp: later() });
        await call('batchPut', {
            items: [
                { key: 'b:1', value: 1 },
                { key: 'b:2', value: 2 },
            ],
        });
        await call('set', {
            key: 'claim',
            value: 1,
            optConfig: { onlyIfAbsent: true },
        });
        await call('set', {
            key: 'claim',
            value: 2,
            optConfig: { onlyIfAbsent: true },
        });
        await call('del', { key: 'b:1' });

        // Every way it can fail, the store's key-naming messages included.
        const failures = [
            await call('add', { key: 'msg:1', pathAndValueMap: { '': 'x' } }),
            await call('update', { key: 'n', pathAndValueMap: { 'a.b': 1 } }),
            await call('incr', { key: 'msg:1', pathAndAmountMap: { '': 1 } }),
            await call('set', {
                key: 'k'.repeat(KV_HANDLE_KEY_MAX_BYTES + 1),
                value: 1,
            }),
            await call('get', { key: '' }),
            await call('list', {
                cursor: encode({ namespace: 'x', key: 'y' }),
            }),
            await call('flush', {}),
            await call('get', { key: 'n', optConfig: { appUuid: 'app-x' } }),
            await call('set', { key: 'x', value: 1 }, read.handle),
            await call('get', { key: 'n' }, `kvh-${uuidv4()}`),
            await call('set', { key: 'secret', value: 'x' }),
            await call('incr', { key: 'secret', pathAndAmountMap: { '': 1 } }),
        ];
        for (const failure of failures)
            expect(failure.status, failure.text).toBeGreaterThanOrEqual(400);
        expect(failures[0].text).toContain('`msg:1`');
        expect(failures[1].text).toContain('`n`');

        for (const body of bodies) {
            expect(body).not.toContain(owner.uuid);
            expect(body).not.toContain(owner.username);
            for (const region of [prefix, readPrefix])
                expect(body).not.toContain(region.slice(0, -1));
        }
    });
});
