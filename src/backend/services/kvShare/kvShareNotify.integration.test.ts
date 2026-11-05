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
 * Who a notification through a share handle reaches, against the real grant
 * machinery: either party to the other, from the app whose data it is, and
 * nobody else.
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
    EVENTS_KV_HANDLE_LIMIT,
    KV_SHARE_NOTIFY_LIMITS,
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { claimRateLimit } from '../../core/http/middleware/rateLimit.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';

const BOOT_TIMEOUT_MS = 120_000;

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
}

let env: PuterTestEnv;
let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;

const shares = () => env.server.services.kvShare;
const handles = () => env.server.stores.kvShareHandle;

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id!,
    };
};

const makeApp = async () => {
    const name = `kv-notify-${uuidv4().slice(0, 8)}`;
    return env.server.stores.app.create(
        {
            name,
            title: 'Notify App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId: owner.id },
    );
};

const inApp = (user: TestUser, app: { uid: string; id: number }) =>
    makeActor({
        user: user.actor.user as never,
        app: { uid: app.uid, id: app.id },
    });

/** A share of `app`'s data from the owner to the guest. */
const share = async (app: { uid: string }, notify = true) =>
    shares().mintKvHandle(
        owner.actor,
        {
            prefix: `room-${uuidv4().slice(0, 8)}:`,
            recipient: { username: guest.username },
            appUid: app.uid,
            notify,
        },
        { defaultAccess: 'write' },
    );

const resolve = (actor: Actor, handle: unknown) =>
    shares().resolveNotifyRecipient(actor, handle);

const absent = { statusCode: 404, legacyCode: 'subject_does_not_exist' };

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        kv: { shareHandles: true },
        unlimitedMetering: true,
    } as IConfig);
    const strangerName = `kv-notify-${uuidv4().slice(0, 8)}`;
    await createTestUser(env.server, {
        username: strangerName,
        password: 'pw-test-1234',
    });
    owner = await userFor(env.users.user.username);
    guest = await userFor(env.users.other.username);
    stranger = await userFor(strangerName);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.redis.del(
        `rate:${EVENTS_KV_HANDLE_LIMIT.scope}:${owner.id}`,
    );
});

