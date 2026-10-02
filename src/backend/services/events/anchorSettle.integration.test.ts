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
 * A subscription keys on a uid, and deleting the node it keys on is the one
 * thing that takes that uid away for good. What happens next depends on what
 * the subscriber asked for: a path-form subscription follows the path up to
 * whatever still exists and keeps watching, while a node-form one is over,
 * because the node it named is never coming back.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import * as rateLimit from '../../core/http/middleware/rateLimit.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { fsAnchorToken } from './subjects.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let user: { actor: Actor; username: string; id: number };
let home: string;
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;
const fs = () => env.server.services.fs;

const folder = async (path: string): Promise<string> => {
    await fs().mkdir(user.id, { path, createMissingParents: true });
    return path;
};

const entryAt = (path: string) =>
    env.server.stores.fsEntry.getEntryByPath(path);

const removeAt = async (path: string): Promise<void> => {
    const entry = await entryAt(path);
    await fs().remove(user.id, { entry: entry!, recursive: true });
};

const subscribe = async (socketId: string, subject: string) =>
    (await events().subscribe(user.actor, socketId, { subject })).sub;

const held = (socketId: string) =>
    events().listSubscriptions(user.actor, socketId);

const settled = (count = 1) =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

/** Let every window in flight close, then start counting from nothing. */
const drain = async (): Promise<void> => {
    await quiet();
    delivered.length = 0;
};

/** Wait for the settle the removal kicked off in its dispatch pass. */
const anchoredAt = (socketId: string, subId: string, path: string) =>
    vi.waitFor(
        async () => {
            const row = (await held(socketId)).find(
                (sub) => sub.subId === subId,
            );
            expect(row?.anchor.path).toBe(path);
            return row!;
        },
        { timeout: 5_000, interval: 25 },
    );

const gone = (subId: string) =>
    vi.waitFor(
        async () =>
            expect(
                await env.server.stores.durableSubscription.getBySubId(subId),
            ).toBeNull(),
        { timeout: 5_000, interval: 25 },
    );

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account — and a temporary account holds no durable rows.
        // Plans are not what these cases are about.
        unlimitedMetering: true,
    } as IConfig);
    const row = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    user = {
        actor: makeActor({ user: row as never }),
        username: env.users.user.username,
        id: row!.id,
    };
    home = `/${user.username}`;

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('a path-form subscription whose anchor is deleted', () => {
    it('survives the folder it was waiting inside being deleted and recreated', async () => {
        const docs = await folder(`${home}/reanchor-docs`);
        const sub = await subscribe('sock-path', `fs:${docs}/trigger:add`);
        expect(sub.anchor.path).toBe(docs);
        expect(sub.match).toBe('trigger');

        await removeAt(docs);
        const moved = await anchoredAt('sock-path', sub.subId, home);
        // The segments that went lead the pattern now, so it means the same
        // thing measured from further up.
        expect(moved.match).toBe('reanchor-docs/trigger');

        await folder(docs);
        await drain();
        await fs().touch(user.id, { path: `${docs}/trigger` });
        await settled();

        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
    });

    it('climbs another level when the level it moved to is deleted too', async () => {
        const outer = `${home}/reanchor-outer`;
        const inner = await folder(`${outer}/inner`);
        const sub = await subscribe('sock-climb', `fs:${inner}/trigger:add`);
        expect(sub.anchor.path).toBe(inner);

        await removeAt(inner);
        expect(
            (await anchoredAt('sock-climb', sub.subId, outer)).match,
        ).toBe('inner/trigger');

        await removeAt(outer);
        expect((await anchoredAt('sock-climb', sub.subId, home)).match).toBe(
            'reanchor-outer/inner/trigger',
        );

        await folder(inner);
        await drain();
        await fs().touch(user.id, { path: `${inner}/trigger` });
        await settled();

        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
    });

    it('moves a durable row, its cache entry and its stored anchor together', async () => {
        const docs = await folder(`${home}/reanchor-durable`);
        const sub = (
            await events().subscribeDurable(user.actor, {
                subject: `fs:${docs}/**`,
            })
        ).sub;

        await removeAt(docs);
        await vi.waitFor(
            async () => {
                const row =
                    await env.server.stores.durableSubscription.getBySubId(
                        sub.subId,
                    );
                expect(row?.anchorPath).toBe(home);
                expect(row?.match).toBe('reanchor-durable/**');
            },
            { timeout: 5_000, interval: 25 },
        );

        await folder(docs);
        await drain();
        await fs().touch(user.id, { path: `${docs}/after.txt` });
        await settled();

        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
    });

    it('keeps covering a missing folder`s contents after it climbs', async () => {
        const docs = await folder(`${home}/reanchor-inbox`);
        const sub = await subscribe('sock-inbox', `fs:${docs}/inbox`);
        expect(sub.anchor.path).toBe(docs);
        expect(sub.match).toBe('inbox');

        await removeAt(docs);
        const moved = await anchoredAt('sock-inbox', sub.subId, home);
        expect(moved.match).toBe('reanchor-inbox/inbox');

        await folder(`${docs}/inbox`);
        await drain();
        await fs().touch(user.id, { path: `${docs}/inbox/a.txt` });
        await settled();

        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
        expect(delivered[0].event).toMatchObject({
            op: 'add',
            path: `${docs}/inbox/a.txt`,
        });
    });
});

