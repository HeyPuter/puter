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
import { makeActor } from '../../core/actor.js';
import type { PuterServer } from '../../server.js';
import type { PushPlatform } from '../../stores/push/PushDeviceStore.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { PermissionService } from '../permission/PermissionService.js';
import { NOTIFICATIONS_PUSH_PERMISSION } from './pushConsent.js';
import { PUTER_PUSH_PREFERENCE_KEY } from './PushService.js';
import type { PushBatch, PushProvider, PushResult } from './types.js';

interface TestUser {
    id: number;
    uuid: string;
    username: string;
}

/** Records every call; a token's text decides its scripted result. */
class FakeProvider implements PushProvider {
    readonly calls: PushBatch[] = [];
    constructor(readonly platforms: PushPlatform[] = ['web']) {}

    async send(batch: PushBatch): Promise<PushResult[]> {
        this.calls.push(batch);
        return batch.tokens.map((token) => {
            if (token.includes('gone')) return { status: 'unregistered' };
            if (token.includes('bad')) {
                // A provider's own text never reaches the log, only the code.
                return {
                    status: 'failed',
                    code: 'invalid_token',
                    reason: `rejected https://push.example.test/${token}`,
                } as PushResult;
            }
            return { status: 'delivered' };
        });
    }
}

/** Long enough for a delivery that was going to start to have finished. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const bootWith = (config: Record<string, unknown>, provider?: FakeProvider) => {
    const state = { server: null as unknown as PuterServer };
    beforeAll(async () => {
        state.server = await setupTestServer(config as IConfig);
        if (provider) state.server.services.push.registerProvider(provider);
    });
    afterAll(async () => {
        await state.server?.shutdown();
    });
    return state;
};

const makeUser = async (server: PuterServer): Promise<TestUser> =>
    (await server.stores.user.create({
        username: `pd${Math.random().toString(36).slice(2, 10)}`,
        uuid: uuidv4(),
        password: null,
        email: null,
        requires_email_confirmation: false,
    })) as TestUser;

const makeApp = async (
    server: PuterServer,
    owner: TestUser,
): Promise<{ uid: string; name: string }> => {
    const create = server.stores.app.create.bind(
        server.stores.app,
    ) as unknown as (
        fields: Record<string, unknown>,
        opts: { ownerUserId: number },
    ) => Promise<{ uid: string; name: string }>;
    return create(
        {
            name: `push-${uuidv4()}`,
            title: 'Push app',
            index_url: `https://push-${uuidv4()}.test/`,
        },
        { ownerUserId: owner.id },
    );
};

/** One live session per user, so devices count as active. */
const sessions = new WeakMap<PuterServer, Map<number, string>>();
const sessionOf = async (server: PuterServer, userId: number) => {
    const mine = sessions.get(server) ?? new Map<number, string>();
    sessions.set(server, mine);
    let uid = mine.get(userId);
    if (!uid) {
        uid = ((await server.stores.session.create(userId)) as { uuid: string })
            .uuid;
        mine.set(userId, uid);
    }
    return uid;
};

const registerDevice = async (
    server: PuterServer,
    userId: number,
    token: string,
    opts: { appUid?: string; platform?: PushPlatform } = {},
) =>
    server.stores.pushDevice.register({
        userId,
        sessionUid: await sessionOf(server, userId),
        platform: opts.platform ?? 'web',
        token,
        appUid: opts.appUid ?? null,
    });

const grantPush = (server: PuterServer, user: TestUser, appUid: string) =>
    (
        server.services.permission as unknown as PermissionService
    ).grantUserAppPermission(
        makeActor({ user: user as never }),
        appUid,
        NOTIFICATIONS_PUSH_PERMISSION,
    );

const shareReceived = (server: PuterServer, userId: number) =>
    server.services.notification.notify(
        [userId],
        {
            title: 'alice shared an item with you',
            fields: {
                username: 'alice',
                count: 1,
                senders: [{ username: 'alice', count: 1 }],
                target: {
                    path: '/alice/Shared/report.txt',
                    name: 'report.txt',
                },
            },
        },
        { type: 'share.received' },
    );

