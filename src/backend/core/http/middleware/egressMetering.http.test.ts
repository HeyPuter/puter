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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../actor';
import { PERIOD_ESCAPE } from '../../../services/metering/consts.js';
import type { UsageByType } from '../../../services/metering/types';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../testUtil.js';

/**
 * Egress metering over real HTTP. The unit tests drive the middleware with a
 * response double; only a listening server proves the byte counter survives the
 * middleware stack it is installed under (compression included) and that the
 * actor is resolvable by the time the response closes.
 */
describe('egress metering over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const escape = (usageType: string) =>
        usageType.replace(/\./g, PERIOD_ESCAPE);

    const usageFor = async (actor: Actor): Promise<UsageByType> => {
        await env.server.services.metering.flushBufferedUsages();
        const { usage } =
            await env.server.services.metering.getActorCurrentMonthUsageDetails(
                actor,
            );
        return usage;
    };

    const actorFor = async (username: string): Promise<Actor> => {
        const user = await env.server.stores.user.getByUsername(username);
        return { user: user! } as Actor;
    };

    it('bills a file read to the reader, bytes and object-store request alike', async () => {
        const { username, token } = env.users.user;
        const actor = await actorFor(username);

        const body = Buffer.from('x'.repeat(4096));
        await env.server.services.fs.write(actor.user.id!, {
            fileMetadata: {
                path: `/${username}/Desktop/egress.txt`,
                size: body.byteLength,
                contentType: 'text/plain',
            },
            fileContent: body,
        });

        const before = await usageFor(actor);
        const beforeEgress =
            (before[escape('egress:bytes')] as { units?: number } | undefined)
                ?.units ?? 0;

        const readUrl = new URL('/fs/read', env.apiOrigin);
        readUrl.searchParams.set('path', `/${username}/Desktop/egress.txt`);
        const read = await fetch(readUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(read.status).toBe(200);
        expect(await read.text()).toHaveLength(body.byteLength);

        const after = await usageFor(actor);
        const egress = after[escape('egress:bytes')] as {
            units: number;
            cost: number;
        };
        // Compression may shrink the payload on the wire, so the floor is the
        // headers rather than the file — what matters is that the read was
        // counted at all, and that it cost something.
        expect(egress.units).toBeGreaterThan(beforeEgress);
        expect(egress.cost).toBeGreaterThan(0);

        const reads = after[escape('storage:read:ops')] as {
            units: number;
        };
        expect(reads.units).toBeGreaterThanOrEqual(1);
    });

    it('bills a signed-URL read to the account whose file it is', async () => {
        const { username, token } = env.users.other;
        const actor = await actorFor(username);

        const body = Buffer.from('y'.repeat(4096));
        const path = `/${username}/Desktop/signed-egress.txt`;
        await env.server.services.fs.write(actor.user.id!, {
            fileMetadata: {
                path,
                size: body.byteLength,
                contentType: 'text/plain',
            },
            fileContent: body,
        });

        const signed = await fetch(new URL('/sign', env.apiOrigin), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ items: [{ path, action: 'read' }] }),
        });
        expect(signed.status).toBe(200);
        const readUrl = new URL(
            (await signed.json()).signatures[0].read_url as string,
        );

        const before = await usageFor(actor);
        const beforeEgress =
            (before[escape('egress:bytes')] as { units?: number } | undefined)
                ?.units ?? 0;

        // A signature proves access to the file, not who is asking — so this
        // fetch carries no credential, and the owner is the only account there
        // is to bill.
        const fetched = await fetch(
            new URL(`${readUrl.pathname}${readUrl.search}`, env.apiOrigin),
        );
        expect(fetched.status).toBe(200);
        expect(await fetched.text()).toHaveLength(body.byteLength);

        const after = await usageFor(actor);
        const egress = after[escape('egress:bytes')] as {
            units: number;
            cost: number;
        };
        expect(egress.units).toBeGreaterThan(beforeEgress);
        expect(egress.cost).toBeGreaterThan(0);
    });

    it('leaves root-origin asset traffic out of the actor’s usage', async () => {
        const { username, token } = env.users.user;
        const actor = await actorFor(username);

        const before = await usageFor(actor);
        const beforeEgress =
            (before[escape('egress:bytes')] as { units?: number } | undefined)
                ?.units ?? 0;

        const sdk = await fetch(new URL('/puter.js/v2', env.origin), {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(sdk.status).toBe(200);
        expect((await sdk.text()).length).toBeGreaterThan(1000);

        const after = await usageFor(actor);
        const afterEgress =
            (after[escape('egress:bytes')] as { units?: number } | undefined)
                ?.units ?? 0;
        expect(afterEgress).toBe(beforeEgress);
    });
});