describe('a node-form subscription whose anchor is deleted', () => {
    it('ends, while a path-form sibling on the same node re-anchors', async () => {
        const dir = await folder(`${home}/node-form`);
        const nodeForm = await subscribe('sock-node', `fs:${dir}`);
        const pathForm = await subscribe('sock-node', `fs:${dir}/**`);
        expect(nodeForm.match).toBeNull();
        expect(pathForm.match).toBe('**');

        await removeAt(dir);
        await vi.waitFor(
            async () =>
                expect(
                    (await held('sock-node')).map((row) => row.subId),
                ).toEqual([pathForm.subId]),
            { timeout: 5_000, interval: 25 },
        );

        // The path is back, with a uid the ended subscription never named.
        await folder(dir);
        await drain();
        await fs().touch(user.id, { path: `${dir}/after.txt` });
        await settled();

        expect(delivered.map((d) => d.subId)).toEqual([pathForm.subId]);
    });

    it('is delivered its final removal before it ends', async () => {
        const dir = await folder(`${home}/node-form-final`);
        const sub = await subscribe('sock-final', `fs:${dir}`);
        await drain();

        await removeAt(dir);
        await settled();

        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
        expect(delivered[0].event).toMatchObject({ op: 'remove' });
    });

    it('deletes a durable row, and tells its holder the anchor went', async () => {
        const dir = await folder(`${home}/node-form-durable`);
        const sub = (
            await events().subscribeDurable(user.actor, { subject: `fs:${dir}` })
        ).sub;

        await removeAt(dir);
        await gone(sub.subId);

        const listed = await events().listDurable(user.actor);
        expect(listed.items.map((row) => row.subId)).not.toContain(sub.subId);

        const ended = await vi.waitFor(
            async () => {
                const rows = await env.server.stores.notification.listByUserId(
                    user.id,
                    {},
                );
                const match = rows.find(
                    (row: { type?: string }) => row.type === 'app.events.ended',
                );
                expect(match).toBeDefined();
                return match as { value: unknown };
            },
            { timeout: 5_000, interval: 25 },
        );
        expect(ended.value).toMatchObject({
            subject: `fs:${dir}`,
            reason: 'anchor_deleted',
        });

        // Recreating the path mints a new uid, which nothing is watching.
        await folder(dir);
        await drain();
        await fs().touch(user.id, { path: `${dir}/after.txt` });
        await quiet();
        expect(delivered).toEqual([]);
    });
});

describe('a path-form subscription held over a share', () => {
    it('ends rather than climbing onto a folder its holder cannot see', async () => {
        const guestRow = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        const guest = makeActor({ user: guestRow as never });
        const shared = await folder(`${home}/reanchor-shared`);
        await env.server.services.acl.setUserUser(
            user.actor,
            guest,
            {
                path: shared,
                resolveAncestors: () => fs().getAncestorChain(shared),
            },
            'list',
        );
        const sub = (
            await events().subscribeDurable(guest, {
                subject: `fs:${shared}/**`,
            })
        ).sub;

        // The nearest survivor is the owner's home, which the guest was never
        // allowed to watch; the row ends instead of moving there.
        await removeAt(shared);
        await gone(sub.subId);

        const ended = await vi.waitFor(
            async () => {
                const rows = await env.server.stores.notification.listByUserId(
                    guestRow!.id,
                    {},
                );
                const match = rows.find(
                    (row: { type?: string }) => row.type === 'app.events.ended',
                );
                expect(match).toBeDefined();
                return match as { value: unknown };
            },
            { timeout: 5_000, interval: 25 },
        );
        expect(ended.value).toMatchObject({
            subject: `fs:${shared}/**`,
            reason: 'anchor_deleted',
        });
    });
});

