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
 * An app minting a share handle on its user's data.
 *
 * The bounds are the ones sharing already puts on an app handing out its
 * user's files: the authority is the user's, the consent is a `manage:` grant
 * the user gave this app on this region, and the reach is whatever the
 * credential structurally holds — for key-value that is one namespace. What
 * these cases pin is that each of those is actually load-bearing, and that a
 * handle minted this way is in every other respect an ordinary one.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { kvShareManagePermission, kvSharePermission } from './kvShares.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'kv-delegate-socket';
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
let appUid: string;
let appActor: Actor;

const events = () => env.server.services.events;
const permissions = () => env.server.services.permission;

const settled = (count = 1) =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

let delivered: DeliveryEnvelope[];

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id,
        uuid: row!.uuid as string,
    };
};

/** `kv.set` as the app makes it: its own namespace, under its user. */
const appWrites = (key: string, value: unknown): Promise<unknown> =>
    runWithContext({ actor: appActor }, () =>
        env.server.drivers.kvStore.set({ key, value }),
    );

/** The consent: the user lets this app hand out one region of its data. */
const delegate = (prefix = PREFIX) =>
    permissions().grantUserAppPermission(
        owner.actor,
        appUid,
        kvShareManagePermission(
            kvSharePermission(owner.uuid, appUid, prefix),
        ),
    );

const undelegate = (prefix = PREFIX) =>
    permissions().revokeUserAppPermission(
        owner.actor,
        appUid,
        kvShareManagePermission(
            kvSharePermission(owner.uuid, appUid, prefix),
        ),
    );

const mint = (request: Record<string, unknown> = {}, actor = appActor) =>
    events().mintKvHandle(actor, {
        granteeUsername: guest.username,
        prefix: PREFIX,
        ...request,
    });

const clearRows = async () => {
    await env.server.clients.db.write(`DELETE FROM \`${TABLE}\``, []);
    for (const id of [owner.id, guest.id]) {
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

    owner = await userFor(env.users.user.username);
    guest = await userFor(env.users.other.username);

    const name = `kv-delegate-${uuidv4().slice(0, 8)}`;
    const app = await env.server.stores.app.create(
        {
            name,
            title: 'Delegating App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId: owner.id },
    );
    appUid = app.uid;
    appActor = makeActor({
        user: owner.actor.user as never,
        app: { uid: app.uid, id: app.id },
    });

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('an app minting without consent', () => {
    it('is refused, however much its user could do here themselves', async () => {
        await undelegate();
        await expect(mint()).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_not_delegated',
        });
        // The same call as the user is allowed: what is missing is the
        // delegation, not the authority behind it. On its own region, since a
        // session mints in the account's namespace rather than the app's.
        await expect(
            mint({ prefix: 'session-probe:' }, owner.actor),
        ).resolves.toMatchObject({ prefix: 'session-probe:' });
    });

    it('is refused for a region already shared, rather than handed the standing handle', async () => {
        const prefix = `withdrawn-consent-${uuidv4().slice(0, 8)}:`;
        await delegate(prefix);
        const { handle } = await mint({ prefix });
        await undelegate(prefix);

        // Minting the same region twice answers with the handle that already
        // covers it, so the consent check has to come first — otherwise
        // withdrawing it would still leave the app able to read the handle
        // back.
        await expect(mint({ prefix })).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_not_delegated',
        });
        // The share itself is untouched: what was refused is the app asking.
        const page = await events().listKvHandles(owner.actor, { limit: 100 });
        expect(page.items).toContainEqual(
            expect.objectContaining({ handle, revokedAt: null }),
        );
    });

    it('is refused for a region the consent does not cover', async () => {
        await delegate('workspace:abc:');
        // A sibling region, and the parent the consent sits under: coverage
        // only ever runs downward.
        await expect(mint({ prefix: 'workspace:other:' })).rejects.toMatchObject(
            { legacyCode: 'events_kv_handle_not_delegated' },
        );
        await expect(mint({ prefix: 'workspace:' })).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_not_delegated',
        });
    });

    it('is refused when only a namespace-root grant exists, written some other way than the consent surface', async () => {
        // The consent surface (grant-user-app) refuses to write this row; write
        // it directly to prove the mint path does not trust one that reaches it
        // by a different route.
        await undelegate('workspace:abc:');
        await permissions().grantUserAppPermission(
            owner.actor,
            appUid,
            kvShareManagePermission(kvSharePermission(owner.uuid, appUid, '')),
        );
        try {
            await expect(
                mint({ prefix: 'totally-unrelated-region:' }),
            ).rejects.toMatchObject({
                legacyCode: 'events_kv_handle_not_delegated',
            });
        } finally {
            await undelegate('');
        }
    });
});

