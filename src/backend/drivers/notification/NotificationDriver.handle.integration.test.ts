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

/** `app.message` sent to the other party of a KV share through its handle. */

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
import { runWithContext } from '../../core/context.js';
import {
    claimRateLimit,
    peekRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { NotificationDriver } from './NotificationDriver.js';

const BOOT_TIMEOUT_MS = 120_000;
const DAY_MS = 24 * 60 * 60_000;

interface TestUser {
    actor: Actor;
    username: string;
    id: number;
}

let env: PuterTestEnv;
let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;

const driver = () =>
    env.server.drivers.notifications as unknown as NotificationDriver;

const userFor = async (username: string): Promise<TestUser> => {
    const row = await env.server.stores.user.getByUsername(username);
    return {
        actor: makeActor({ user: row as never }),
        username,
        id: row!.id!,
    };
};

const makeApp = async () => {
    const name = `notify-to-${uuidv4().slice(0, 8)}`;
    return env.server.stores.app.create(
        {
            name,
            title: 'Handle App',
            index_url: `https://${name}.example.test/index.html`,
        },
        { ownerUserId: owner.id },
    ) as Promise<{ uid: string; id: number }>;
};

const inApp = (user: TestUser, app: { uid: string; id: number }) =>
    makeActor({
        user: user.actor.user as never,
        app: { uid: app.uid, id: app.id },
    });

/** A share of `app`'s data from the owner to the guest. */
const share = async (app: { uid: string }, notify = true) =>
    env.server.services.kvShare.mintKvHandle(
        owner.actor,
        {
            prefix: `room-${uuidv4().slice(0, 8)}:`,
            recipient: { username: guest.username },
            appUid: app.uid,
            notify,
        },
        { defaultAccess: 'write' },
    );

const send = (actor: Actor, fields: Record<string, unknown> = {}) =>
    runWithContext({ actor }, () =>
        driver().create({
            object: { value: { type: 'app.message', title: 'Hi', ...fields } },
        }),
    ) as Promise<Record<string, unknown>>;

const rowsOf = (user: TestUser) =>
    env.server.stores.notification.listByUserId(user.id, {});

const minuteKey = (user: TestUser, appUid: string) =>
    `notif:app-message:minute:${user.id}:${appUid}`;
const dayKey = (user: TestUser, appUid: string) =>
    `notif:app-message:day:${user.id}:${appUid}`;

/** Exactly `count` slots of a window are spent. */
const expectSpent = async (key: string, windowMs: number, count: number) => {
    if (count > 0)
        expect(await peekRateLimit(key, count, windowMs)).toBe(false);
    expect(await peekRateLimit(key, count + 1, windowMs)).toBe(true);
};

/** Every payload the bus carried under `key` while `fn` ran. */
const captureBus = async (
    key: string,
    fn: () => Promise<unknown>,
): Promise<Array<Record<string, unknown>>> => {
    const seen: Array<Record<string, unknown>> = [];
    const handler = (_k: string, data: unknown) =>
        seen.push(data as Record<string, unknown>);
    env.server.clients.event.on(key, handler);
    try {
        await fn();
        await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
        env.server.clients.event.off?.(key, handler);
    }
    return seen;
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, kvHandles: true },
        kv: { shareHandles: true },
        unlimitedMetering: true,
        notificationAppMessageLimits: { perMinute: 5, perDay: 4 },
    } as IConfig);
    const strangerName = `notify-to-${uuidv4().slice(0, 8)}`;
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

