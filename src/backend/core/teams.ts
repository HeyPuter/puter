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
 * What core asks of Teams, which ships separately. Nothing here is an
 * implementation: a deployment without the feature registers neither, and every
 * caller treats both as absent.
 */

/** A team, as much of one as core reads back. */
export interface TeamRow {
    id: number;
    uid: string;
    owner_user_id: number;
    kind: string;
    name: string | null;
    handle: string | null;
    deleted_at: string | null;
    created_at: string;
    /** Whether an app acting for a member may read the member list. */
    directory_enabled: number;
    /** Whether the accounts this team provisioned must hold 2FA. */
    require_2fa: number;
}

/** The seat a user holds, for the gates that ask whether they hold one. */
export interface OrgSeatRow {
    id: number;
    user_id: number;
    uuid: string;
    username: string;
    team_uid: string;
    team_name: string | null;
    owner_user_id: number;
    /** Carried here so the per-request 2FA gate costs no extra read. */
    require_2fa: number;
}

/** Most members one notification fans out to. */
export const NOTIFY_FANOUT_CAP = 500;

/** The reads core makes of teams it did not create. */
export interface TeamStoreContract {
    getOrgSeat(userId: number): Promise<OrgSeatRow | null>;
    isMember(teamUid: string, userId: number): Promise<boolean>;
    getByUid(uid: string): Promise<TeamRow | null>;
    getByHandle(handle: string): Promise<TeamRow | null>;
    getByIdIncludingDeleted(id: number): Promise<TeamRow | null>;
    getByIdsIncludingDeleted(ids: number[]): Promise<Map<number, TeamRow>>;
    listGroupIdsForUser(userId: number): Promise<number[]>;
    listMemberIdsByGroupId(groupId: number): Promise<number[]>;
    memberIdsAmong(teamUid: string, userIds: number[]): Promise<number[]>;
    countOwned(ownerUserId: number): Promise<number>;
    countOwnedTeamsWithAccounts(ownerUserId: number): Promise<number>;
}

/** The calls core makes when an account it owns changes. */
export interface TeamServiceContract {
    teamsAvailableTo(userId: number, email: string | null): Promise<boolean>;
    captureSeatForBilling(userId: number): Promise<unknown | null>;
    emitSeatDeleted(seat: unknown): void;
    forgetSeat(seat: unknown): Promise<void>;
    releaseUnconfirmedSeatEmail(userId: number): Promise<boolean>;
    recordPasswordSelfChange(userId: number): Promise<void>;
}
