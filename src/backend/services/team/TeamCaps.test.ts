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

import { readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

describe('team and seat caps', () => {
    let server: PuterServer;
    let service: PuterServer['services']['team'];

    /** Small enough to reach; the shipped default is 50. */
    const SEAT_CAP = 3;

    const makeUser = async () => {
        const username = `cap_${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id, username };
    };

    const freeHandle = () => `cp-${Math.random().toString(36).slice(2, 10)}`;

    const makeTeam = (ownerId: number) =>
        service.createTeam(ownerId, {
            name: 'Capped Co',
            handle: freeHandle(),
        });

    const provision = (teamUid: string, ownerId: number) => {
        const username = `st_${Math.random().toString(36).slice(2, 10)}`;
        return service.provisionAccount(teamUid, ownerId, {
            username,
            email: `${username}@test.local`,
        });
    };

    beforeAll(async () => {
        // The shipped team default, and a reachable seat limit.
        server = await setupTestServer({
            teams_enabled: true,
            max_seats_per_team: SEAT_CAP,
        } as never);
        service = server.services.team;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- teams per user ------------------------------------------

    it('allows one team and refuses the second', async () => {
        const owner = await makeUser();
        await makeTeam(owner.id);

        await expect(makeTeam(owner.id)).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'team_limit_reached',
        });
    });

    it('holds the team cap against concurrent creates', async () => {
        const owner = await makeUser();

        // Counting then inserting without serializing lets every one of these
        // read a count below the cap and all succeed.
        const results = await Promise.allSettled(
            Array.from({ length: 5 }, () => makeTeam(owner.id)),
        );

        expect(
            results.filter((r) => r.status === 'fulfilled'),
        ).toHaveLength(1);
    });

    it('refuses on the cap before complaining about the handle', async () => {
        const owner = await makeUser();
        await makeTeam(owner.id);

        // A capped user hears about the cap, not that their name was taken.
        await expect(
            service.createTeam(owner.id, {
                name: 'Bad',
                handle: 'NOT A VALID HANDLE',
            }),
        ).rejects.toMatchObject({ legacyCode: 'team_limit_reached' });
    });

    it('frees the slot when the team is deleted', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);
        await service.deleteTeam(team.uid, owner.id);

        // Soft-deleted teams do not count against the cap.
        await expect(makeTeam(owner.id)).resolves.toMatchObject({
            owner_user_id: owner.id,
        });
    });

    it('counts per user, not globally', async () => {
        const a = await makeUser();
        const b = await makeUser();
        await makeTeam(a.id);

        await expect(makeTeam(b.id)).resolves.toBeTruthy();
    });

    it('falls back to one team when the config omits the key', async () => {
        // `config.default.json` is the merge base and sets this, so the code
        // fallback only ever runs for a config that dropped the key.
        const owner = await makeUser();
        const cfg = service.config as { max_teams_per_user?: number };
        const had = cfg.max_teams_per_user;
        delete cfg.max_teams_per_user;
        try {
            await makeTeam(owner.id);
            await expect(makeTeam(owner.id)).rejects.toMatchObject({
                legacyCode: 'team_limit_reached',
            });
        } finally {
            cfg.max_teams_per_user = had;
        }
    });

    it('ignores a nonsensical cap rather than locking everyone out', async () => {
        const owner = await makeUser();
        const cfg = service.config as { max_teams_per_user?: number };
        const had = cfg.max_teams_per_user;
        // A zero or negative cap would otherwise refuse every team.
        cfg.max_teams_per_user = 0;
        try {
            await expect(makeTeam(owner.id)).resolves.toBeTruthy();
        } finally {
            cfg.max_teams_per_user = had;
        }
    });

    // -- seats per team ------------------------------------------

    it('provisions up to the seat cap and refuses the next', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);

        for (let i = 0; i < SEAT_CAP; i++) {
            await provision(team.uid, owner.id);
        }

        await expect(provision(team.uid, owner.id)).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'seat_limit_reached',
        });
    });

    it('holds the seat cap against concurrent provisions', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);

        const results = await Promise.allSettled(
            Array.from({ length: SEAT_CAP + 3 }, () =>
                provision(team.uid, owner.id),
            ),
        );

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
            SEAT_CAP,
        );
    });

    it('does not count the team owner against the seat cap', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);

        // The owner is `org_owned = 0`; it pays, it does not occupy a seat.
        for (let i = 0; i < SEAT_CAP; i++) {
            await expect(provision(team.uid, owner.id)).resolves.toBeTruthy();
        }
    });

    it('refuses on the cap before creating any account state', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);
        for (let i = 0; i < SEAT_CAP; i++) await provision(team.uid, owner.id);

        const username = `st_${Math.random().toString(36).slice(2, 10)}`;
        await expect(
            service.provisionAccount(team.uid, owner.id, {
                username,
                email: `${username}@test.local`,
            }),
        ).rejects.toMatchObject({ legacyCode: 'seat_limit_reached' });

        // The refused name must still be free, or a capped team would
        // burn global usernames on every rejected attempt.
        expect(await server.stores.user.getByUsername(username)).toBeFalsy();
    });

    it('lowering the cap blocks provisioning without disabling anyone', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);
        const seats = [];
        for (let i = 0; i < SEAT_CAP; i++) {
            seats.push(await provision(team.uid, owner.id));
        }

        const cfg = service.config as { max_seats_per_team?: number };
        cfg.max_seats_per_team = 1;
        try {
            await expect(provision(team.uid, owner.id)).rejects.toMatchObject({
                legacyCode: 'seat_limit_reached',
            });

            // Over the limit is not a reason to suspend people.
            for (const seat of seats) {
                const user = await server.stores.user.getByProperty(
                    'id',
                    seat.userId,
                    { force: true },
                );
                expect(user?.suspended).toBeFalsy();
            }
        } finally {
            cfg.max_seats_per_team = SEAT_CAP;
        }
    });

    it('does not let a deleted seat be replaced beyond the cap', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);
        const seats = [];
        for (let i = 0; i < SEAT_CAP; i++) {
            seats.push(await provision(team.uid, owner.id));
        }

        // Deleting the account removes the membership row, so the seat frees.
        await server.services.userAccount.cascadeDelete(seats[0].userId);
        await expect(provision(team.uid, owner.id)).resolves.toBeTruthy();
        await expect(provision(team.uid, owner.id)).rejects.toMatchObject({
            legacyCode: 'seat_limit_reached',
        });
    });

    // Only reachable with `max_seats_per_team` unset; the override wins.
    describe('with no configured override', () => {
        const FREE = 4;

        it('is not overridden by the shipped defaults', async () => {
            // A flat cap in config.default.json makes the plan branch below
            // dead code on every deployment that does not delete the key.
            const defaults = JSON.parse(
                await readFile(
                    new URL('../../../../config.default.json', import.meta.url),
                    'utf8',
                ),
            ) as Record<string, unknown>;
            expect(defaults.max_seats_per_team).toBeUndefined();
            expect(defaults.max_seats_per_team_free).toBe(FREE);
        });

        /** Runs `fn` with the override off, then puts it back. */
        const withoutOverride = async (fn: () => Promise<void>) => {
            const cfg = service.config as Record<string, unknown>;
            const saved = cfg.max_seats_per_team;
            delete cfg.max_seats_per_team;
            try {
                await fn();
            } finally {
                cfg.max_seats_per_team = saved;
            }
        };

        const onPlan = (id: string) =>
            vi
                .spyOn(server.services.metering, 'getActorSubscription')
                .mockResolvedValue({ id } as never);

        const fill = async (teamUid: string, ownerId: number, n: number) => {
            for (let i = 0; i < n; i++) await provision(teamUid, ownerId);
        };

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('stops a free team at four seats', async () => {
            const owner = await makeUser();
            const team = await makeTeam(owner.id);
            await withoutOverride(async () => {
                onPlan('user_free');
                await fill(team.uid, owner.id, FREE);
                await expect(
                    provision(team.uid, owner.id),
                ).rejects.toMatchObject({
                    legacyCode: 'seat_limit_reached',
                    fields: { limit: FREE },
                });
            });
        });

        it('lets a paying owner past the free cap', async () => {
            // The upgrade path: same team, same seats, a plan that is not free.
            const owner = await makeUser();
            const team = await makeTeam(owner.id);
            await withoutOverride(async () => {
                const plan = onPlan('user_free');
                await fill(team.uid, owner.id, FREE);
                await expect(
                    provision(team.uid, owner.id),
                ).rejects.toMatchObject({ legacyCode: 'seat_limit_reached' });

                plan.mockResolvedValue({ id: 'basic' } as never);
                await expect(
                    provision(team.uid, owner.id),
                ).resolves.toBeTruthy();
            });
        });

        it('counts a seat on the free org policy as free, not as paying', async () => {
            // A seat's own plan is free by construction; it must not read as
            // the owner having bought something.
            const owner = await makeUser();
            const team = await makeTeam(owner.id);
            await withoutOverride(async () => {
                onPlan('org_seat_free');
                await fill(team.uid, owner.id, FREE);
                await expect(
                    provision(team.uid, owner.id),
                ).rejects.toMatchObject({ fields: { limit: FREE } });
            });
        });

        it('takes the per-plan config keys over the built-in numbers', async () => {
            const owner = await makeUser();
            const team = await makeTeam(owner.id);
            await withoutOverride(async () => {
                const cfg = service.config as Record<string, unknown>;
                cfg.max_seats_per_team_free = 1;
                try {
                    onPlan('user_free');
                    await expect(
                        provision(team.uid, owner.id),
                    ).resolves.toBeTruthy();
                    await expect(
                        provision(team.uid, owner.id),
                    ).rejects.toMatchObject({ fields: { limit: 1 } });
                } finally {
                    delete cfg.max_seats_per_team_free;
                }
            });
        });

        it('asks about the owner with a whole user, not an id/uuid stub', async () => {
            // A resolver keyed on any other field would miss, and the cap would
            // then depend on whether something else cached this plan first.
            const owner = await makeUser();
            const team = await makeTeam(owner.id);
            await withoutOverride(async () => {
                const seen: Array<Record<string, unknown>> = [];
                vi.spyOn(
                    server.services.metering,
                    'getActorSubscription',
                ).mockImplementation(async (actor: never) => {
                    seen.push(
                        (actor as { user: Record<string, unknown> }).user,
                    );
                    return { id: 'user_free' } as never;
                });
                await provision(team.uid, owner.id);
                expect(seen[0]).toMatchObject({
                    id: owner.id,
                    username: owner.username,
                });
            });
        });

        it('falls back to the free cap when the plan cannot be read', async () => {
            // Over-provisioning on an unreadable plan is the worse failure.
            const owner = await makeUser();
            const team = await makeTeam(owner.id);
            await withoutOverride(async () => {
                vi.spyOn(
                    server.services.metering,
                    'getActorSubscription',
                ).mockRejectedValue(new Error('metering down'));
                await fill(team.uid, owner.id, FREE);
                await expect(
                    provision(team.uid, owner.id),
                ).rejects.toMatchObject({ fields: { limit: FREE } });
            });
        });
    });
});
