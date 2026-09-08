/**
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

describe('credit-state transitions', () => {
    let server: PuterServer;
    let service: PuterServer['services']['team'];
    let owner: { id: number };

    /** Resolved per seat: a seat is on the common tier like any account. */
    const allowanceOf = async (actor: Actor) =>
        (await server.services.metering.getActorSubscription(actor))
            .monthUsageAllowance;

    /** Credit-state events seen since the last reset. */
    const states: Array<{ state: string; user_uuid: string }> = [];

    const makeUser = async () => {
        const username = `cr_${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id, username };
    };

    const freeHandle = () => `cw-${Math.random().toString(36).slice(2, 10)}`;

    /**
     * A team with its own owner and one real provisioned seat. The owner
     * is per-test so mail is attributable: these handlers run detached, and a
     * shared recipient would let a late send land in the next test's tally.
     */
    const makeSeat = async () => {
        const owner = await makeUser();
        const team = await service.createTeam(owner.id, {
            name: 'Credit Co',
            handle: freeHandle(),
        });
        const username = `seat_${Math.random().toString(36).slice(2, 10)}`;
        const created = await service.provisionAccount(team.uid, owner.id, {
            username,
            email: `${username}@test.local`,
        });
        const user = await server.stores.user.getById(created.userId);
        const ownerRow = await server.stores.user.getById(owner.id);
        return {
            team,
            user: user!,
            owner: ownerRow!,
            actor: { user } as unknown as Actor,
        };
    };

    /** Spend `fraction` of the seat's own monthly allowance. */
    const spend = async (actor: Actor, fraction: number) =>
        server.services.metering.incrementUsage(
            actor,
            'kv:read',
            1,
            Math.floor((await allowanceOf(actor)) * fraction),
        );

    /** Forget what this process has announced, as a second node would not know. */
    const asAnotherNode = (uuid: string) => {
        (
            server.services.metering as unknown as {
                creditAlertState: Map<string, string>;
            }
        ).creditAlertState.delete(uuid);
    };

    beforeAll(async () => {
        // The cap has its own suite; these tests need many teams.
        server = await setupTestServer({
            teams_enabled: true,
            max_teams_per_user: 100,
        } as never);
        service = server.services.team;
        owner = await makeUser();

        server.clients.event.on('metering.credit-state', ((
            _k: string,
            d: { state: string; user_uuid: string },
        ) => {
            states.push(d);
        }) as never);

    });

    beforeEach(() => {
        states.length = 0;
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await server?.shutdown();
    });

    // -- the transition signal ----------------------------------------

    it('announces near-limit when the member passes 90%', async () => {
        const { actor, user } = await makeSeat();
        states.length = 0;

        await spend(actor, 0.95);

        const mine = states.filter((s) => s.user_uuid === user.uuid);
        expect(mine.map((s) => s.state)).toEqual(['near-limit']);
    });

    it('does not warn a member whose purchased credits carry them past the allowance', async () => {
        const { actor, user } = await makeSeat();
        const allowance = await allowanceOf(actor);
        await server.services.metering.updateAddonCredit(user.uuid, allowance);
        states.length = 0;

        await spend(actor, 0.95);

        expect(states.filter((s) => s.user_uuid === user.uuid)).toHaveLength(0);
    });

    it('says nothing while the member is comfortably inside the allowance', async () => {
        const { actor, user } = await makeSeat();
        states.length = 0;

        await spend(actor, 0.5);

        expect(states.filter((s) => s.user_uuid === user.uuid)).toHaveLength(0);
    });

    it('announces exhausted once, however many times the member retries', async () => {
        const { actor, user } = await makeSeat();
        await spend(actor, 1);
        states.length = 0;

        // Increments, not cached reads: a cache hit never recomputes the
        // state, so a read loop would pass this test without exercising it.
        for (let i = 0; i < 50; i++) {
            await spend(actor, 0.01);
        }

        expect(states.filter((s) => s.user_uuid === user.uuid)).toHaveLength(0);
    });

    it('crosses both lines in order, one announcement each', async () => {
        const { actor, user } = await makeSeat();
        states.length = 0;

        await spend(actor, 0.95);
        await spend(actor, 0.1);

        const mine = states.filter((s) => s.user_uuid === user.uuid);
        expect(mine.map((s) => s.state)).toEqual(['near-limit', 'exhausted']);
    });

});
