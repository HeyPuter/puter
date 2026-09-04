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
 * Cross-user key-value shares against the real grant machinery.
 *
 * The unit suite drives the resolver with handles as data; this pins what only
 * the wiring can get wrong — that minting issues a grant the permission service
 * actually answers, that prefix implication reaches a deeper key without a rule
 * of its own, and that a write through the key-value driver reaches somebody
 * who is not the person who made it.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_KV_HANDLES_PER_USER,
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { kvSharePermission } from './kvShares.js';
import { isKvHandleId, kvAnchorToken } from './subjects.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'kv-handle-socket';
const TABLE = 'event_subscriptions';
const PREFIX = 'workspace:abc:';

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

const events = () => env.server.services.events;

const settled = (count = 1) =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
        uuid: row!.uuid as string,
    };
};

/** `kv.set` as the owner makes it: through the driver, as themselves. */
const ownerWrites = (key: string, value: unknown): Promise<unknown> =>
    runWithContext({ actor: owner.actor }, () =>
        env.server.drivers.kvStore.set({ key, value }),
    );

const mint = (
    request: Record<string, unknown> = {},
    actor: Actor = owner.actor,
) =>
    events().mintKvHandle(actor, {
        granteeUsername: guest.username,
        prefix: PREFIX,
        ...request,
    });

const clearRows = async () => {
    await env.server.clients.db.write(`DELETE FROM \`${TABLE}\``, []);
    for (const id of [owner.id, guest.id, stranger.id]) {
        await events().reapSocket(id, SOCKET_ID);
        events().invalidateUser(id);
        await env.server.stores.eventSubscription.markRegionCold(id);
        await env.server.stores.durableSubscription.warmRegion(id);
    }
    delivered.length = 0;
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        unlimitedMetering: true,
    } as IConfig);

    const strangerName = `kv-stranger-${uuidv4().slice(0, 8)}`;
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