describe('an access token', () => {
    beforeAll(async () => {
        await delegate();
    });

    it('may not mint even when issued by an app the user has delegated to', async () => {
        const tokenActor = makeActor({
            user: owner.actor.user as never,
            accessToken: {
                uid: `tok-${uuidv4()}`,
                issuer: appActor,
                authorized: null,
                fullAccess: false,
            },
        });

        await expect(mint({}, tokenActor)).rejects.toMatchObject({
            legacyCode: 'forbidden',
        });
    });

    it('does not block a full-access token acting for its own user, on their own namespace', async () => {
        const patActor = makeActor({
            user: owner.actor.user as never,
            accessToken: {
                uid: `tok-${uuidv4()}`,
                issuer: owner.actor,
                authorized: null,
                fullAccess: true,
            },
        });

        await expect(
            mint({ prefix: 'pat-probe:' }, patActor),
        ).resolves.toMatchObject({ prefix: 'pat-probe:' });
    });
});

describe('an app minting with consent', () => {
    beforeAll(async () => {
        await delegate();
    });

    it('mints inside the region it was given, and beneath it', async () => {
        await expect(mint()).resolves.toMatchObject({ prefix: PREFIX });
        // Prefix implication: one consent covers the keys under it.
        await expect(
            mint({ prefix: `${PREFIX}messages:` }),
        ).resolves.toMatchObject({ prefix: `${PREFIX}messages:` });
    });

    it('cannot name a namespace other than its own', async () => {
        // The reach cap is structural — this app addresses `v1:<user>:<app>`
        // and nothing else — so naming another namespace is refused rather
        // than minted somewhere the app cannot even write.
        await expect(
            mint({ appUid: 'os-global' }),
        ).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_outside_namespace',
        });
        await expect(
            mint({ appUid: `app-${uuidv4()}` }),
        ).rejects.toMatchObject({
            legacyCode: 'events_kv_handle_outside_namespace',
        });
    });

    it('ignores a fabricated owner field — the owner is always the caller behind the app', async () => {
        // The request has no field an owner could even be read from — `owner`
        // is always `actor.user` — so a body naming someone else changes
        // nothing about whose namespace or issuer identity the grant carries.
        await mint({
            owner: guest.uuid,
            ownerUuid: guest.uuid,
            ownerUserUuid: guest.uuid,
            userUuid: guest.uuid,
        });

        const rows = (await env.server.clients.db.pread(
            'SELECT `issuer_user_id` FROM `user_to_user_permissions` WHERE `permission` = ?',
            [kvSharePermission(owner.uuid, appUid, PREFIX)],
        )) as Array<{ issuer_user_id: number }>;

        expect(rows).toHaveLength(1);
        expect(rows[0].issuer_user_id).toBe(owner.id);

        // No grant was ever written under the fabricated owner's namespace —
        // checked as a row count, not `permissions().check()`, since a user
        // asking about their own uuid's namespace always reads as "owns it"
        // by construction (the owner shortcut), independent of any grant row.
        const fabricated = (await env.server.clients.db.pread(
            'SELECT `holder_user_id` FROM `user_to_user_permissions` WHERE `permission` = ?',
            [kvSharePermission(guest.uuid, appUid, PREFIX)],
        )) as Array<{ holder_user_id: number }>;
        expect(fabricated).toHaveLength(0);
    });

    it('grants in its own namespace, so the owner`s own region is untouched', async () => {
        await mint();

        await expect(
            permissions().check(
                guest.actor,
                kvSharePermission(owner.uuid, appUid, PREFIX),
            ),
        ).resolves.toBe(true);
        await expect(
            permissions().check(
                guest.actor,
                kvSharePermission(owner.uuid, 'os-global', PREFIX),
            ),
        ).resolves.toBe(false);
    });

    it('records the owner as the issuer, not the app', async () => {
        await mint();
        const rows = (await env.server.clients.db.pread(
            'SELECT `issuer_user_id`, `holder_user_id` FROM `user_to_user_permissions` WHERE `permission` = ?',
            [kvSharePermission(owner.uuid, appUid, PREFIX)],
        )) as Array<{ issuer_user_id: number; holder_user_id: number }>;

        expect(rows).toHaveLength(1);
        expect(rows[0].issuer_user_id).toBe(owner.id);
        expect(rows[0].holder_user_id).toBe(guest.id);
    });

    it('leaves an audit row naming the user and the app that acted', async () => {
        const prefix = `audit-probe-${uuidv4().slice(0, 8)}:`;
        await delegate(prefix);
        await mint({ prefix });

        const row = await vi.waitFor(async () => {
            const [found] = (await env.server.clients.db.pread(
                'SELECT `issuer_user_id`, `holder_user_id`, `extra` FROM `audit_user_to_user_permissions` ' +
                    'WHERE `permission` = ? AND `action` = ?',
                [kvSharePermission(owner.uuid, appUid, prefix), 'grant'],
            )) as Array<{
                issuer_user_id: number;
                holder_user_id: number;
                extra: unknown;
            }>;
            expect(found).toBeDefined();
            return found;
        });

        expect(row.issuer_user_id).toBe(owner.id);
        expect(row.holder_user_id).toBe(guest.id);
        const extra =
            typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
        expect(extra).toMatchObject({ appUid });
    });

    it('shows up in the owner`s listing of what they have shared out', async () => {
        const { handle } = await mint();
        const page = await events().listKvHandles(owner.actor, { limit: 100 });

        expect(page.items).toContainEqual(
            expect.objectContaining({
                handle,
                prefix: PREFIX,
                appUid,
                granteeUsername: guest.username,
                revokedAt: null,
            }),
        );
    });
});