const tokensOf = (calls: PushBatch[]) =>
    calls.flatMap((call) => call.tokens).sort();

describe('PushService delivery', () => {
    const provider = new FakeProvider();
    const state = bootWith({ push: { enabled: true } }, provider);
    const server = () => state.server;

    beforeEach(() => {
        provider.calls.length = 0;
    });

    it('sends a share to the user’s Puter devices, naming the item', async () => {
        const user = await makeUser(server());
        const token = `tok-${uuidv4()}`;
        await registerDevice(server(), user.id, token);

        const uid = await shareReceived(server(), user.id);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        const [call] = provider.calls;
        expect(call.platform).toBe('web');
        expect(call.tokens).toEqual([token]);
        expect(call.message).toMatchObject({
            uid,
            title: 'alice shared report.txt',
            group: uid,
            target: { path: '/alice/Shared/report.txt' },
        });
    });

    it('uses the stored title for a share of several items', async () => {
        const user = await makeUser(server());
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);

        await server().services.notification.notify(
            [user.id],
            {
                title: 'alice shared 2 items with you',
                fields: { senders: [{ username: 'alice', count: 2 }] },
            },
            { type: 'share.received' },
        );

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        expect(provider.calls[0].message.title).toBe(
            'alice shared 2 items with you',
        );
    });

    it('sends nothing to a user with no devices', async () => {
        const user = await makeUser(server());
        const listed = vi.spyOn(server().stores.pushDevice, 'listForDelivery');
        await shareReceived(server(), user.id);
        await vi.waitFor(() => expect(listed).toHaveBeenCalled());
        await settle();
        listed.mockRestore();
        expect(provider.calls).toHaveLength(0);
    });

    it('sends an app message once, to Puter’s and that app’s devices only', async () => {
        const user = await makeUser(server());
        const other = await makeUser(server());
        const app = await makeApp(server(), user);
        const otherApp = await makeApp(server(), user);
        await grantPush(server(), user, app.uid);

        await registerDevice(server(), user.id, 'tok-puter');
        await registerDevice(server(), user.id, 'tok-app', { appUid: app.uid });
        await registerDevice(server(), user.id, 'tok-other-app', {
            appUid: otherApp.uid,
        });
        await registerDevice(server(), other.id, 'tok-other-user');

        const uid = await server().services.notification.notify(
            [user.id],
            { title: 'New reply', text: 'see you at 5', group: 'room-7' },
            { type: 'app.message', appUid: app.uid },
        );

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        await settle();
        expect(provider.calls).toHaveLength(1);
        expect(tokensOf(provider.calls)).toEqual(['tok-app', 'tok-puter']);
        expect(provider.calls[0].message).toMatchObject({
            uid,
            title: 'New reply',
            body: 'see you at 5',
            group: `${app.uid}:room-7`,
            target: { app: app.uid },
        });
    });

    it('sends a sensitive app message as a generic one under the app’s name', async () => {
        const user = await makeUser(server());
        const app = await makeApp(server(), user);
        await grantPush(server(), user, app.uid);
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);

        await server().services.notification.notify(
            [user.id],
            {
                title: 'Code qx-marker',
                text: 'your sign-in code qx-marker',
                data: { code: 'qx-marker' },
                sensitive: true,
                ttl: 90,
                app: { uid: app.uid, name: 'stamped-name' },
            },
            { type: 'app.message', appUid: app.uid },
        );

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        const message = provider.calls[0].message;
        expect(message).toMatchObject({
            title: 'stamped-name',
            body: 'New notification from stamped-name',
            target: { app: app.uid },
            ttl: 90,
            sensitive: true,
        });
        expect(JSON.stringify(message)).not.toContain('qx-marker');
    });

    it('sends no app message without the user’s consent, or after it is revoked', async () => {
        const user = await makeUser(server());
        const app = await makeApp(server(), user);
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);
        const send = () =>
            server().services.notification.notify(
                [user.id],
                { title: 'hello' },
                { type: 'app.message', appUid: app.uid },
            );

        await send();
        await settle();
        expect(provider.calls).toHaveLength(0);

        await grantPush(server(), user, app.uid);
        await send();
        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));

        await (
            server().services.permission as unknown as PermissionService
        ).revokeUserAppPermission(
            makeActor({ user: user as never }),
            app.uid,
            NOTIFICATIONS_PUSH_PERMISSION,
        );
        await send();
        await settle();
        expect(provider.calls).toHaveLength(1);
    });

    it('sends Puter’s own notification about an app to Puter’s devices, with no grant', async () => {
        const user = await makeUser(server());
        const app = await makeApp(server(), user);
        await registerDevice(server(), user.id, 'tok-puter-dev');
        await registerDevice(server(), user.id, 'tok-app-dev', {
            appUid: app.uid,
        });

        await server().services.notification.notify(
            [user.id],
            { title: 'Successfully deployed https://w.puter.work' },
            { type: 'app.worker.deployed', appUid: app.uid },
        );

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        expect(tokensOf(provider.calls)).toEqual(['tok-puter-dev']);
        expect(provider.calls[0].message.title).toBe(
            'Successfully deployed https://w.puter.work',
        );
    });

    it('follows the user’s Puter preference for Puter’s own notifications', async () => {
        const user = await makeUser(server());
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);
        await server().stores.user.updateMetadata(user.id, {
            [PUTER_PUSH_PREFERENCE_KEY]: false,
        });

        await shareReceived(server(), user.id);
        await settle();
        expect(provider.calls).toHaveLength(0);
    });

    it('never pushes a silent notification', async () => {
        const user = await makeUser(server());
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);

        const uid = await server().services.notification.notify(
            [user.id],
            { title: 'quiet' },
            { type: 'share.received', silent: true },
        );
        await server().services.notification.notifyUpdate(
            uid!,
            user.id,
            { title: 'still quiet' },
            { type: 'share.received', silent: true },
        );
        await settle();
        expect(provider.calls).toHaveLength(0);
    });

    it('pushes an update again under the same group', async () => {
        const user = await makeUser(server());
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);

        const uid = await shareReceived(server(), user.id);
        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));

        const updated = await server().services.notification.notifyUpdate(
            uid!,
            user.id,
            {
                title: 'alice and bob shared 2 items with you',
                fields: {
                    senders: [
                        { username: 'alice', count: 1 },
                        { username: 'bob', count: 1 },
                    ],
                },
            },
            { type: 'share.received' },
        );
        expect(updated).toBe(true);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
        expect(provider.calls[1].message).toMatchObject({
            uid,
            group: provider.calls[0].message.group,
            title: 'alice and bob shared 2 items with you',
            replace: true,
        });
        expect(provider.calls[0].message.replace).toBeUndefined();
    });

    it('pushes to every recipient with devices in a large notify', async () => {
        const users = await Promise.all(
            Array.from({ length: 100 }, () => makeUser(server())),
        );
        const withDevices = [users[3], users[50], users[97]];
        for (const user of withDevices) {
            await registerDevice(server(), user.id, `many-${user.id}`);
        }

        await server().services.notification.notify(
            users.map((user) => user.id),
            { title: 'A subscription ended' },
            { type: 'app.events.ended' },
        );

        await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
        expect(tokensOf(provider.calls)).toEqual(
            withDevices.map((user) => `many-${user.id}`).sort(),
        );
    });

    it('removes unregistered devices, counts failures once, and bumps the rest', async () => {
        const user = await makeUser(server());
        const gone = await registerDevice(
            server(),
            user.id,
            `gone-${uuidv4()}`,
        );
        const bad = await registerDevice(server(), user.id, `bad-${uuidv4()}`);
        const good = await registerDevice(server(), user.id, `ok-${uuidv4()}`);
        await server().clients.db.write(
            'UPDATE `push_device` SET `last_seen_at` = ? WHERE `user_id` = ?',
            [1000, user.id],
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await shareReceived(server(), user.id);

        const devices = server().stores.pushDevice;
        await vi.waitFor(async () => {
            expect(await devices.getByUid(gone.uid)).toBeNull();
            expect(
                (await devices.getByUid(good.uid))!.lastSeenAt,
            ).toBeGreaterThan(1000);
        });
        await settle();
        const failed = await devices.getByUid(bad.uid);
        expect(failed!.failureCount).toBe(1);
        expect(failed!.lastSeenAt).toBe(1000);
        expect(provider.calls).toHaveLength(1);

        const logged = JSON.stringify(warn.mock.calls);
        warn.mockRestore();
        expect(logged).toContain('invalid_token');
        expect(logged).not.toContain('push.example.test');
        expect(logged).not.toMatch(/bad-[0-9a-f]{8}-/);
    });

    it('sends 250 devices on one platform in three calls', async () => {
        const user = await makeUser(server());
        for (let i = 0; i < 250; i++) {
            await registerDevice(server(), user.id, `bulk-${i}-${uuidv4()}`);
        }

        await shareReceived(server(), user.id);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
        await settle();
        expect(provider.calls).toHaveLength(3);
        expect(provider.calls.map((call) => call.tokens.length).sort()).toEqual(
            [100, 100, 50].sort(),
        );
        expect(new Set(tokensOf(provider.calls)).size).toBe(250);
    });

    it('trims a long title to the size budget', async () => {
        const user = await makeUser(server());
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);

        await server().services.notification.notify(
            [user.id],
            { title: `Failed to deploy w! ${'x'.repeat(6000)}` },
            { type: 'app.worker.deployFailed' },
        );

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        const message = provider.calls[0].message;
        expect(
            Buffer.byteLength(JSON.stringify(message), 'utf8'),
        ).toBeLessThanOrEqual(3800);
        expect(message.title.startsWith('Failed to deploy w!')).toBe(true);
    });

    it('skips devices on a platform no provider carries', async () => {
        const user = await makeUser(server());
        await registerDevice(server(), user.id, 'tok-ios', { platform: 'ios' });
        await shareReceived(server(), user.id);
        await settle();
        expect(provider.calls).toHaveLength(0);
    });
});

