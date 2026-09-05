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
 * The hook against the real write path. The unit tests drive `dispatchFs`
 * directly; this pins the two things that only the wiring can get wrong —
 * whether the emit sites reach it at all, and whether a dispatcher that blows
 * up can take a user's write down with it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from './EventsService.js';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';

const BOOT_TIMEOUT_MS = 120_000;
const SOCKET_ID = 'integration-socket';

let env: PuterTestEnv;
let actor: Actor;
let userId: number;
let username: string;
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;
const fs = () => env.server.services.fs;

// The coalesce window runs on real time, so a delivery from one test can land
// after the next has begun. Waits name what they wait for, and assertions look
// only at their own folder.
const pathOf = (envelope: DeliveryEnvelope): string =>
    (envelope.event as { path?: string }).path ?? '';
const deliveredUnder = (folder: string) =>
    delivered.filter((envelope) => pathOf(envelope).startsWith(`${folder}/`));
const settle = (predicate: (envelope: DeliveryEnvelope) => boolean) =>
    vi.waitFor(() => expect(delivered.some(predicate)).toBe(true), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 8,
        interval: 25,
    });

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
    } as IConfig);
    username = env.users.user.username;
    const user = await env.server.stores.user.getByUsername(username);
    userId = user!.id;
    actor = makeActor({ user: user as never });

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

const subscribeTo = async (subject: string) => {
    const { sub } = await events().subscribe(actor, SOCKET_ID, { subject });
    return sub;
};

describe('the write path reaches subscribers', () => {
    it('delivers a create under a watched folder', async () => {
        const folder = `/${username}/watch-create`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        const sub = await subscribeTo(`fs:${folder}`);

        const made = `${folder}/made.txt`;
        await fs().touch(userId, { path: made });
        await settle((d) => pathOf(d) === made);

        const mine = deliveredUnder(folder);
        expect(mine).toHaveLength(1);
        expect(mine[0].subId).toBe(sub.subId);
        expect(mine[0].event).toMatchObject({ op: 'add', path: made });
    });

    it('delivers a rename and a remove on the same subscription', async () => {
        const folder = `/${username}/watch-lifecycle`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        await subscribeTo(`fs:${folder}`);
        const file = await fs().touch(userId, { path: `${folder}/before.txt` });
        await settle((d) => pathOf(d) === `${folder}/before.txt`);

        const inFolder = (op: string) => (d: DeliveryEnvelope) =>
            d.event.op === op && pathOf(d).startsWith(`${folder}/`);

        const renamed = await fs().rename(userId, file, 'after.txt');
        await settle(inFolder('move'));

        await fs().remove(userId, { entry: renamed });
        await settle(inFolder('remove'));
    });

    it('addresses the delivery at the socket that subscribed', async () => {
        const folder = `/${username}/watch-socket`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        await subscribeTo(`fs:${folder}`);
        const send = vi.spyOn(env.server.services.socket, 'send');

        const addressed = `${folder}/addressed.txt`;
        await fs().touch(userId, { path: addressed });
        await settle((d) => pathOf(d) === addressed);

        expect(send).toHaveBeenCalledWith(
            { socket: SOCKET_ID },
            'events.delivery',
            expect.objectContaining({ subId: expect.any(String) }),
        );
        send.mockRestore();
    });

    it('leaves an unwatched folder alone', async () => {
        const folder = `/${username}/watch-nothing`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });

        await fs().touch(userId, { path: `${folder}/ignored.txt` });
        await new Promise((resolve) =>
            setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 2),
        );

        expect(deliveredUnder(folder)).toEqual([]);
    });
});

describe('the writer never pays for the subscriber', () => {
    it('completes the write when the dispatcher throws', async () => {
        const folder = `/${username}/watch-throws`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        const dispatch = vi
            .spyOn(events(), 'dispatchFs')
            .mockImplementation(() => {
                throw new Error('dispatcher is down');
            });

        try {
            const created = await fs().touch(userId, {
                path: `${folder}/still-written.txt`,
            });
            expect(created.path).toBe(`${folder}/still-written.txt`);
            await expect(
                env.server.stores.fsEntry.getEntryByPath(created.path),
            ).resolves.toMatchObject({ uuid: created.uuid });
        } finally {
            dispatch.mockRestore();
        }
    });

    it('completes the write when the dispatcher rejects', async () => {
        const folder = `/${username}/watch-rejects`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        const dispatch = vi
            .spyOn(events(), 'dispatchFs')
            .mockRejectedValue(new Error('dispatcher is down'));

        try {
            await expect(
                fs().touch(userId, { path: `${folder}/also-written.txt` }),
            ).resolves.toMatchObject({
                path: `${folder}/also-written.txt`,
            });
        } finally {
            dispatch.mockRestore();
        }
    });
});