describe('minting a handle', () => {
    it('returns an opaque name for the region and nothing else', async () => {
        const minted = await mint();

        expect(isKvHandleId(minted.handle)).toBe(true);
        expect(minted).toEqual({ handle: minted.handle, prefix: PREFIX });
        const wire = JSON.stringify(minted);
        expect(wire).not.toContain(owner.uuid);
        expect(wire).not.toContain(owner.username);
    });

    it('issues a grant the permission service answers, prefix and all', async () => {
        await mint();
        const permission = kvSharePermission(owner.uuid, 'os-global', PREFIX);

        await expect(
            env.server.services.permission.check(guest.actor, permission),
        ).resolves.toBe(true);
        // Prefix implication: the grant on the region answers a key beneath it
        // with no rule of its own.
        await expect(
            env.server.services.permission.check(
                guest.actor,
                kvSharePermission(
                    owner.uuid,
                    'os-global',
                    `${PREFIX}messages:1`,
                ),
            ),
        ).resolves.toBe(true);
        await expect(
            env.server.services.permission.check(stranger.actor, permission),
        ).resolves.toBe(false);
    });

    it('never answers a parent check from a grant on its child', async () => {
        // The mirror image of prefix implication: holding only the deeper
        // grant must not satisfy a check on the shallower path it sits under.
        // Disjoint from `PREFIX` (which other tests in this file grant
        // broadly), so no earlier grant already covers the parent by nesting
        // under it.
        const parent = 'probe-parent-check:';
        await mint({ prefix: `${parent}child:` });

        await expect(
            env.server.services.permission.check(
                guest.actor,
                kvSharePermission(owner.uuid, 'os-global', parent),
            ),
        ).resolves.toBe(false);
    });

    it('hands back the existing handle for a region already minted to the same grantee', async () => {
        const prefix = 'idempotent-probe:';
        const first = await mint({ prefix });
        const second = await mint({ prefix });

        expect(second).toEqual(first);

        const rows = await env.server.clients.db.pread(
            'SELECT `handle` FROM `kv_share_handles` ' +
                'WHERE `owner_user_id` = ? AND `key_prefix` = ? AND `revoked_at` IS NULL',
            [owner.id, prefix],
        );
        expect(rows).toHaveLength(1);

        // Still one grant row, not a second one over the same permission —
        // which is the whole reason two handles must never point at it.
        const permRows = await env.server.clients.db.pread(
            'SELECT `holder_user_id` FROM `user_to_user_permissions` WHERE `permission` = ?',
            [kvSharePermission(owner.uuid, 'os-global', prefix)],
        );
        expect(permRows).toHaveLength(1);
    });

    it('refuses to share with yourself', async () => {
        await expect(
            mint({ granteeUsername: owner.username }),
        ).rejects.toMatchObject({ legacyCode: 'bad_request' });
    });

    it('refuses a grantee nobody has', async () => {
        await expect(
            mint({ granteeUsername: 'nobody-by-that-name' }),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });

    it('refuses the whole namespace', async () => {
        await expect(mint({ prefix: '' })).rejects.toMatchObject({
            legacyCode: 'invalid_kv_share_prefix',
        });
    });

    it('refuses a namespace longer than the column that stores it', async () => {
        await expect(mint({ appUid: 'a'.repeat(41) })).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it('refuses a prefix with an empty key segment', async () => {
        // Normalizing would grant `probe:gap:` — a region other than the one
        // asked for.
        await expect(mint({ prefix: 'probe::gap:' })).rejects.toMatchObject({
            legacyCode: 'invalid_kv_share_prefix',
        });
    });

    it('stops at the number of handles one account may hold out', async () => {
        const seeded: string[] = [];
        try {
            const live =
                await env.server.stores.kvShareHandle.countLiveForOwner(
                    owner.id,
                );
            for (let i = live; i < EVENTS_KV_HANDLES_PER_USER; i++) {
                const row = await env.server.stores.kvShareHandle.mint({
                    ownerUserId: owner.id,
                    granteeUserId: guest.id,
                    appUid: 'os-global',
                    keyPrefix: `ceiling:${i}:`,
                    permission: kvSharePermission(
                        owner.uuid,
                        'os-global',
                        `ceiling:${i}:`,
                    ),
                });
                seeded.push(row.handle);
            }

            await expect(
                mint({ prefix: 'over:the:line:' }),
            ).rejects.toMatchObject({
                legacyCode: 'events_kv_handle_limit_reached',
            });

            // Retiring one frees a slot: the ceiling counts live handles, not
            // the audit trail.
            await env.server.clients.db.write(
                'UPDATE `kv_share_handles` SET `revoked_at` = ? WHERE `handle` = ?',
                [Math.floor(Date.now() / 1000), seeded[0]],
            );
            await expect(mint({ prefix: 'over:the:line:' })).resolves.toEqual(
                expect.objectContaining({ prefix: 'over:the:line:' }),
            );
        } finally {
            await env.server.clients.db.write(
                'DELETE FROM `kv_share_handles` WHERE `owner_user_id` = ?',
                [owner.id],
            );
        }
    });

    it('refuses an app its user has not delegated the region to', async () => {
        const uid = `app-${uuidv4()}`;
        await env.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [uid, uid, uid, `https://${uid}.example/`, owner.id],
        );
        const app = await env.server.stores.app.getByUid(uid);
        const appActor = makeActor({
            user: owner.actor.user as never,
            app: { uid, id: app!.id },
        });

        await expect(mint({}, appActor)).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_not_delegated',
        });
    });
});

describe('subscribing through a handle', () => {
    it('anchors where the owner`s own subject would', async () => {
        await clearRows();
        const { handle } = await mint();

        const guestSub = (
            await events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            })
        ).sub;
        const ownerSub = (
            await events().subscribe(owner.actor, SOCKET_ID, {
                subject: `kv:os-global:${PREFIX}*`,
            })
        ).sub;

        const [guestRow] =
            await env.server.stores.eventSubscription.listForSocket(
                guest.id,
                SOCKET_ID,
            );
        const [ownerRow] =
            await env.server.stores.eventSubscription.listForSocket(
                owner.id,
                SOCKET_ID,
            );

        expect(guestRow.subId).toBe(guestSub.subId);
        expect(ownerRow.subId).toBe(ownerSub.subId);
        expect(guestRow.token).toBe(ownerRow.token);
        expect(guestRow.token).toBe(
            kvAnchorToken(owner.uuid, 'os-global', PREFIX),
        );
        // Indexed under the owner: a write only knows whose namespace it hit.
        expect(guestRow.ownerUserId).toBe(owner.id);
    });

    it('names the handle as its own anchor on the wire, never the owner`s namespace or prefix', async () => {
        await clearRows();
        const { handle } = await mint();

        const guestSub = (
            await events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            })
        ).sub;

        // The subscribe ack: what the caller sees the instant they subscribe.
        expect(guestSub.anchor).toEqual({ uid: handle, path: '' });
        expect(JSON.stringify(guestSub)).not.toContain(owner.uuid);
        expect(JSON.stringify(guestSub)).not.toContain('os-global');
        expect(JSON.stringify(guestSub)).not.toContain(PREFIX);

        // The listing: the same row read back later reports the same anchor.
        const [listed] = await events().listSubscriptions(
            guest.actor,
            SOCKET_ID,
        );
        expect(listed.anchor).toEqual({ uid: handle, path: '' });
        expect(JSON.stringify(listed)).not.toContain(owner.uuid);
        expect(JSON.stringify(listed)).not.toContain('os-global');
        expect(JSON.stringify(listed)).not.toContain(PREFIX);
    });

    it('refuses a user the handle was not granted to', async () => {
        await clearRows();
        const { handle } = await mint();
        await expect(
            events().subscribe(stranger.actor, SOCKET_ID, {
                subject: `kv:${handle}:*`,
            }),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });

    it('refuses a handle nobody minted', async () => {
        await expect(
            events().subscribe(guest.actor, SOCKET_ID, {
                subject: `kv:kvh-${uuidv4()}:*`,
            }),
        ).rejects.toMatchObject({ legacyCode: 'subject_does_not_exist' });
    });
});