describe('PushService at the in-flight cap', () => {
    const pending: Array<() => void> = [];
    const provider: PushProvider = {
        platforms: ['web'],
        send: (batch) =>
            new Promise((resolve) => {
                pending.push(() =>
                    resolve(batch.tokens.map(() => ({ status: 'delivered' }))),
                );
            }),
    };
    const state = bootWith({ push: { enabled: true } }, provider as never);

    it('warns once with a count while pushes are skipped', async () => {
        const users = await Promise.all(
            Array.from({ length: 70 }, () => makeUser(state.server)),
        );
        for (const user of users) {
            await registerDevice(state.server, user.id, `cap-${user.id}`);
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (const user of users) {
                await shareReceived(state.server, user.id);
            }
            await vi.waitFor(() => expect(pending).toHaveLength(64));
            await settle();
            const capWarnings = warn.mock.calls.filter((call) =>
                String(call[0]).includes('in-flight cap'),
            );
            expect(capWarnings).toHaveLength(1);
            expect(capWarnings[0][1]).toEqual({ skipped: 1 });
            expect(pending).toHaveLength(64);
        } finally {
            warn.mockRestore();
            for (const release of pending) release();
        }
    });
});

describe('PushService while shutting down', () => {
    const provider = new FakeProvider();
    const state = bootWith({ push: { enabled: true } }, provider);

    it('sends nothing once shutdown has started', async () => {
        const user = await makeUser(state.server);
        await registerDevice(state.server, user.id, `tok-${uuidv4()}`);
        state.server.services.push.onServerPrepareShutdown();
        await shareReceived(state.server, user.id);
        await settle();
        expect(provider.calls).toHaveLength(0);
    });
});