describe('a handle an app minted', () => {
    beforeAll(async () => {
        await delegate();
    });

    it('delivers the app`s writes to the grantee', async () => {
        await clearRows();
        const { handle } = await mint();
        const { sub } = await events().subscribe(guest.actor, SOCKET_ID, {
            subject: `kv:${handle}:*`,
        });
        delivered.length = 0;

        await appWrites(`${PREFIX}messages:1`, { body: 'hello' });
        await settled();

        expect(delivered).toHaveLength(1);
        expect(delivered[0].subId).toBe(sub.subId);
        // Relative to the handle, the same as an owner-minted one.
        expect(delivered[0].event).toMatchObject({
            subject: `kv:${handle}:messages:1`,
            key: 'messages:1',
            op: 'set',
        });
    });

    it('settles on revocation exactly as an owner-minted one does', async () => {
        await clearRows();
        const { handle } = await mint();
        const { sub } = await events().subscribeDurable(guest.actor, {
            subject: `kv:${handle}:*`,
            delivery: 'single',
            handlerName: 'onChange',
        });

        await events().revokeKvHandle(owner.actor, handle);
        await vi.waitFor(
            async () => {
                const [row] = (await env.server.clients.db.pread(
                    `SELECT \`suspended_reason\` FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
                    [sub.subId],
                )) as Array<{ suspended_reason: unknown }>;
                expect(row?.suspended_reason).toBe('permission_revoked');
            },
            { timeout: 5_000, interval: 25 },
        );

        delivered.length = 0;
        await appWrites(`${PREFIX}messages:2`, { body: 'after' });
        await quiet();
        expect(delivered).toEqual([]);
    });
});