describe('app.message to the other party of a share', () => {
    it('writes the owner’s message to the holder, and answers with the uid alone', async () => {
        const app = await makeApp();
        const { handle } = await share(app);

        let sent: Record<string, unknown> = {};
        const written = await captureBus('notif.written', async () => {
            sent = await send(inApp(owner, app), {
                title: 'New message',
                to: { handle },
            });
        });

        expect(Object.keys(sent)).toEqual(['uid']);
        const row = await env.server.stores.notification.getByUid(
            sent.uid as string,
        );
        expect(row).toMatchObject({
            user_id: guest.id,
            app_uid: app.uid,
            type: 'app.message',
            audience: 'app-user',
        });
        expect(row!.value).toEqual({
            type: 'app.message',
            title: 'New message',
            priority: 'normal',
            ttl: 3600,
            app: { uid: app.uid, name: 'Handle App' },
        });
        // The push extension bills and checks consent on this recipient.
        expect(written).toEqual([
            expect.objectContaining({
                userId: guest.id,
                uid: sent.uid,
                appUid: app.uid,
            }),
        ]);
    });

    it('writes the holder’s message to the owner', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const before = (await rowsOf(guest)).length;

        const sent = await send(inApp(guest, app), { to: { handle } });

        expect(Object.keys(sent)).toEqual(['uid']);
        expect(
            await env.server.stores.notification.getByUid(sent.uid as string),
        ).toMatchObject({ user_id: owner.id, app_uid: app.uid });
        expect(await rowsOf(guest)).toHaveLength(before);
    });

    it("charges the recipient's limits, not the sender's", async () => {
        const app = await makeApp();
        const { handle } = await share(app);

        await send(inApp(owner, app), { to: { handle } });

        await expectSpent(minuteKey(guest, app.uid), 60_000, 1);
        await expectSpent(dayKey(guest, app.uid), DAY_MS, 1);
        await expectSpent(minuteKey(owner, app.uid), 60_000, 0);
        await expectSpent(dayKey(owner, app.uid), DAY_MS, 0);

        // The recipient's own day window is the one that runs out.
        for (let i = 0; i < 3; i++)
            await send(inApp(guest, app), { title: `own ${i}` });
        await expect(
            send(inApp(owner, app), { to: { handle } }),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });
    });

    it("replaces the recipient's newest message in the same group", async () => {
        const app = await makeApp();
        const { handle } = await share(app);

        const first = await send(inApp(owner, app), {
            title: 'One',
            group: 'room-1',
            to: { handle },
        });
        const second = await send(inApp(owner, app), {
            title: 'Two',
            group: 'room-1',
            to: { handle },
        });

        expect(second).toEqual({ uid: first.uid });
        const rows = (await rowsOf(guest)).filter(
            (row: Record<string, unknown>) =>
                row.app_uid === app.uid && row.type === 'app.message',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toMatchObject({ title: 'Two' });
        await expectSpent(dayKey(guest, app.uid), DAY_MS, 1);
    });

    it.each([
        ['a string', 'kvh-1'],
        ['an array', [{ handle: 'kvh-1' }]],
        ['null', null],
        ['no handle', {}],
        ['a handle that is not a string', { handle: 7 }],
        ['an empty handle', { handle: '' }],
        ['another field beside the handle', { handle: 'kvh-1', user: 'x' }],
    ])('refuses `to` as %s', async (_label, to) => {
        const app = await makeApp();
        await expect(send(inApp(owner, app), { to })).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            fields: { field: 'to' },
        });
    });

    it('validates the message before spending the pair limit', async () => {
        const app = await makeApp();
        const { handle } = await share(app);
        const [minute] = KV_SHARE_NOTIFY_LIMITS;

        await expect(
            send(inApp(owner, app), {
                icon: 'http://insecure.test/a.png',
                to: { handle },
            }),
        ).rejects.toMatchObject({ statusCode: 400, fields: { field: 'icon' } });
        expect(
            await env.server.clients.redis.zcard(
                `rate:${minute.scope}:${owner.id}:${guest.id}:${app.uid}`,
            ),
        ).toBe(0);
    });

    describe('passes every refusal of the share through with its code', () => {
        const absent = {
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        };

        it('an unknown handle, or one the sender is no party to', async () => {
            const app = await makeApp();
            const { handle } = await share(app);
            await expect(
                send(inApp(owner, app), { to: { handle: `kvh-${uuidv4()}` } }),
            ).rejects.toMatchObject(absent);
            await expect(
                send(inApp(stranger, app), { to: { handle } }),
            ).rejects.toMatchObject(absent);
            await expect(
                send(inApp(owner, await makeApp()), { to: { handle } }),
            ).rejects.toMatchObject(absent);
        });

        it('a share without notify', async () => {
            const app = await makeApp();
            const { handle } = await share(app, false);
            await expect(
                send(inApp(owner, app), { to: { handle } }),
            ).rejects.toMatchObject({
                statusCode: 403,
                legacyCode: 'kv_share_notify_not_enabled',
            });
        });

        it('a recipient who blocked the sender', async () => {
            const app = await makeApp();
            const { handle } = await share(app);
            await env.server.stores.userBlock.create(guest.id, owner.id);
            try {
                await expect(
                    send(inApp(owner, app), { to: { handle } }),
                ).rejects.toMatchObject({
                    statusCode: 403,
                    legacyCode: 'recipient_not_accepting_shares',
                });
            } finally {
                await env.server.stores.userBlock.deleteByPair(
                    guest.id,
                    owner.id,
                );
            }
        });

        it('the pair limit', async () => {
            const app = await makeApp();
            const { handle } = await share(app);
            const [minute] = KV_SHARE_NOTIFY_LIMITS;
            await claimRateLimit(
                `${minute.scope}:${owner.id}:${guest.id}:${app.uid}`,
                minute.limit,
                minute.window,
                minute.limit,
            );
            await expect(
                send(inApp(owner, app), { to: { handle } }),
            ).rejects.toMatchObject({
                statusCode: 429,
                legacyCode: 'too_many_requests',
            });
            await expectSpent(dayKey(guest, app.uid), DAY_MS, 0);
        });

        it('a share that cannot be checked', async () => {
            const app = await makeApp();
            const { handle } = await share(app);
            const lookup = vi
                .spyOn(env.server.stores.kvShareHandle, 'getLive')
                .mockRejectedValue(new Error('lookup unavailable'));
            try {
                await expect(
                    send(inApp(owner, app), { to: { handle } }),
                ).rejects.toMatchObject({
                    statusCode: 503,
                    legacyCode: 'service_unavailable',
                });
            } finally {
                lookup.mockRestore();
            }
        });
    });
});