describe('PushService when shutdown starts mid-delivery', () => {
    const provider = new FakeProvider();
    const state = bootWith({ push: { enabled: true } }, provider);

    it('sends nothing once its devices are read', async () => {
        const user = await makeUser(state.server);
        await registerDevice(state.server, user.id, `tok-${uuidv4()}`);
        const store = state.server.stores.pushDevice;
        const original = store.listForDelivery.bind(store);
        const listed = vi
            .spyOn(store, 'listForDelivery')
            .mockImplementation(async (...args) => {
                const devices = await original(...args);
                state.server.services.push.onServerPrepareShutdown();
                return devices;
            });
        await shareReceived(state.server, user.id);
        await vi.waitFor(() => expect(listed).toHaveBeenCalled());
        await settle();
        listed.mockRestore();
        expect(provider.calls).toHaveLength(0);
    });
});

describe('PushService with push off', () => {
    const provider = new FakeProvider();
    const state = bootWith({}, provider);

    it('sends nothing', async () => {
        const user = await makeUser(state.server);
        await registerDevice(state.server, user.id, `tok-${uuidv4()}`);
        const listed = vi.spyOn(
            state.server.stores.pushDevice,
            'listForDelivery',
        );
        await shareReceived(state.server, user.id);
        await settle();
        expect(listed).not.toHaveBeenCalled();
        expect(provider.calls).toHaveLength(0);
    });
});