describe('telling the connection it ended', () => {
    let send: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        send = vi.spyOn(env.server.services.socket, 'send');
    });

    afterEach(() => {
        send.mockRestore();
    });

    const endedCallFor = (subId: string) =>
        send.mock.calls.find(
            (call) => call[1] === 'events.ended' && (call[2] as { subId?: string })?.subId === subId,
        );

    const waitForEnded = (subId: string) =>
        vi.waitFor(() => expect(endedCallFor(subId)).toBeDefined(), {
            timeout: 5_000,
            interval: 25,
        });

    it('tells the connection a node-form subscription ended with its anchor', async () => {
        const dir = await folder(`${home}/ended-node`);
        const sub = await subscribe('sock-ended-node', `fs:${dir}`);

        await removeAt(dir);
        await waitForEnded(sub.subId);

        expect(send).toHaveBeenCalledWith({ socket: 'sock-ended-node' }, 'events.ended', {
            subId: sub.subId,
            code: 'subscription_ended',
            reason: 'anchor_deleted',
            message: expect.any(String),
        });
    });

    it('tells it only after the final removal has gone out', async () => {
        const dir = await folder(`${home}/ended-order`);
        const sub = await subscribe('sock-ended-order', `fs:${dir}`);

        await removeAt(dir);
        await waitForEnded(sub.subId);

        const removeIndex = send.mock.calls.findIndex(
            (call) =>
                call[1] === 'events.delivery' &&
                (call[2] as { subId?: string; event?: { op?: string } })?.subId === sub.subId &&
                (call[2] as { event?: { op?: string } })?.event?.op === 'remove',
        );
        const endedIndex = send.mock.calls.indexOf(endedCallFor(sub.subId)!);

        expect(removeIndex).toBeGreaterThanOrEqual(0);
        expect(endedIndex).toBeGreaterThan(removeIndex);
    });

    it('still tells it only after every flush still in flight has gone out', async () => {
        const dir = await folder(`${home}/ended-race`);
        const file = `${dir}/target.txt`;
        const write = (content: string) =>
            fs().write(user.id, {
                fileMetadata: {
                    path: file,
                    size: content.length,
                    contentType: 'text/plain',
                    overwrite: true,
                },
                fileContent: content,
            });

        await write('first');
        // Anchored directly on the file (it already exists), so its removal
        // ends the subscription outright rather than carrying it forward.
        const sub = await subscribe('sock-ended-race', `fs:${file}`);

        // A write, then (almost at once) the remove: two different ops on the
        // same node coalesce under two different keys. Holding the write's
        // rate-limit check open means its key is already gone from the
        // coalescer — its delivery hasn't gone out yet — while the remove's
        // own flush runs all the way through moments later. Without counting
        // flushes still in flight, that looks like nothing is owed any more,
        // and the notice would go out before the write's delivery.
        const checkRateLimit = vi
            .spyOn(rateLimit, 'checkRateLimit')
            .mockImplementationOnce(async (...args) => {
                await new Promise((resolve) => setTimeout(resolve, 400));
                return rateLimit.checkRateLimit(...args);
            });

        try {
            await write('second');
            const entry = await entryAt(file);
            await fs().remove(user.id, { entry: entry! });

            await vi.waitFor(() => expect(endedCallFor(sub.subId)).toBeDefined(), {
                timeout: 5_000,
                interval: 25,
            });

            const endedIndex = send.mock.calls.indexOf(endedCallFor(sub.subId)!);
            const deliveryIndexes = send.mock.calls
                .map((call, index) => ({ call, index }))
                .filter(
                    ({ call }) =>
                        call[1] === 'events.delivery' &&
                        (call[2] as { subId?: string })?.subId === sub.subId,
                )
                .map(({ index }) => index);

            expect(deliveryIndexes.length).toBeGreaterThanOrEqual(2);
            for (const index of deliveryIndexes) expect(endedIndex).toBeGreaterThan(index);
        } finally {
            checkRateLimit.mockRestore();
        }
    });

    it('tells it at once when nothing was owed', async () => {
        const dir = await folder(`${home}/ended-idle`);
        // Filtered to `:write`, so the `remove` this triggers never matches
        // and nothing is coalesced for it — there is nothing to wait on.
        const sub = await subscribe('sock-ended-idle', `fs:${dir}:write`);

        await removeAt(dir);
        // Loose on purpose: this only has to show up well short of a second
        // flush window, not race a tight timer against real I/O.
        await vi.waitFor(() => expect(endedCallFor(sub.subId)).toBeDefined(), {
            timeout: 1000,
            interval: 10,
        });
    });

    it('tells it when climbing would land where its holder cannot see', async () => {
        const guestRow = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        const guest = makeActor({ user: guestRow as never });
        const shared = await folder(`${home}/ended-shared`);
        await env.server.services.acl.setUserUser(
            user.actor,
            guest,
            {
                path: shared,
                resolveAncestors: () => fs().getAncestorChain(shared),
            },
            'list',
        );
        const sub = (
            await events().subscribe(guest, 'sock-ended-shared', {
                subject: `fs:${shared}/**`,
            })
        ).sub;

        await removeAt(shared);
        await waitForEnded(sub.subId);

        expect(endedCallFor(sub.subId)![2]).toMatchObject({
            reason: 'anchor_deleted',
        });
    });

    it('says nothing to a path-form subscription that climbs', async () => {
        const dir = await folder(`${home}/ended-climbs`);
        const sub = await subscribe('sock-ended-climbs', `fs:${dir}/**`);

        await removeAt(dir);
        await anchoredAt('sock-ended-climbs', sub.subId, home);
        await quiet();

        expect(endedCallFor(sub.subId)).toBeUndefined();
    });

    it('tells a connection in this region when a forwarded removal ends it', async () => {
        const dir = await folder(`${home}/ended-forwarded`);
        const sub = await subscribe('sock-ended-forwarded', `fs:${dir}`);
        const entry = await entryAt(dir);
        const ancestors = await fs().getAncestorChain(dir);

        await events().dispatchForwarded({
            kind: 'event',
            family: 'fs',
            ownerUserId: user.id,
            id: randomUUID(),
            ts: Date.now(),
            sessionOnly: true,
            hop: 1,
            fs: {
                key: 'fs.remove.node',
                entry: { uid: entry!.uid, path: entry!.path, userId: entry!.userId },
                ancestors,
            },
        });

        await waitForEnded(sub.subId);
    });

    it('sends nothing after the notice, even from a dispatch that read the row first', async () => {
        const dir = await folder(`${home}/ended-tail`);
        const sub = await subscribe('sock-ended-tail', `fs:${dir}`);
        const dirEntry = await entryAt(dir);
        const anchorToken = fsAnchorToken(dirEntry!.uid);

        let signalReached: () => void;
        const reached = new Promise<void>((resolve) => {
            signalReached = resolve;
        });
        let openGate: () => void;
        const gate = new Promise<void>((resolve) => {
            openGate = resolve;
        });

        const store = env.server.stores.eventSubscription;
        const original = store.getForTokens.bind(store);
        let intercepted = false;
        const getForTokens = vi
            .spyOn(store, 'getForTokens')
            .mockImplementation(async (ownerUserId, tokens) => {
                const isTarget = !intercepted && tokens.includes(anchorToken);
                if (isTarget) intercepted = true;
                const rows = await original(ownerUserId, tokens);
                if (isTarget) {
                    signalReached();
                    await gate;
                }
                return rows;
            });

        try {
            void fs().touch(user.id, { path: `${dir}/x.txt` });
            await reached;

            await removeAt(dir);
            await waitForEnded(sub.subId);
            const endedIndex = send.mock.calls.indexOf(endedCallFor(sub.subId)!);

            openGate!();
            await quiet();

            const deliveryAfterEnded = send.mock.calls
                .slice(endedIndex + 1)
                .filter(
                    (call) =>
                        call[1] === 'events.delivery' &&
                        (call[2] as { subId?: string })?.subId === sub.subId,
                );
            expect(deliveryAfterEnded).toEqual([]);
        } finally {
            getForTokens.mockRestore();
            openGate!();
        }
    });

    it('tells sibling processes which subscription it ended', async () => {
        const dir = await folder(`${home}/ended-siblings`);
        const sub = await subscribe('sock-ended-siblings', `fs:${dir}`);

        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            await removeAt(dir);
            await waitForEnded(sub.subId);

            expect(emit).toHaveBeenCalledWith(
                'outer.pubsub.events.generationBumped',
                expect.objectContaining({ durable: false, ended: [sub.subId] }),
                expect.anything(),
            );
        } finally {
            emit.mockRestore();
        }
    });

    it('says nothing to a holder whose share was revoked before the node went', async () => {
        const guestRow = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        const guest = makeActor({ user: guestRow as never });
        const shared = await folder(`${home}/ended-revoked`);
        await env.server.services.acl.setUserUser(
            user.actor,
            guest,
            {
                path: shared,
                resolveAncestors: () => fs().getAncestorChain(shared),
            },
            'list',
        );
        const sharedEntry = await entryAt(shared);
        const sub = (
            await events().subscribe(guest, 'sock-ended-revoked', {
                subject: `fs:${shared}`,
            })
        ).sub;

        await env.server.services.permission.revokeUserUserPermission(
            user.actor,
            env.users.other.username,
            `fs:${sharedEntry!.uid}:list`,
        );

        await removeAt(shared);
        await vi.waitFor(
            async () =>
                expect(
                    await env.server.stores.eventSubscription.listForSocket(
                        guestRow!.id,
                        'sock-ended-revoked',
                    ),
                ).toEqual([]),
            { timeout: 5_000, interval: 25 },
        );
        await quiet();

        expect(endedCallFor(sub.subId)).toBeUndefined();
    });
});

