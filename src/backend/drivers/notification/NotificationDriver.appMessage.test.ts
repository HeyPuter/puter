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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { findNotificationType } from '../../services/notification/notificationTypes.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { peekRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { NotificationDriver } from './NotificationDriver.js';

/**
 * Charges to a held key wait here until the test lets them go, so two requests
 * can both be read before either is spent. Every charge is recorded by key.
 */
const charges = vi.hoisted(() => ({
    held: new Set<string>(),
    waiting: [] as Array<() => void>,
    made: [] as string[],
}));

vi.mock('../../core/http/middleware/rateLimit.js', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('../../core/http/middleware/rateLimit.js')
        >();
    return {
        ...actual,
        checkRateLimit: async (key: string, ...rest: unknown[]) => {
            if (charges.held.has(key)) {
                await new Promise<void>((go) => charges.waiting.push(go));
            }
            charges.made.push(key);
            return (
                actual.checkRateLimit as (...a: unknown[]) => Promise<boolean>
            )(key, ...rest);
        },
    };
});

const until = async (ready: () => boolean): Promise<void> => {
    for (let i = 0; i < 400 && !ready(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!ready()) throw new Error('timed out');
};

const makeUser = async (server: PuterServer): Promise<Actor> => {
    const username = `am-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const user = (await server.stores.user.getById(created.id))!;
    return makeActor({
        user: {
            id: user.id,
            uuid: user.uuid,
            username: user.username,
            email: user.email ?? null,
            email_confirmed: true,
        } as Actor['user'],
    });
};

const makeApp = async (
    server: PuterServer,
    ownerUserId: number,
): Promise<{ id: number; uid: string }> => {
    const name = `am-app-${Math.random().toString(36).slice(2, 10)}`;
    return (await server.stores.app.create(
        {
            name,
            title: 'App message test',
            index_url: `https://${name}.test/`,
        },
        { ownerUserId },
    )) as { id: number; uid: string };
};

const asApp = (holder: Actor, app: { id: number; uid: string }): Actor =>
    makeActor({ user: holder.user, app });

/** A worker acts as its user, with its app as the app. */
const asWorker = (holder: Actor, app: { id: number; uid: string }): Actor =>
    makeActor({
        user: holder.user,
        app,
        session: { uid: `ws-${uuidv4()}`, kind: 'worker' },
    });

const asIssuedToken = (holder: Actor, issuer: Actor): Actor =>
    makeActor({
        user: holder.user,
        accessToken: { uid: `tok-${uuidv4()}`, issuer, authorized: null },
    });

const withActor = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const message = (fields: Record<string, unknown> = {}) => ({
    object: { value: { type: 'app.message', title: 'Hello', ...fields } },
});

/** Every payload the bus carried under `key` while `fn` ran. */
const captureBus = async (
    server: PuterServer,
    key: string,
    fn: () => Promise<unknown>,
): Promise<Array<Record<string, unknown>>> => {
    const seen: Array<Record<string, unknown>> = [];
    const handler = (_k: string, data: unknown) =>
        seen.push(data as Record<string, unknown>);
    server.clients.event.on(key, handler);
    try {
        await fn();
        // Listeners may run after `emit` returns.
        await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
        server.clients.event.off?.(key, handler);
    }
    return seen;
};

const DAY_MS = 24 * 60 * 60_000;

/** Exactly `count` slots of a window are spent. */
const expectSpent = async (
    key: string,
    windowMs: number,
    count: number,
): Promise<void> => {
    expect(await peekRateLimit(key, count, windowMs)).toBe(false);
    expect(await peekRateLimit(key, count + 1, windowMs)).toBe(true);
};

const bootServer = (config: Partial<IConfig>) => {
    const state = {
        server: null as unknown as PuterServer,
        driver: null as unknown as NotificationDriver,
    };
    beforeAll(async () => {
        state.server = await setupTestServer(config as IConfig);
        state.driver = state.server.drivers
            .notifications as unknown as NotificationDriver;
    });
    afterAll(async () => {
        await state.server?.shutdown();
    });
    return state;
};

