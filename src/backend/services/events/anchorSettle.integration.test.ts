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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { DeliveryEnvelope } from './EventsService.js';

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