describe('unsubscribing and disconnecting', () => {
    it('stops delivering once the subscription is gone', async () => {
        const folder = `/${username}/watch-unsubscribe`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        const sub = await subscribeTo(`fs:${folder}`);

        await events().unsubscribe(actor, SOCKET_ID, { subId: sub.subId });
        await fs().touch(userId, { path: `${folder}/after.txt` });
        await new Promise((resolve) =>
            setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 2),
        );

        expect(deliveredUnder(folder)).toEqual([]);
    });

    it('leaves no watched token behind when the socket goes', async () => {
        const folder = `/${username}/watch-disconnect`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        const anchor = await env.server.stores.fsEntry.getEntryByPath(folder);
        await events().subscribe(actor, 'doomed-socket', {
            subject: `fs:${folder}`,
        });

        await events().reapSocket(userId, 'doomed-socket');

        await expect(
            env.server.stores.eventSubscription.watchedTokens(userId, [
                `f#${anchor!.uid}`,
            ]),
        ).resolves.toEqual([]);
    });
});

describe('a moved or renamed anchor', () => {
    it('keeps delivering to a glob subscription after the anchor is renamed', async () => {
        const folder = `/${username}/watch-rename-anchor`;
        await fs().mkdir(userId, { path: folder, createMissingParents: true });
        const anchor = await env.server.stores.fsEntry.getEntryByPath(folder);
        await subscribeTo(`fs:${folder}/*.txt`);

        const renamed = await fs().rename(userId, anchor!, 'renamed-anchor');
        const made = `${renamed.path}/note.txt`;
        await fs().touch(userId, { path: made });
        await settle((d) => pathOf(d) === made);

        expect(deliveredUnder(renamed.path)).toHaveLength(1);
    });

    it('keeps delivering to a glob subscription after the anchor is moved', async () => {
        const src = `/${username}/watch-move-anchor-src`;
        const dstParent = `/${username}/watch-move-anchor-dst`;
        await fs().mkdir(userId, { path: src, createMissingParents: true });
        await fs().mkdir(userId, {
            path: dstParent,
            createMissingParents: true,
        });
        const anchor = await env.server.stores.fsEntry.getEntryByPath(src);
        const destinationParent =
            await env.server.stores.fsEntry.getEntryByPath(dstParent);
        await subscribeTo(`fs:${src}/*.txt`);

        const moved = await fs().move(userId, {
            source: anchor!,
            destinationParent: destinationParent!,
        });
        const made = `${moved.path}/note.txt`;
        await fs().touch(userId, { path: made });
        await settle((d) => pathOf(d) === made);

        expect(deliveredUnder(moved.path)).toHaveLength(1);
    });
});

describe('a move out of a watched folder', () => {
    it('tells the folder a node left, not only the one it landed in', async () => {
        const from = `/${username}/watch-move-out-from`;
        const to = `/${username}/watch-move-out-to`;
        await fs().mkdir(userId, { path: from, createMissingParents: true });
        await fs().mkdir(userId, { path: to, createMissingParents: true });
        await subscribeTo(`fs:${from}`);

        const file = await fs().touch(userId, {
            path: `${from}/leaving.txt`,
        });
        await settle((d) => pathOf(d) === `${from}/leaving.txt`);

        const destinationParent =
            await env.server.stores.fsEntry.getEntryByPath(to);
        const moved = await fs().move(userId, {
            source: file,
            destinationParent: destinationParent!,
        });

        const leftFrom = (d: DeliveryEnvelope) =>
            d.event.op === 'move' &&
            (d.event as { from?: string }).from === file.path;
        await settle(leftFrom);

        expect(delivered.find(leftFrom)?.event).toMatchObject({
            path: moved.path,
            from: file.path,
        });
    });

    it('tells a filtered subscription on the folder too', async () => {
        const from = `/${username}/watch-move-out-glob-from`;
        const to = `/${username}/watch-move-out-glob-to`;
        await fs().mkdir(userId, { path: from, createMissingParents: true });
        await fs().mkdir(userId, { path: to, createMissingParents: true });
        const sub = await subscribeTo(`fs:${from}/*.txt`);

        const file = await fs().touch(userId, { path: `${from}/note.txt` });
        await settle((d) => pathOf(d) === `${from}/note.txt`);

        const destinationParent =
            await env.server.stores.fsEntry.getEntryByPath(to);
        await fs().move(userId, {
            source: file,
            destinationParent: destinationParent!,
        });

        // The glob is written against the folder the node left, so the new
        // path can never satisfy it — the old one is the only scope that can.
        const leftFrom = (d: DeliveryEnvelope) =>
            d.subId === sub.subId &&
            (d.event as { from?: string }).from === file.path;
        await settle(leftFrom);
    });

    it('does not tell the folder it landed in where it came from', async () => {
        const from = `/${username}/watch-move-in-unwatched`;
        const to = `/${username}/watch-move-in-to`;
        await fs().mkdir(userId, { path: from, createMissingParents: true });
        await fs().mkdir(userId, { path: to, createMissingParents: true });
        const sub = await subscribeTo(`fs:${to}`);

        const file = await fs().touch(userId, { path: `${from}/arriving.txt` });
        const destinationParent =
            await env.server.stores.fsEntry.getEntryByPath(to);
        const moved = await fs().move(userId, {
            source: file,
            destinationParent: destinationParent!,
        });

        const arrived = (d: DeliveryEnvelope) =>
            d.subId === sub.subId && pathOf(d) === moved.path;
        await settle(arrived);

        expect(delivered.find(arrived)?.event).not.toHaveProperty('from');
    });
});