describe('app.message with live delivery over the socket wire', () => {
    const state = bootServer({
        notificationAppMessageLimits: { perMinute: 3 },
    });

    it('stores the message for the acting user, under the app', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);

        let created: Record<string, unknown> | null = null;
        let desktop: Array<Record<string, unknown>> = [];
        const written = await captureBus(state.server, 'notif.written', () =>
            captureBus(state.server, 'outer.gui.notif.message', async () => {
                created = (await withActor(asApp(holder, app), () =>
                    state.driver.create(
                        message({ text: 'Body', channel: 'replies' }),
                    ),
                )) as Record<string, unknown>;
            }).then((seen) => (desktop = seen)),
        );

        const uid = created!.uid as string;
        expect(created!.value).toEqual({
            type: 'app.message',
            title: 'Hello',
            text: 'Body',
            channel: 'replies',
            priority: 'normal',
            ttl: 3600,
            app: { uid: app.uid, name: 'App message test' },
        });
        const row = await state.server.stores.notification.getByUid(uid, {
            userId: holder.user.id,
        });
        expect(row).toMatchObject({
            user_id: holder.user.id,
            app_uid: app.uid,
            audience: 'app-user',
            type: 'app.message',
        });
        // Not silent, but sent for the app alone: the desktop wire stays quiet.
        expect(written).toEqual([
            expect.objectContaining({
                userId: holder.user.id,
                uid,
                type: 'app.message',
                appUid: app.uid,
            }),
        ]);
        expect(desktop).toEqual([]);
    });

    it("lets the app's worker and the tokens it issued notify their user", async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);

        for (const actor of [
            asWorker(holder, app),
            asIssuedToken(holder, asApp(holder, app)),
        ]) {
            const created = (await withActor(actor, () =>
                state.driver.create(message()),
            )) as Record<string, unknown>;
            const row = await state.server.stores.notification.getByUid(
                created.uid as string,
                { userId: holder.user.id },
            );
            expect(row).toMatchObject({
                user_id: holder.user.id,
                app_uid: app.uid,
            });
        }
    });

    it('refuses an app any other type', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        for (const type of ['share.received', 'app.events.suspended']) {
            await expect(
                withActor(asApp(holder, app), () =>
                    state.driver.create({ object: { value: { type } } }),
                ),
            ).rejects.toMatchObject({
                statusCode: 403,
                code: 'notification_type_not_allowed',
            });
        }
    });

    it('refuses a recipient or app named by the caller', async () => {
        const holder = await makeUser(state.server);
        const other = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        const otherApp = await makeApp(state.server, holder.user.id!);

        for (const extra of [
            { userId: other.user.id },
            { recipient: other.user.uuid },
            { appUid: otherApp.uid },
        ]) {
            await expect(
                withActor(asApp(holder, app), () =>
                    state.driver.create({
                        object: { ...message().object, ...extra },
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        }
        const theirs = await state.server.stores.notification.listByUserId(
            other.user.id!,
            {},
        );
        expect(theirs).toEqual([]);
    });

    it('refuses an app message that fails validation, writing nothing', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        await expect(
            withActor(asApp(holder, app), () =>
                state.driver.create(message({ icon: 'http://x.test/a.png' })),
            ),
        ).rejects.toMatchObject({ statusCode: 400, fields: { field: 'icon' } });
        await expect(
            withActor(asApp(holder, app), () =>
                state.driver.create({
                    object: { value: { type: 'app.message' } },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            fields: { field: 'title' },
        });
        expect(
            await state.server.stores.notification.listByUserId(
                holder.user.id!,
                {},
            ),
        ).toEqual([]);
    });

    it('names the field over its own limit before the total size', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        for (const [fields, field] of [
            [{ data: { blob: 'x'.repeat(20_000) } }, 'data'],
            [{ text: 'x'.repeat(20_000) }, 'text'],
            [{ extra: 'x'.repeat(20_000) }, 'extra'],
        ] as const) {
            await expect(
                withActor(asApp(holder, app), () =>
                    state.driver.create(message(fields)),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
                fields: { field },
            });
        }
    });

    it('still caps the whole value when every field passes', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        // Invisible marks are dropped from the title, so only the total is over.
        await expect(
            withActor(asApp(holder, app), () =>
                state.driver.create(
                    message({ title: `${'\u200b'.repeat(20_000)}Hi` }),
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'notification_value_too_large',
        });
    });

    it('keeps the holder creating other types silently', async () => {
        const holder = await makeUser(state.server);
        const pushed = await captureBus(
            state.server,
            'outer.gui.notif.message',
            () =>
                withActor(holder, () =>
                    state.driver.create({
                        object: {
                            value: { type: 'share.received', title: 'hi' },
                        },
                    }),
                ),
        );
        expect(pushed).toEqual([]);
        const rows = await state.server.stores.notification.listByUserId(
            holder.user.id!,
            {},
        );
        expect(rows.map((r: Record<string, unknown>) => r.type)).toEqual([
            'share.received',
        ]);
    });

    it('refuses an app message from the holder, with or without an app', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        for (const object of [
            message().object,
            { ...message().object, appUid: app.uid },
        ]) {
            await expect(
                withActor(holder, () => state.driver.create({ object })),
            ).rejects.toMatchObject({
                statusCode: 403,
                code: 'notification_type_not_allowed',
            });
        }
    });

    it('limits each app per user per minute', async () => {
        const holder = await makeUser(state.server);
        const otherUser = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        const otherApp = await makeApp(state.server, holder.user.id!);

        for (let i = 0; i < 3; i++) {
            await withActor(asApp(holder, app), () =>
                state.driver.create(message()),
            );
        }
        // The app's worker spends the same budget as the app.
        for (let i = 0; i < 2; i++) {
            await expect(
                withActor(asWorker(holder, app), () =>
                    state.driver.create(message()),
                ),
            ).rejects.toMatchObject({
                statusCode: 429,
                legacyCode: 'too_many_requests',
            });
        }
        // Refused calls left the day window at 3, not 5.
        expect(
            await peekRateLimit(
                `notif:app-message:day:${holder.user.id}:${app.uid}`,
                4,
                24 * 60 * 60_000,
            ),
        ).toBe(true);

        await expect(
            withActor(asApp(holder, otherApp), () =>
                state.driver.create(message()),
            ),
        ).resolves.toMatchObject({ uid: expect.any(String) });
        await expect(
            withActor(asApp(otherUser, app), () =>
                state.driver.create(message()),
            ),
        ).resolves.toMatchObject({ uid: expect.any(String) });
    });

    it('spends the day window only on a request the minute window admits', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        const minuteKey = `notif:app-message:minute:${holder.user.id}:${app.uid}`;
        const dayKey = `notif:app-message:day:${holder.user.id}:${app.uid}`;
        for (let i = 0; i < 2; i++) {
            await withActor(asApp(holder, app), () =>
                state.driver.create(message()),
            );
        }

        charges.held.add(minuteKey).add(dayKey);
        charges.made.length = 0;
        let settled = false;
        const outcome = Promise.allSettled([
            withActor(asApp(holder, app), () => state.driver.create(message())),
            withActor(asApp(holder, app), () => state.driver.create(message())),
        ]).finally(() => {
            settled = true;
        });
        try {
            // Both requests read the windows as open before either spends.
            await until(() => charges.waiting.length === 2);
            while (!settled) {
                await until(() => settled || charges.waiting.length > 0);
                charges.waiting.shift()?.();
            }
        } finally {
            charges.held.clear();
        }

        const results = await outcome;
        expect(results.map((r) => r.status).sort()).toEqual([
            'fulfilled',
            'rejected',
        ]);
        const refused = results.find((r) => r.status === 'rejected') as
            PromiseRejectedResult | undefined;
        expect(refused?.reason).toMatchObject({ statusCode: 429 });
        // The refused request left the day window alone.
        expect(charges.made.filter((k) => k === dayKey)).toEqual([dayKey]);
        expect(await peekRateLimit(dayKey, 4, 24 * 60 * 60_000)).toBe(true);
    });

    it("reads back the app's own messages and no other app's", async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        const otherApp = await makeApp(state.server, holder.user.id!);
        const created = (await withActor(asApp(holder, app), () =>
            state.driver.create(message()),
        )) as Record<string, unknown>;
        await withActor(holder, () =>
            state.driver.create({
                object: { value: { type: 'share.received', title: 'acct' } },
            }),
        );

        const read = (await withActor(asApp(holder, app), () =>
            state.driver.read({ uid: created.uid }),
        )) as Record<string, unknown>;
        expect(read.uid).toBe(created.uid);

        for (const subject of [undefined, 'notif:app-user']) {
            const listed = (await withActor(asApp(holder, app), () =>
                state.driver.select({ subject }),
            )) as Array<Record<string, unknown>>;
            expect(listed.map((n) => n.uid)).toEqual([created.uid]);
        }

        await expect(
            withActor(asApp(holder, otherApp), () =>
                state.driver.read({ uid: created.uid }),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(
            await withActor(asApp(holder, otherApp), () =>
                state.driver.select({}),
            ),
        ).toEqual([]);
    });
});

describe('app.message groups', () => {
    const state = bootServer({
        notificationAppMessageLimits: { perMinute: 5, perDay: 4 },
    });

    const setup = async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        const send = async (fields: Record<string, unknown> = {}) =>
            (await withActor(asApp(holder, app), () =>
                state.driver.create(message(fields)),
            )) as Record<string, unknown>;
        const rows = () =>
            state.server.stores.notification.listByUserId(holder.user.id!, {});
        return {
            holder,
            app,
            send,
            rows,
            minuteKey: `notif:app-message:minute:${holder.user.id}:${app.uid}`,
            dayKey: `notif:app-message:day:${holder.user.id}:${app.uid}`,
        };
    };

    it('replaces the unseen message with the same group, spending no day slot', async () => {
        const { holder, app, send, rows, minuteKey, dayKey } = await setup();
        const first = await send({ title: 'One', group: 'chat-1' });

        let second: Record<string, unknown> = {};
        const written = await captureBus(
            state.server,
            'notif.written',
            async () => {
                second = await send({
                    title: 'Two',
                    text: 'Hi',
                    group: 'chat-1',
                });
            },
        );

        expect(second.uid).toBe(first.uid);
        expect(second.value).toMatchObject({ title: 'Two', text: 'Hi' });
        expect(await rows()).toEqual([
            expect.objectContaining({
                uid: first.uid,
                value: expect.objectContaining({ title: 'Two' }),
            }),
        ]);
        expect(written).toEqual([
            expect.objectContaining({
                userId: holder.user.id,
                uid: first.uid,
                appUid: app.uid,
                updated: true,
            }),
        ]);
        await expectSpent(minuteKey, 60_000, 2);
        await expectSpent(dayKey, DAY_MS, 1);
    });

    it('starts a new message once the last one was shown or dismissed', async () => {
        const { holder, app, send, rows, dayKey } = await setup();
        const asTheApp = asApp(holder, app);

        const first = await send({ group: 'chat-1' });
        await withActor(asTheApp, () =>
            state.driver.mark_shown({ uid: first.uid }),
        );
        const second = await send({ group: 'chat-1' });
        expect(second.uid).not.toBe(first.uid);

        await withActor(asTheApp, () =>
            state.driver.mark_acknowledged({ uid: second.uid }),
        );
        const third = await send({ group: 'chat-1' });
        expect(third.uid).not.toBe(second.uid);

        expect(await rows()).toHaveLength(3);
        await expectSpent(dayKey, DAY_MS, 3);
    });

    it('keeps messages with no group, or another group, apart', async () => {
        const { send, rows } = await setup();
        const uids = [
            (await send()).uid,
            (await send()).uid,
            (await send({ group: 'a' })).uid,
            (await send({ group: 'b' })).uid,
        ];
        expect(new Set(uids).size).toBe(4);
        expect(await rows()).toHaveLength(4);
    });

    it('still spends the minute window on a replacement', async () => {
        const { send, rows, dayKey } = await setup();
        for (let i = 0; i < 5; i++) await send({ group: 'chat-1' });
        await expect(send({ group: 'chat-1' })).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });
        expect(await rows()).toHaveLength(1);
        await expectSpent(dayKey, DAY_MS, 1);
    });

    it('replaces with the day window spent', async () => {
        const { send, rows } = await setup();
        const grouped = await send({ group: 'chat-1' });
        for (let i = 0; i < 3; i++) await send();
        await expect(send()).rejects.toMatchObject({ statusCode: 429 });

        const replaced = await send({ title: 'Later', group: 'chat-1' });
        expect(replaced.uid).toBe(grouped.uid);
        expect(await rows()).toHaveLength(4);
    });

    it('writes a new message when the old one is shown before the replace lands', async () => {
        const { holder, app, send, rows, minuteKey, dayKey } = await setup();
        const first = await send({ group: 'chat-1' });

        charges.held.add(minuteKey);
        const pending = send({ title: 'Raced', group: 'chat-1' });
        let second: Record<string, unknown>;
        try {
            await until(() => charges.waiting.length === 1);
            await withActor(asApp(holder, app), () =>
                state.driver.mark_shown({ uid: first.uid }),
            );
        } finally {
            charges.held.clear();
            charges.waiting.shift()?.();
            second = await pending;
        }

        expect(second.uid).not.toBe(first.uid);
        expect(await rows()).toHaveLength(2);
        await expectSpent(dayKey, DAY_MS, 2);
    });
});

