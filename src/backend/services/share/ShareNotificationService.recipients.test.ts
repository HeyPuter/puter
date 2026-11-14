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
import type { Actor } from '../../core/actor.js';
import { NOTIFY_FANOUT_CAP, type TeamStoreContract } from '../../core/teams.js';
import { PuterServer } from '../../server.js';
import { installSeatStub } from '../../testFixtures/seatStub.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import type { ResolvedShare } from './ShareService.js';

type TestUser = { id: number; username: string; uuid: string };

const makeUserOn = async (server: PuterServer): Promise<TestUser> => {
    const username = `sr${Math.random().toString(36).slice(2, 9)}`;
    await createTestUser(server, { username, password: 'pw-test-1234' });
    const user = await server.stores.user.getByUsername(username);
    if (!user) throw new Error('test user missing');
    return user as TestUser;
};

const actorFor = (user: TestUser, appUid?: string): Actor =>
    ({
        user: { id: user.id, username: user.username, uuid: user.uuid },
        effectiveApp: appUid ? { uid: appUid } : null,
    }) as Actor;

const baseShare = (over: Partial<ResolvedShare>): ResolvedShare =>
    ({
        uid: 'u',
        mode: 'read',
        path: '/somewhere/file.txt',
        entryUid: 'e',
        isDir: false,
        issuer: { username: 'sender' },
        holder: { username: null },
        isNew: true,
        createdAt: null,
        modified: 0,
        size: null,
        ...over,
    }) as ResolvedShare;

