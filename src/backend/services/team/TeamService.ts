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

import { HttpError } from '../../core/http/HttpError.js';
import { checkHandle } from '../../stores/team/TeamStore.js';
import type { TeamMemberRow, TeamRow } from '../../stores/team/TeamStore';
import { PuterService } from '../types';

/** Why an account was disabled. Free text in `0063`; this is the team one. */
export const DISABLED_BY_WORKSPACE = 'disabled_by_workspace';

export class TeamService extends PuterService {
    // -- Authority ----------------------------------------------------
    // Two checks, and between them the whole authorization model.

    /** 404 to a non-member so the endpoint is not an existence oracle. */
    async requireMembership(
        teamUid: string,
        actorUserId: number,
    ): Promise<TeamRow> {
        const team = await this.stores.team.getByUid(teamUid);
        if (!team || !(await this.stores.team.isMember(teamUid, actorUserId))) {
            throw new HttpError(404, 'Workspace not found', {
                legacyCode: 'team_not_found',
            });
        }
        return team;
    }

    /** Authority is one test: the caller is the account named by the workspace. */
    async requireOwner(teamUid: string, actorUserId: number): Promise<TeamRow> {
        const team = await this.requireMembership(teamUid, actorUserId);
        if (team.owner_user_id !== actorUserId) {
            throw new HttpError(403, 'Only the workspace owner can do that', {
                legacyCode: 'not_the_workspace_owner',
            });
        }
        return team;
    }

    /** The workspace owner is never a valid target of a member route. */
    async requireOrgAccount(
        teamUid: string,
        targetUserId: number,
    ): Promise<TeamMemberRow> {
        const membership = await this.stores.team.getMembership(
            teamUid,
            targetUserId,
        );
        // Tested explicitly, never inferred from NULL.
        if (!membership || Number(membership.org_owned) !== 1) {
            throw new HttpError(404, 'Not an account of this workspace', {
                legacyCode: 'not_an_org_account',
            });
        }
        return membership;
    }

    // -- Workspace lifecycle ------------------------------------------

    /** A rejected handle is 400, a taken one 409, never an unhandled 500. */
    async assertHandleUsable(handle: string): Promise<void> {
        const rejection = checkHandle(handle);
        if (rejection) {
            throw new HttpError(400, `Unusable handle: ${rejection}`, {
                legacyCode: 'bad_request',
            });
        }
        if (!(await this.stores.team.isHandleAvailable(handle))) {
            throw new HttpError(409, 'That handle is taken', {
                legacyCode: 'conflict',
            });
        }
    }

    /** The unique index is the arbiter, so a race still lands as a 409. */
    async #asHttpErrors<T>(run: () => Promise<T>): Promise<T> {
        try {
            return await run();
        } catch (e) {
            if (e instanceof HttpError) throw e;
            const message = String((e as Error)?.message ?? '');
            if (/unusable team handle/iu.test(message)) {
                throw new HttpError(400, message, {
                    legacyCode: 'bad_request',
                });
            }
            if (/unique|duplicate/iu.test(message)) {
                throw new HttpError(409, 'That handle is taken', {
                    legacyCode: 'conflict',
                });
            }
            throw e;
        }
    }

    /** Renames or re-handles a workspace, refusing an unusable handle. */
    async updateWorkspace(
        teamUid: string,
        actorUserId: number,
        changes: { name?: string; handle?: string | null },
    ): Promise<TeamRow> {
        await this.requireOwner(teamUid, actorUserId);
        if (changes.handle) await this.assertHandleUsable(changes.handle);

        const team = await this.#asHttpErrors(() =>
            this.stores.team.update(teamUid, changes),
        );
        if (!team) {
            throw new HttpError(404, 'Workspace not found', {
                legacyCode: 'team_not_found',
            });
        }
        return team;
    }

    /** Creates a workspace and admits its creator as the workspace owner. */
    async createWorkspace(
        ownerUserId: number,
        input: { name: string; handle?: string | null },
    ): Promise<TeamRow> {
        const handle = input.handle ?? null;
        if (handle !== null) await this.assertHandleUsable(handle);

        const team = await this.#asHttpErrors(() =>
            this.stores.team.create({
                ownerUserId,
                name: input.name,
                handle,
            }),
        );

        // 0 makes the owner pay for itself and stay an invalid route target.
        // Unchecked, the owner could never reach their own workspace.
        const admitted = await this.stores.team.addMember(
            team.uid,
            ownerUserId,
            {
                orgOwned: false,
            },
        );
        if (!admitted) {
            await this.stores.team.softDelete(team.uid);
            throw new HttpError(500, 'Could not create the workspace', {
                legacyCode: 'internal_error',
            });
        }
        return team;
    }

    /** The owner is a member with `org_owned = 0`, and the only such member. */
    async checkOwnerInvariant(teamUid: string): Promise<boolean> {
        const team = await this.stores.team.getByUid(teamUid);
        if (!team) return false;

        const owner = await this.stores.team.getMembership(
            teamUid,
            team.owner_user_id,
        );
        if (!owner || Number(owner.org_owned) !== 0) return false;

        const rows = (await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `jct_user_group` ' +
                'WHERE `group_id` = ? AND `org_owned` = 0',
            [team.id],
        )) as { n: number }[];
        return Number(rows[0]?.n) === 1;
    }

    // -- Disable and re-enable ----------------------------------------
    // The whole of offboarding: no removal, no transfer, no retention clock.

    /** Rejects the account's next request; its files are untouched. */
    async disableMember(
        teamUid: string,
        actorUserId: number,
        targetUserId: number,
    ): Promise<void> {
        await this.requireOwner(teamUid, actorUserId);
        await this.requireOrgAccount(teamUid, targetUserId);

        // `suspended` is what `userProtected` enforces; the others are siblings.
        await this.stores.user.update(targetUserId, {
            suspended: 1,
            suspended_at: Math.floor(Date.now() / 1000),
            suspended_reason: DISABLED_BY_WORKSPACE,
        });
        await this.#dropSessions(targetUserId);
    }

    /** Nothing was destroyed, so the account returns as it was. */
    async enableMember(
        teamUid: string,
        actorUserId: number,
        targetUserId: number,
    ): Promise<void> {
        await this.requireOwner(teamUid, actorUserId);
        await this.requireOrgAccount(teamUid, targetUserId);

        // Forced read, as `userProtected` does: a cached row predates this.
        const user = await this.stores.user.getByProperty('id', targetUserId, {
            force: true,
        });
        // Only the workspace's own suspension; a platform one must not lift.
        if (
            user?.suspended &&
            user.suspended_reason !== DISABLED_BY_WORKSPACE
        ) {
            throw new HttpError(409, 'That account was suspended by Puter', {
                legacyCode: 'conflict',
            });
        }

        await this.stores.user.update(targetUserId, {
            suspended: 0,
            suspended_at: null,
            suspended_reason: null,
        });
        await this.stores.user.invalidateById(targetUserId);
    }

    /** Via the store: a raw DELETE leaves the session cache serving the row. */
    async #dropSessions(userId: number): Promise<void> {
        const rows = (await this.clients.db.read(
            'SELECT `uuid` FROM `sessions` WHERE `user_id` = ? AND `revoked_at` IS NULL',
            [userId],
        )) as { uuid: string }[];
        for (const row of rows) {
            await this.stores.session.removeByUuid(row.uuid);
        }
        await this.stores.user.invalidateById(userId);
    }
}
