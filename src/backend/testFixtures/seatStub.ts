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

import { onTestFinished } from 'vitest';

import type {
    OrgSeatRow,
    TeamServiceContract,
    TeamStoreContract,
} from '../core/teams.js';

/**
 * Teams is optional, so core cannot build a real seat to test the rules that
 * refuse one. This answers the contract instead, which is all those rules
 * read.
 */
export interface SeatStubOptions {
    /** Whether the seat's team demands a second factor. */
    require2fa?: boolean;
    teamUid?: string;
    teamName?: string | null;
    /** What `releaseUnconfirmedSeatEmail` reports back. */
    released?: boolean;
    /** Called with the id the signup path asked to release. */
    onRelease?: (userId: number) => void;
}

interface Registries {
    stores: Record<string, unknown> & {
        user?: { clearUnconfirmedEmail?: (id: number) => Promise<boolean> };
    };
    services: Record<string, unknown>;
}

/** Installs the stub for `seatUserIds`; call the result to put it back. */
export const installSeatStub = (
    server: Registries,
    seatUserIds: number[],
    opts: SeatStubOptions = {},
): (() => void) => {
    const seats = new Set(seatUserIds);
    const previousStore = server.stores.team;
    const previousService = server.services.team;

    const seatFor = (userId: number): OrgSeatRow | null =>
        seats.has(userId)
            ? ({
                  id: userId,
                  user_id: userId,
                  uuid: `seat-${userId}`,
                  username: `seat-${userId}`,
                  team_uid: opts.teamUid ?? 'team-stub',
                  team_name: opts.teamName ?? 'Acme',
                  owner_user_id: 0,
                  require_2fa: opts.require2fa ? 1 : 0,
              } as OrgSeatRow)
            : null;

    const storeStub: TeamStoreContract = {
        getOrgSeat: async (userId: number) => seatFor(userId),
        isMember: async () => false,
        getByUid: async () => null,
        getByHandle: async () => null,
        getByIdIncludingDeleted: async () => null,
        getByIdsIncludingDeleted: async () => new Map(),
        listGroupIdsForUser: async () => [],
        listMemberIdsByGroupId: async () => [],
        memberIdsAmong: async () => [],
        countOwned: async () => 0,
        countOwnedTeamsWithAccounts: async () => 0,
    };
    server.stores.team = storeStub;
    const serviceStub: TeamServiceContract = {
        teamsAvailableTo: async () => false,
        captureSeatForBilling: async () => null,
        emitSeatDeleted: () => undefined,
        forgetSeat: async () => undefined,
        recordPasswordSelfChange: async () => undefined,
        releaseUnconfirmedSeatEmail: async (userId: number) => {
            opts.onRelease?.(userId);
            if (!seats.has(userId)) return false;
            if (opts.released === false) return false;
            seats.delete(userId);
            // The real one clears the address; callers observe that, not the
            // boolean.
            return (
                (await server.stores.user?.clearUnconfirmedEmail?.(userId)) ??
                true
            );
        },
    };
    server.services.team = serviceStub;

    // Deleted rather than set undefined: shutdown walks the registry values.
    const restore = () => {
        if (previousStore === undefined) delete server.stores.team;
        else server.stores.team = previousStore;
        if (previousService === undefined) delete server.services.team;
        else server.services.team = previousService;
    };
    // Put back when the test ends, so a caller need not unwind it.
    onTestFinished(restore);
    return restore;
};