describe('ShareNotificationService team shares', () => {
    const GROUP_ID = 4242;
    let server: PuterServer;
    let memberIds: number[] = [];
    let memberReads = 0;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // Teams is optional; only the member list is answered here.
    beforeEach(() => {
        memberIds = [];
        memberReads = 0;
        installSeatStub(server as never, []);
        Object.assign(server.stores.team as TeamStoreContract, {
            listMemberIdsByGroupId: async (groupId: number) => {
                memberReads++;
                return groupId === GROUP_ID ? memberIds : [];
            },
        } satisfies Partial<TeamStoreContract>);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const makeUser = () => makeUserOn(server);
    const teamShare = (over: Partial<ResolvedShare> = {}) =>
        baseShare({ holderGroupId: GROUP_ID, ...over });

    /** Who was told, and about how many items. */
    const captureNotified = () => {
        const told = new Map<number, number>();
        vi.spyOn(server.services.notification, 'notify').mockImplementation(
            async (userIds: number[], payload: Record<string, unknown>) => {
                const fields = payload.fields as { count: number };
                for (const id of userIds) told.set(id, fields.count);
                return 'stub-uid';
            },
        );
        return told;
    };

    it('tells every member but the sender, reading the member list once', async () => {
        const sender = await makeUser();
        const alice = await makeUser();
        const bob = await makeUser();
        memberIds = [sender.id, alice.id, bob.id];
        const told = captureNotified();

        await server.services.shareNotification.notifyShared(actorFor(sender), [
            teamShare(),
            teamShare(),
        ]);

        expect(told).toEqual(
            new Map([
                [alice.id, 2],
                [bob.id, 2],
            ]),
        );
        expect(memberReads).toBe(1);
    });

    it('leaves out a member who blocked the sender, or who refuses all shares', async () => {
        const sender = await makeUser();
        const alice = await makeUser();
        const blocker = await makeUser();
        const closed = await makeUser();
        memberIds = [alice.id, blocker.id, closed.id];
        await server.services.share.blockSender(
            actorFor(blocker),
            sender.username,
        );
        await server.services.share.setBlockAllSenders(actorFor(closed), true);
        const told = captureNotified();

        await server.services.shareNotification.notifyShared(actorFor(sender), [
            teamShare(),
        ]);

        expect([...told.keys()]).toEqual([alice.id]);
    });

    it('tells nobody when the block check cannot be read', async () => {
        const sender = await makeUser();
        const alice = await makeUser();
        memberIds = [alice.id];
        const told = captureNotified();
        vi.spyOn(server.stores.userBlock, 'blockersAmong').mockRejectedValue(
            new Error('store down'),
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await server.services.shareNotification.notifyShared(actorFor(sender), [
            teamShare(),
        ]);

        expect(told.size).toBe(0);
        expect(warn).toHaveBeenCalledWith(
            '[share-notify] block check failed',
            [alice.id],
            expect.any(Error),
        );
    });

    it('still tells direct recipients when a team cannot be expanded', async () => {
        const sender = await makeUser();
        const alice = await makeUser();
        const direct = await makeUser();
        memberIds = [alice.id];
        Object.assign(server.stores.team as TeamStoreContract, {
            listMemberIdsByGroupId: async () => {
                throw new Error('teams down');
            },
        });
        const told = captureNotified();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await server.services.shareNotification.notifyShared(actorFor(sender), [
            teamShare(),
            baseShare({ holderId: direct.id }),
        ]);

        expect([...told.keys()]).toEqual([direct.id]);
        expect(warn).toHaveBeenCalledWith(
            '[share-notify] could not expand team',
            GROUP_ID,
            expect.any(Error),
        );
    });

    it('caps the fan-out of a very large team', async () => {
        const sender = await makeUser();
        // One past the cap, as the store reads; the ids need no accounts.
        memberIds = Array.from(
            { length: NOTIFY_FANOUT_CAP + 1 },
            (_, i) => 9_000_000 + i,
        );
        const told = captureNotified();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await server.services.shareNotification.notifyShared(actorFor(sender), [
            teamShare(),
        ]);

        expect(told.size).toBe(NOTIFY_FANOUT_CAP);
        expect(told.has(memberIds[NOTIFY_FANOUT_CAP])).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[share-notify] team fan-out hit the cap; some members were not told',
            { groupId: GROUP_ID, cap: NOTIFY_FANOUT_CAP },
        );
    });

    it('announces nothing for an invite, or a share with no holder at all', async () => {
        const sender = await makeUser();
        const alice = await makeUser();
        memberIds = [alice.id];
        const told = captureNotified();

        await server.services.shareNotification.notifyShared(actorFor(sender), [
            teamShare({ pending: true } as Partial<ResolvedShare>),
            baseShare({}),
        ]);

        expect(told.size).toBe(0);
        expect(memberReads).toBe(0);
    });
});

describe('ShareNotificationService email to account holders', () => {
    let server: PuterServer;
    let send: ReturnType<typeof vi.fn>;

    type Config = {
        share_email_notifications?: boolean;
        blockedEmailDomains?: string[];
    };
    const config = () =>
        (server.services.shareNotification as unknown as { config: Config })
            .config;

    beforeAll(async () => {
        server = await setupTestServer({
            // A transport must be configured for the service to try at all;
            // nothing reaches it, `send` is replaced below.
            email: {
                from: '"Puter (test)" <no-reply@puter.localhost>',
                host: '127.0.0.1',
                port: 1,
            },
            // No window: the digest goes out with the call that queued it.
            share_notify_limits: { emailBatchSeconds: 0 },
        } as never);
        // The mock redis outlives a server and both suites number users from
        // the same ids, so the first suite's notify budgets would apply here.
        await server.clients.redis.flushall();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    beforeEach(() => {
        send = vi.fn(async () => true);
        vi.spyOn(server.clients.email, 'send').mockImplementation(
            send as never,
        );
        vi.spyOn(server.services.notification, 'notify').mockResolvedValue(
            'stub-uid' as never,
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const makeUser = () => makeUserOn(server);

    /** A recipient with a confirmed address, plus whatever `fields` adds. */
    const makeRecipient = async (fields: Record<string, unknown> = {}) => {
        const user = await makeUser();
        const email = `${user.username}@test.local`;
        await server.stores.user.update(user.id, {
            email,
            clean_email: email,
            email_confirmed: true,
            ...fields,
        });
        return { ...user, email: (fields.email as string) ?? email };
    };

    const shareTo = (holder: TestUser, over: Partial<ResolvedShare> = {}) =>
        baseShare({
            holderId: holder.id,
            holder: { username: holder.username },
            ...over,
        } as Partial<ResolvedShare>);

    const notify = (sender: Actor, shares: ResolvedShare[]) =>
        server.services.shareNotification.notifyShared(sender, shares);

    const queuedFor = async (holderId: number) => {
        const { res } = await server.stores.kv.list({
            as: 'keys',
            pattern: `share:digest:user:${holderId}:`,
            limit: 10,
        });
        return (
            Array.isArray(res) ? res : ((res as { items?: unknown[] })?.items ?? [])
        ).length;
    };

    it('sends at once when there is no batch window', async () => {
        const sender = await makeUser();
        const recipient = await makeRecipient();

        await notify(actorFor(sender), [
            shareTo(recipient, { name: 'report.txt', entryUid: 'e-1' }),
        ]);

        expect(send).toHaveBeenCalledTimes(1);
        const [to, template, params, opts] = send.mock.calls[0];
        expect(to).toBe(recipient.email);
        expect(template).toBe('file_shared_with_you');
        expect(params).toMatchObject({
            recipient: recipient.username,
            unsubscribe_uuid: recipient.uuid,
            shares: [
                expect.objectContaining({
                    sender: sender.username,
                    what: 'report.txt',
                }),
            ],
        });
        expect(opts).toEqual({ stream: 'notify' });
        expect(await queuedFor(recipient.id)).toBe(0);
    });

    it.each([
        ['has no confirmed address', { email_confirmed: false }],
        ['has unsubscribed', { unsubscribed: true }],
    ])('sends nothing to a recipient who %s', async (_why, fields) => {
        const sender = await makeUser();
        const recipient = await makeRecipient(fields);

        await notify(actorFor(sender), [shareTo(recipient)]);

        expect(send).not.toHaveBeenCalled();
        expect(await queuedFor(recipient.id)).toBe(0);
    });

    it('sends nothing to an address on a blocked domain', async () => {
        const sender = await makeUser();
        const recipient = await makeRecipient();
        const original = config().blockedEmailDomains;
        config().blockedEmailDomains = ['test.local'];
        try {
            await notify(actorFor(sender), [shareTo(recipient)]);
        } finally {
            config().blockedEmailDomains = original;
        }
        expect(send).not.toHaveBeenCalled();
    });

    it('sends nothing when share email is switched off', async () => {
        const sender = await makeUser();
        const recipient = await makeRecipient();
        const original = config().share_email_notifications;
        config().share_email_notifications = false;
        try {
            await notify(actorFor(sender), [shareTo(recipient)]);
        } finally {
            config().share_email_notifications = original;
        }
        expect(send).not.toHaveBeenCalled();
    });

    it('keeps the entry queued when the transport fails, and sends it with the next share', async () => {
        const first = await makeUser();
        const second = await makeUser();
        const recipient = await makeRecipient();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        send.mockRejectedValueOnce(new Error('smtp refused'));

        await notify(actorFor(first), [shareTo(recipient)]);

        expect(warn).toHaveBeenCalledWith(
            '[share-notify] digest email failed:',
            expect.any(Error),
        );
        expect(await queuedFor(recipient.id)).toBe(1);

        await notify(actorFor(second), [shareTo(recipient)]);

        expect(send).toHaveBeenCalledTimes(2);
        const params = send.mock.calls[1][2] as {
            shares: Array<{ sender: string }>;
        };
        expect(params.shares.map((line) => line.sender)).toEqual([
            first.username,
            second.username,
        ]);
        expect(await queuedFor(recipient.id)).toBe(0);
    });

    describe('issuing app', () => {
        const viaOf = async (appUid: string) => {
            const sender = await makeUser();
            const recipient = await makeRecipient();
            await notify(actorFor(sender, appUid), [
                shareTo(recipient, {
                    name: 'report.txt',
                    entryUid: 'e-1',
                    owner: { username: sender.username },
                } as Partial<ResolvedShare>),
            ]);
            expect(send).toHaveBeenCalledTimes(1);
            const params = send.mock.calls[0][2] as {
                link: string;
                shares: Array<{ via?: string }>;
            };
            return {
                via: params.shares[0].via,
                linkApp: new URL(params.link).searchParams.get('shared_app'),
            };
        };

        const makeApp = async (fields: Record<string, unknown>) => {
            const owner = await makeUser();
            const name = `sr-app-${Math.random().toString(36).slice(2, 9)}`;
            return (await server.stores.app.create(
                {
                    name,
                    title: 'Draw',
                    index_url: `https://${name}.example.com/v2/`,
                    ...fields,
                },
                { ownerUserId: owner.id },
            )) as { uid: string; name: string };
        };

        it('names the app by its title and links by its name', async () => {
            const app = await makeApp({});
            expect(await viaOf(app.uid)).toEqual({
                via: 'Draw',
                linkApp: app.name,
            });
        });

        it('still sends, unnamed, for an app it cannot find', async () => {
            const uid = `app-${crypto.randomUUID()}`;
            expect(await viaOf(uid)).toEqual({ via: undefined, linkApp: uid });
        });

        it('still sends, unnamed, when the app lookup fails', async () => {
            const app = await makeApp({});
            vi.spyOn(server.stores.app, 'getByUid').mockRejectedValue(
                new Error('store down'),
            );
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(await viaOf(app.uid)).toEqual({
                via: undefined,
                linkApp: app.uid,
            });
            expect(warn).toHaveBeenCalledWith(
                '[share-notify] could not resolve issuing app:',
                expect.any(Error),
            );
        });
    });
});