describe('PushService with no provider', () => {
    const state = bootWith({ push: { enabled: true } });

    it('reads nothing and sends nothing', async () => {
        const user = await makeUser(state.server);
        await registerDevice(state.server, user.id, `tok-${uuidv4()}`);
        const listed = vi.spyOn(
            state.server.stores.pushDevice,
            'listForDelivery',
        );
        await shareReceived(state.server, user.id);
        await settle();
        expect(listed).not.toHaveBeenCalled();
    });
});

describe('PushService with the notification fold-in on', () => {
    const provider = new FakeProvider();
    const state = bootWith(
        {
            push: { enabled: true },
            events: { enabled: true, notificationsFoldIn: true },
        },
        provider,
    );

    it('sends one push per write though both notification events fire', async () => {
        const user = await makeUser(state.server);
        await registerDevice(state.server, user.id, `tok-${uuidv4()}`);
        const created = vi.fn();
        state.server.clients.event.on('notif.created', created);

        await shareReceived(state.server, user.id);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        await settle();
        expect(created).toHaveBeenCalledTimes(1);
        expect(provider.calls).toHaveLength(1);
        state.server.clients.event.off?.('notif.created', created);
    });
});

/** A user who granted push to a fresh app and has one device for it. */
const appPushReady = async (server: PuterServer, user?: TestUser) => {
    const owner = user ?? (await makeUser(server));
    const app = await makeApp(server, owner);
    await grantPush(server, owner, app.uid);
    const token = `tok-${uuidv4()}`;
    await registerDevice(server, owner.id, token, { appUid: app.uid });
    return { user: owner, app, token };
};

const appMessage = (server: PuterServer, userId: number, appUid: string) =>
    server.services.notification.notify(
        [userId],
        { title: 'New reply' },
        { type: 'app.message', appUid },
    );

const limitWarnings = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter((call) =>
        String(call[0]).includes('app push limit'),
    );