describe('resolving who a notification through a share reaches', () => {
    it('sends from the owner to the holder, and from the holder to the owner', async () => {
        const app = await makeApp();
        const { handle } = await share(app);

        await expect(resolve(inApp(owner, app), handle)).resolves.toEqual({
            recipientUserId: guest.id,
            appUid: app.uid,
            handle,
        });
        await expect(resolve(inApp(guest, app), handle)).resolves.toEqual({
            recipientUserId: owner.id,
            appUid: app.uid,
            handle,
        });
    });

    it('answers someone who is not a party exactly as it answers an unknown handle', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const unknown = `kvh-${uuidv4()}`;

        const refusal = async (actor: Actor, named: string) => {
            try {
                await resolve(actor, named);
            } catch (err) {
                return err as { statusCode: number; legacyCode: string };
            }
            throw new Error('expected a refusal');
        };
        const foreign = await refusal(inApp(stranger, app), handle);
        expect(foreign).toMatchObject(absent);
        expect(await refusal(inApp(stranger, app), unknown)).toMatchObject(
            absent,
        );
        await expect(resolve(inApp(owner, app), 42)).rejects.toMatchObject(
            absent,
        );
    });

    it('reads as absent from another app, and refuses the account itself', async () => {
        const app = await makeApp();
        const other = await makeApp();
        const { handle } = await share(app);

        await expect(
            resolve(inApp(guest, other), handle),
        ).rejects.toMatchObject(absent);
        await expect(resolve(guest.actor, handle)).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'forbidden',
        });
    });

    it('refuses a share that does not allow notifications, and only to a party', async () => {
        const app = await makeApp();
        const { handle } = await share(app, false);

        await expect(resolve(inApp(owner, app), handle)).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'kv_share_notify_not_enabled',
        });
        await expect(
            resolve(inApp(stranger, app), handle),
        ).rejects.toMatchObject(absent);
    });

    it('reads a retired share as absent', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        await shares().removeKvShare(guest.actor, handle);

        await expect(resolve(inApp(owner, app), handle)).rejects.toMatchObject(
            absent,
        );
    });

    it.each([
        ['the holder blocked the owner', 'guest', 'owner'],
        ['the owner blocked the holder', 'owner', 'guest'],
    ] as const)(
        'refuses a sender the recipient blocked: %s',
        async (_name, blocker, blocked) => {
            const app = await makeApp();
            const { handle } = await share(app);
            const users = { owner: () => owner, guest: () => guest };
            await env.server.stores.userBlock.create(
                users[blocker]().id,
                users[blocked]().id,
            );
            try {
                await expect(
                    resolve(inApp(users[blocked](), app), handle),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    legacyCode: 'recipient_not_accepting_shares',
                });
                // The block is one way: the blocker can still send.
                await expect(
                    resolve(inApp(users[blocker](), app), handle),
                ).resolves.toMatchObject({
                    recipientUserId: users[blocked]().id,
                });
            } finally {
                await env.server.stores.userBlock.deleteByPair(
                    users[blocker]().id,
                    users[blocked]().id,
                );
            }
        },
    );

    it('reads a share whose grant is gone as absent, from either side', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const row = await handles().getByHandle(handle);
        await env.server.services.permission.revokeUserUserPermission(
            owner.actor,
            guest.username,
            row!.permission,
            { reason: 'test' },
        );

        await expect(resolve(inApp(owner, app), handle)).rejects.toMatchObject(
            absent,
        );
        await expect(resolve(inApp(guest, app), handle)).rejects.toMatchObject(
            absent,
        );
    });

    it('reads a share whose owner is suspended as absent', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const live = await handles().getLive(handle);

        const suspended = vi
            .spyOn(handles(), 'getLive')
            .mockResolvedValue({ ...live!, ownerSuspended: true });
        try {
            await expect(
                resolve(inApp(guest, app), handle),
            ).rejects.toMatchObject(absent);
        } finally {
            suspended.mockRestore();
        }
    });

    it('answers a failed lookup as a temporary error, not as absent', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const unavailable = {
            statusCode: 503,
            legacyCode: 'service_unavailable',
        };

        const lookup = vi
            .spyOn(handles(), 'getLive')
            .mockRejectedValue(new Error('lookup unavailable'));
        try {
            await expect(
                resolve(inApp(owner, app), handle),
            ).rejects.toMatchObject(unavailable);
        } finally {
            lookup.mockRestore();
        }

        const grant = vi
            .spyOn(env.server.services.permission, 'check')
            .mockRejectedValue(new Error('grant check unavailable'));
        try {
            await expect(
                resolve(inApp(owner, app), handle),
            ).rejects.toMatchObject(unavailable);
        } finally {
            grant.mockRestore();
        }
    });

    it('caps what one party sends the other in one app, leaving the other direction alone', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const [minute] = KV_SHARE_NOTIFY_LIMITS;
        await claimRateLimit(
            `${minute.scope}:${owner.id}:${guest.id}:${app.uid}`,
            minute.limit,
            minute.window,
            minute.limit - 1,
        );

        await expect(resolve(inApp(owner, app), handle)).resolves.toMatchObject(
            { recipientUserId: guest.id },
        );
        await expect(resolve(inApp(owner, app), handle)).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });
        await expect(resolve(inApp(guest, app), handle)).resolves.toMatchObject(
            { recipientUserId: owner.id },
        );
    });

    it('spends nothing on a refused call', async () => {
        const app = await makeApp();
        const { handle } = await share(app, false);
        const [minute] = KV_SHARE_NOTIFY_LIMITS;
        const key = `rate:${minute.scope}:${owner.id}:${guest.id}:${app.uid}`;

        await expect(resolve(inApp(owner, app), handle)).rejects.toMatchObject({
            legacyCode: 'kv_share_notify_not_enabled',
        });
        expect(await env.server.clients.redis.zcard(key)).toBe(0);
    });
});
