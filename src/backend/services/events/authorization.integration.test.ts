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
 * Subscribing, and staying subscribed, against real grants.
 *
 * The unit tests treat access as data; these stage actual shares, so they are
 * what shows that a subscription on someone else's folder can be made at all,
 * that the row is found from the owner's side when that owner writes, and that
 * taking the share away stops the delivery rather than the write.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type { AclMode } from '../acl/ACLService.js';
import type { DeliveryEnvelope } from './EventsService.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let owner: { actor: Actor; username: string; token: string; id: number };
let guest: { actor: Actor; username: string; token: string; id: number };
let delivered: DeliveryEnvelope[];

const events = () => env.server.services.events;
const fs = () => env.server.services.fs;

const descriptor = (path: string) => ({
    path,
    resolveAncestors: () => fs().getAncestorChain(path),
});

const share = async (path: string, mode: AclMode): Promise<void> => {
    await env.server.services.acl.setUserUser(
        owner.actor,
        guest.actor,
        descriptor(path),
        mode,
    );
};

const unshare = async (path: string, mode: AclMode): Promise<void> => {
    const entry = await env.server.stores.fsEntry.getEntryByPath(path);
    await env.server.services.permission.revokeUserUserPermission(
        owner.actor,
        guest.username,
        `fs:${entry!.uid}:${mode}`,
    );
};

const folder = async (path: string): Promise<string> => {
    await fs().mkdir(owner.id, { path, createMissingParents: true });
    return path;
};

/** A write by the owner, through the route a client actually calls. */
const mkdirAsOwner = async (path: string): Promise<void> => {
    const response = await fetch(new URL('/mkdir', env.apiOrigin), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${owner.token}`,
        },
        body: JSON.stringify({ path, create_missing_parents: true }),
    });
    expect(response.status).toBe(200);
};

const subscribeAs = async (
    who: { actor: Actor },
    socketId: string,
    subject: string,
) => (await events().subscribe(who.actor, socketId, { subject })).sub;

const settle = (count = 1) =>
    vi.waitFor(() => expect(delivered.length).toBeGreaterThanOrEqual(count), {
        timeout: EVENTS_COALESCE_WINDOW_MS * 12,
        interval: 25,
    });

const quiet = () =>
    new Promise((resolve) =>
        setTimeout(resolve, EVENTS_COALESCE_WINDOW_MS * 3),
    );

const uniquePath = (base: string) =>
    `${base}/n-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);

    const ownerRow = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    const guestRow = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    owner = {
        actor: makeActor({ user: ownerRow as never }),
        username: env.users.user.username,
        token: env.users.user.token,
        id: ownerRow!.id,
    };
    guest = {
        actor: makeActor({ user: guestRow as never }),
        username: env.users.other.username,
        token: env.users.other.token,
        id: guestRow!.id,
    };

    delivered = [];
    events().onDelivered = (envelope) => delivered.push(envelope);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('who may subscribe', () => {
    it('lets a guest subscribe to a folder shared with them', async () => {
        const path = await folder(`/${owner.username}/shared-listable`);
        await share(path, 'list');

        const sub = await subscribeAs(guest, 'guest-a', `fs:${path}`);

        expect(sub.anchor.path).toBe(path);
    });

    it('answers a folder that was never shared as absent', async () => {
        const path = await folder(`/${owner.username}/never-shared`);

        await expect(
            subscribeAs(guest, 'guest-b', `fs:${path}`),
        ).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 404 &&
                err.legacyCode === 'subject_does_not_exist',
        );
    });

    it('refuses a folder the guest can see but not list', async () => {
        const path = await folder(`/${owner.username}/shared-visible`);
        await share(path, 'see');

        await expect(
            subscribeAs(guest, 'guest-c', `fs:${path}`),
        ).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 403 &&
                err.legacyCode === 'forbidden',
        );
    });

    it('will not let a filter buy reach the anchor check refuses', async () => {
        const shared = await folder(`/${owner.username}/reach-shared`);
        await folder(`/${owner.username}/reach-private`);
        await share(shared, 'list');

        await expect(
            subscribeAs(
                guest,
                'guest-d',
                `fs:/${owner.username}/reach-private/**`,
            ),
        ).rejects.toSatisfy(
            (err: unknown) => isHttpError(err) && err.statusCode === 404,
        );
    });
});

describe('delivering across an account boundary', () => {
    it('finds the guest`s row from the owner`s write', async () => {
        const path = await folder(`/${owner.username}/shared-writes`);
        await share(path, 'list');
        const theirs = await subscribeAs(guest, 'guest-e', `fs:${path}`);
        const mine = await subscribeAs(owner, 'owner-e', `fs:${path}`);
        delivered.length = 0;

        await mkdirAsOwner(uniquePath(path));
        await settle(2);

        const byId = new Map(delivered.map((d) => [d.subId, d.event]));
        // The guest hears an event about someone else's write; the owner
        // hears their own.
        expect(byId.get(theirs.subId)).toMatchObject({ self: false });
        expect(byId.get(mine.subId)).toMatchObject({ self: true });
    });

    it('stops delivering the moment the share is revoked', async () => {
        const path = await folder(`/${owner.username}/shared-revoked`);
        await share(path, 'list');
        await subscribeAs(guest, 'guest-f', `fs:${path}`);

        await unshare(path, 'list');
        delivered.length = 0;
        await mkdirAsOwner(uniquePath(path));
        await quiet();

        // The row is still registered; it just no longer authorizes anything.
        expect(delivered).toEqual([]);
    });

    it('delivers only from the part of the anchor the guest can still list', async () => {
        const shared = await folder(`/${owner.username}/narrowed`);
        const allowed = await folder(`${shared}/allowed`);
        const closed = await folder(`${shared}/closed`);
        await share(shared, 'list');
        const sub = await subscribeAs(guest, 'guest-g', `fs:${shared}/**`);

        // The share narrows to one subfolder: the subscription's anchor is no
        // longer listable, and the filter still spans both.
        await share(allowed, 'list');
        await unshare(shared, 'list');
        delivered.length = 0;

        await mkdirAsOwner(uniquePath(closed));
        await quiet();
        expect(delivered).toEqual([]);

        await mkdirAsOwner(uniquePath(allowed));
        await settle();
        expect(delivered.map((d) => d.subId)).toEqual([sub.subId]);
    });
});