describe('PushService app push limit', () => {
    const provider = new FakeProvider();
    const state = bootWith({ push: { enabled: true } }, provider);
    const server = () => state.server;

    beforeEach(() => {
        provider.calls.length = 0;
    });

    it('pushes one app message a minute and still stores the next', async () => {
        const { user, app } = await appPushReady(server());

        await appMessage(server(), user.id, app.uid);
        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        const second = await appMessage(server(), user.id, app.uid);
        await settle();

        expect(provider.calls).toHaveLength(1);
        const stored = await server().stores.notification.getByUid(second!, {
            userId: user.id,
        });
        expect(stored).toBeTruthy();
    });

    it('counts a message that would replace an earlier push', async () => {
        const { user, app } = await appPushReady(server());
        const inGroup = () =>
            server().services.notification.notify(
                [user.id],
                { title: 'New reply', group: 'room-7' },
                { type: 'app.message', appUid: app.uid },
            );

        await inGroup();
        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
        await inGroup();
        await settle();

        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0].message.group).toBe(`${app.uid}:room-7`);
    });

    it('counts each user and each app on its own', async () => {
        const first = await appPushReady(server());
        const otherUser = await makeUser(server());
        await grantPush(server(), otherUser, first.app.uid);
        await registerDevice(server(), otherUser.id, `tok-${uuidv4()}`, {
            appUid: first.app.uid,
        });
        const otherApp = await appPushReady(server(), first.user);

        await appMessage(server(), first.user.id, first.app.uid);
        await appMessage(server(), otherUser.id, first.app.uid);
        await appMessage(server(), first.user.id, otherApp.app.uid);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
        await settle();
        expect(provider.calls).toHaveLength(3);
    });

    it('does not count Puter’s own notifications', async () => {
        const { user, app } = await appPushReady(server());
        await registerDevice(server(), user.id, `tok-${uuidv4()}`);

        await appMessage(server(), user.id, app.uid);
        await shareReceived(server(), user.id);
        await shareReceived(server(), user.id);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
        await settle();
        expect(provider.calls).toHaveLength(3);
    });

    it('spends nothing on a message with no devices', async () => {
        const user = await makeUser(server());
        const app = await makeApp(server(), user);
        await grantPush(server(), user, app.uid);

        await appMessage(server(), user.id, app.uid);
        await settle();
        await registerDevice(server(), user.id, `tok-${uuidv4()}`, {
            appUid: app.uid,
        });
        await appMessage(server(), user.id, app.uid);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    });

    it('spends nothing on a message without consent', async () => {
        const user = await makeUser(server());
        const app = await makeApp(server(), user);
        await registerDevice(server(), user.id, `tok-${uuidv4()}`, {
            appUid: app.uid,
        });

        await appMessage(server(), user.id, app.uid);
        await settle();
        expect(provider.calls).toHaveLength(0);
        await grantPush(server(), user, app.uid);
        await appMessage(server(), user.id, app.uid);

        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    });

    it('spends nothing while the user is connected', async () => {
        const { user, app } = await appPushReady(server());
        const has = vi
            .spyOn(server().services.socket, 'has')
            .mockReturnValue(true);
        await appMessage(server(), user.id, app.uid);
        await settle();
        has.mockRestore();
        expect(provider.calls).toHaveLength(0);

        await appMessage(server(), user.id, app.uid);
        await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    });
});

describe('PushService with no app push limit', () => {
    const provider = new FakeProvider();
    const state = bootWith(
        { push: { enabled: true, appPushesPerMinute: 0 } },
        provider,
    );

    it('pushes every app message', async () => {
        const { user, app } = await appPushReady(state.server);
        for (let i = 0; i < 4; i++) {
            await appMessage(state.server, user.id, app.uid);
        }
        await vi.waitFor(() => expect(provider.calls).toHaveLength(4));
    });
});

describe('PushService with three app pushes a minute', () => {
    const provider = new FakeProvider();
    const state = bootWith(
        { push: { enabled: true, appPushesPerMinute: 3 } },
        provider,
    );

    it('pushes three app messages and skips the fourth', async () => {
        const { user, app } = await appPushReady(state.server);
        for (let i = 0; i < 4; i++) {
            await appMessage(state.server, user.id, app.uid);
            await settle();
        }
        expect(provider.calls).toHaveLength(3);
    });
});

describe('PushService app push limit over time', () => {
    const provider = new FakeProvider();
    const state = bootWith({ push: { enabled: true } }, provider);

    it('pushes again once the minute has passed, and warns once a minute', async () => {
        const { user, app, token } = await appPushReady(state.server);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            for (let i = 0; i < 3; i++) {
                await appMessage(state.server, user.id, app.uid);
                await settle();
            }
            expect(provider.calls).toHaveLength(1);
            expect(limitWarnings(warn)).toHaveLength(1);
            expect(limitWarnings(warn)[0][1]).toEqual({ skipped: 1 });

            vi.setSystemTime(Date.now() + 61_000);
            await appMessage(state.server, user.id, app.uid);
            await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
            await appMessage(state.server, user.id, app.uid);
            await settle();
            expect(provider.calls).toHaveLength(2);

            const warnings = limitWarnings(warn);
            expect(warnings).toHaveLength(2);
            expect(warnings[1][1]).toEqual({ skipped: 2 });
            const logged = JSON.stringify(warnings);
            expect(logged).not.toContain(token);
            expect(logged).not.toContain(app.uid);
        } finally {
            vi.useRealTimers();
            warn.mockRestore();
        }
    });
});