describe('a write in the shared region', () => {
    it('reaches the grantee`s session subscription', async () => {
        await clearRows();
        const { handle } = await mint();
        const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${handle}:*`,
        });
        delivered.length = 0;

        await ownerWrites(`${PREFIX}messages:1`, { body: 'hello' });
        await settled();

        expect(delivered).toHaveLength(1);
        expect(delivered[0].subId).toBe(sub.subId);
        // Named the way the grantee addresses it: the handle is the granted
        // root, so the key is relative to it and the subject names the handle.
        expect(delivered[0].event).toMatchObject({
            subject: `kv:${handle}:messages:1`,
            key: 'messages:1',
            op: 'set',
            self: false,
        });
        expect(JSON.stringify(delivered[0])).not.toContain(PREFIX);
        expect(JSON.stringify(delivered[0])).not.toContain(owner.uuid);
    });

    it('reaches a durable subscription, key after key', async () => {
        await clearRows();
        const { handle } = await mint();
        const { sub } = await events().subscribeDurable(guest.actor, {
            subject: `kv:${handle}:*`,
        });
        delivered.length = 0;

        await ownerWrites(`${PREFIX}messages:2`, { body: 'one' });
        await ownerWrites(`${PREFIX}title`, 'two');
        await settled(2);

        expect(delivered.map((one) => one.subId)).toEqual([
            sub.subId,
            sub.subId,
        ]);
    });

    it('stays inside the region the handle was granted on', async () => {
        await clearRows();
        const { handle } = await mint();
        await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${handle}:*`,
        });
        delivered.length = 0;

        await ownerWrites('workspace:other:messages:1', { body: 'nope' });
        await quiet();

        expect(delivered).toEqual([]);
    });

    it('drops delivery rather than leak the owner`s namespace and absolute key when a row`s stored grant does not cover the key its token matched', async () => {
        // A row this mis-scoped should never occur through the public surface —
        // this pins the defensive behavior for the day storage disagrees with
        // itself, rather than trusting a row that says it addresses one region
        // while checking a permission that covers a different one.
        await clearRows();
        const { handle } = await mint();
        await mint({ prefix: 'workspace:xyz:' });

        const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${handle}:*`,
        });
        const [row] = await env.server.stores.eventSubscription.listForSocket(
            guest.id,
            SOCKET_ID,
        );
        const redisKey = `ev:t:{${owner.id}}:${row.token}`;
        const raw = await env.server.clients.redis.hget(redisKey, sub.subId);
        const tampered = {
            ...JSON.parse(raw as string),
            // A grant the guest genuinely holds, but over a region the token
            // this row is indexed under (`workspace:abc:`) does not name.
            permission: kvSharePermission(owner.uuid, 'os-global', 'workspace:xyz:'),
        };
        await env.server.clients.redis.hset(
            redisKey,
            sub.subId,
            JSON.stringify(tampered),
        );
        events().invalidateUser(owner.id);
        delivered.length = 0;

        await ownerWrites(`${PREFIX}messages:1`, { body: 'leak?' });
        await quiet();

        expect(delivered).toEqual([]);
    });
});