describe('app.message with the events fold-in on', () => {
    const state = bootServer({
        events: { enabled: true, notificationsFoldIn: true },
        notificationAppMessageLimits: { perMinute: 3, perDay: 2 },
    } as Partial<IConfig>);

    it("emits notif.created on the app's app-user subject", async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        let uid = '';
        const created = await captureBus(
            state.server,
            'notif.created',
            async () => {
                const result = (await withActor(asApp(holder, app), () =>
                    state.driver.create(message()),
                )) as Record<string, unknown>;
                uid = result.uid as string;
            },
        );

        expect(created).toEqual([
            expect.objectContaining({
                userId: holder.user.id,
                uid,
                type: 'app.message',
                audience: 'app-user',
                appUid: app.uid,
            }),
        ]);
        expect(
            findNotificationType('app.message')!.subject({
                userUuid: holder.user.uuid!,
                appUid: app.uid,
            }),
        ).toBe(`notif:${app.uid}:app-user`);
    });

    it('dispatches a replacement again under the same uid', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        const first = (await withActor(asApp(holder, app), () =>
            state.driver.create(message({ group: 'g' })),
        )) as Record<string, unknown>;

        const created = await captureBus(state.server, 'notif.created', () =>
            withActor(asApp(holder, app), () =>
                state.driver.create(message({ title: 'Again', group: 'g' })),
            ),
        );
        expect(created).toEqual([
            expect.objectContaining({
                uid: first.uid,
                appUid: app.uid,
                audience: 'app-user',
                value: expect.objectContaining({ title: 'Again' }),
                replaced: true,
            }),
        ]);
        const row = await state.server.stores.notification.getByUid(
            first.uid as string,
            { userId: holder.user.id, primary: true },
        );
        expect(Number(row.replaced_at)).toBe(created[0].createdAt);
    });

    it('limits each app per user per day, without spending the minute', async () => {
        const holder = await makeUser(state.server);
        const app = await makeApp(state.server, holder.user.id!);
        for (let i = 0; i < 2; i++) {
            await withActor(asApp(holder, app), () =>
                state.driver.create(message()),
            );
        }
        for (let i = 0; i < 2; i++) {
            await expect(
                withActor(asApp(holder, app), () =>
                    state.driver.create(message()),
                ),
            ).rejects.toMatchObject({ statusCode: 429 });
        }
        // Refused calls left the minute window at 2, under its limit of 3.
        expect(
            await peekRateLimit(
                `notif:app-message:minute:${holder.user.id}:${app.uid}`,
                3,
                60_000,
            ),
        ).toBe(true);
    });
});