describe('a climb racing the connection', () => {
    /**
     * Spies on `reanchorSession` so the race call starts the instant the
     * climb is about to move the row, then lets the real move run — whoever
     * reaches the ref first is nondeterministic, but the outcome must not be.
     */
    const raceReanchor = (
        start: () => Promise<unknown>,
    ): { spy: ReturnType<typeof vi.spyOn>; outcome: Promise<unknown> } => {
        const store = env.server.stores.eventSubscription;
        const original = store.reanchorSession.bind(store);
        let raced: Promise<unknown> | null = null;
        const spy = vi
            .spyOn(store, 'reanchorSession')
            .mockImplementationOnce((prev, next) => {
                raced = (async () => {
                    try {
                        return await start();
                    } catch (err) {
                        return err;
                    }
                })();
                return original(prev, next);
            });
        // Dispatch is fire-and-forget, so the climb this races may not have
        // started yet when the caller's own await returns — wait for the
        // mock to actually fire before reading what it raced.
        const outcome = (async () =>
            await vi.waitFor(
                () => {
                    if (!raced) throw new Error('reanchorSession not called yet');
                    return raced;
                },
                { timeout: 5_000, interval: 10 },
            ))();
        return { spy, outcome };
    };

    it('ends a subscription unsubscribed while it climbs', async () => {
        const dir = await folder(`${home}/race-unsub`);
        const socket = 'sock-race-unsub';
        // `/**` rather than a fixed literal: a surviving row has to keep
        // matching after it climbs onto `home`, where the pattern becomes
        // `race-unsub/**`.
        const sub = await subscribe(socket, `fs:${dir}/**`);
        const homeEntry = await entryAt(home);

        const { spy, outcome } = raceReanchor(async () => {
            await events().unsubscribe(user.actor, socket, {
                subId: sub.subId,
            });
            return 'unsubscribed';
        });
        let settled: unknown;
        try {
            await removeAt(dir);
            settled = await outcome;
        } finally {
            spy.mockRestore();
        }

        expect(settled).toBe('unsubscribed');
        await expect(
            env.server.stores.eventSubscription.listForSocket(
                user.id,
                socket,
            ),
        ).resolves.toEqual([]);
        expect(
            await env.server.clients.redis.smembers(
                `ev:s:{${user.id}}:${socket}`,
            ),
        ).toEqual([]);
        const homeRows = await env.server.stores.eventSubscription.getForTokens(
            user.id,
            [fsAnchorToken(homeEntry!.uid)],
        );
        expect(homeRows.some((row) => row.subId === sub.subId)).toBe(false);

        await folder(dir);
        await drain();
        await fs().touch(user.id, { path: `${dir}/after.txt` });
        await quiet();
        expect(delivered.some((d) => d.subId === sub.subId)).toBe(false);
    });

    it('leaves nothing for a socket that disconnects while it climbs', async () => {
        const dir = await folder(`${home}/race-reap`);
        const socket = 'sock-race-reap';
        const sub = await subscribe(socket, `fs:${dir}/**`);
        const homeEntry = await entryAt(home);

        const { spy, outcome } = raceReanchor(() =>
            events().reapSocket(user.id, socket),
        );
        try {
            await removeAt(dir);
            await outcome;
        } finally {
            spy.mockRestore();
        }

        await expect(
            env.server.stores.eventSubscription.listForSocket(
                user.id,
                socket,
            ),
        ).resolves.toEqual([]);
        expect(
            await env.server.clients.redis.smembers(
                `ev:s:{${user.id}}:${socket}`,
            ),
        ).toEqual([]);
        const homeRows = await env.server.stores.eventSubscription.getForTokens(
            user.id,
            [fsAnchorToken(homeEntry!.uid)],
        );
        expect(homeRows.some((row) => row.subId === sub.subId)).toBe(false);

        await folder(dir);
        await drain();
        await fs().touch(user.id, { path: `${dir}/after.txt` });
        await quiet();
        expect(delivered.some((d) => d.subId === sub.subId)).toBe(false);
    });
});
