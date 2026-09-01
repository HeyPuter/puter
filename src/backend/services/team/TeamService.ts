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

import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import validator from 'validator';
import { v4 as uuidv4 } from 'uuid';
import {
    RESERVED_USERNAMES,
    USERNAME_MAX_LENGTH,
    USERNAME_REGEX,
} from '../../controllers/auth/AuthController.js';
import { HttpError } from '../../core/http/HttpError.js';
import { checkHandle } from '../../stores/team/TeamStore.js';
import type {
    TeamAuditRow,
    TeamMemberRow,
    TeamRow,
} from '../../stores/team/TeamStore';
import type { UserRow } from '../../stores/user/UserStore';
import { cleanEmail } from '../../util/email.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { PuterService } from '../types';

/** Unambiguous alphabet -- no 0/O or 1/l, since a human retypes this. */
const TEMP_PASSWORD_ALPHABET =
    'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** ~95 bits, generated rather than chosen so it is never a reused pattern. */
export const generateTemporaryPassword = (length = 16): string => {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
    }
    return out;
};

/** Why an account was disabled. Free text in `0063`; this is the team one. */
export const DISABLED_BY_WORKSPACE = 'disabled_by_workspace';

export class TeamService extends PuterService {
    // -- Authority ---- the whole authorization model ------------------

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
    async requireOwner(
        teamUid: string,
        actorUserId: number,
    ): Promise<TeamRow> {
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

        // 0 makes the owner pay for itself; unchecked, it is unreachable.
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

    /** Soft delete disables the accounts it created; recovery is via support. */
    async deleteWorkspace(teamUid: string, actorUserId: number): Promise<void> {
        const team = await this.requireOwner(teamUid, actorUserId);

        // Otherwise they keep working, unreachable through a deleted workspace.
        let page = await this.stores.team.listMembers(teamUid, { limit: 200 });
        for (;;) {
            for (const member of page.items) {
                if (Number(member.org_owned) !== 1) continue;
                await this.#suspend(member.user_id);
                await this.stores.team.appendAudit({
                    teamId: team.id,
                    userId: member.user_id,
                    actorUserId,
                    action: 'disable',
                    reason: 'workspace_deleted',
                });
            }
            if (!page.cursor) break;
            page = await this.stores.team.listMembers(teamUid, {
                limit: 200,
                cursor: page.cursor,
            });
        }

        await this.stores.team.appendAudit({
            teamId: team.id,
            userId: actorUserId,
            actorUserId,
            action: 'delete_team',
        });
        await this.stores.team.softDelete(teamUid);
    }

    /** Workspace owner only. Readable after deletion -- that is the point of it. */
    async listAudit(
        teamUid: string,
        actorUserId: number,
        opts: { limit?: unknown; cursor?: string } = {},
    ) {
        const team = await this.#requireOwnedWorkspace(teamUid, actorUserId);
        return this.#withUsernames(
            await this.stores.team.listAudit(team.id, opts),
        );
    }

    /** The caller's own entries; the only reader who is not the actor. */
    async listOwnAudit(
        teamUid: string,
        actorUserId: number,
        opts: { limit?: unknown; cursor?: string } = {},
    ) {
        const team = await this.requireMembership(teamUid, actorUserId);
        return this.#withUsernames(
            await this.stores.team.listAuditForUser(team.id, actorUserId, opts),
        );
    }

    /** Resolves a workspace the caller owns, soft-deleted or not. */
    async #requireOwnedWorkspace(
        teamUid: string,
        actorUserId: number,
    ): Promise<TeamRow> {
        const live = await this.stores.team.getByUid(teamUid);
        if (live) return this.requireOwner(teamUid, actorUserId);

        const deleted =
            await this.stores.team.getByUidIncludingDeleted(teamUid);
        if (!deleted || deleted.owner_user_id !== actorUserId) {
            throw new HttpError(404, 'Workspace not found', {
                legacyCode: 'team_not_found',
            });
        }
        return deleted;
    }

    /** Internal user ids never reach the wire, as `toClientTeam` does for `id`. */
    async #withUsernames(page: { items: TeamAuditRow[]; cursor?: string }) {
        const ids = new Set<number>();
        for (const row of page.items) {
            ids.add(row.user_id_keep);
            if (row.actor_user_id !== null) ids.add(row.actor_user_id);
        }
        const users = await this.stores.user.getByIds([...ids]);
        const name = (id: number | null) =>
            id === null ? null : (users.get(id)?.username ?? null);

        return {
            items: page.items.map((row) => ({
                action: row.action,
                reason: row.reason,
                created_at: row.created_at,
                username: name(row.user_id_keep),
                actor_username: name(row.actor_user_id),
            })),
            ...(page.cursor ? { cursor: page.cursor } : {}),
        };
    }

    // -- Provisioning ---- usernames come from the global pool ----------

    /** Provisioning must not mint accounts signup itself would refuse. */
    #usernameRejection(username: string): boolean {
        return (
            !USERNAME_REGEX.test(username) ||
            username.length > USERNAME_MAX_LENGTH ||
            RESERVED_USERNAMES.has(username.toLowerCase())
        );
    }

    #assertUsableUsername(username: string): void {
        if (this.#usernameRejection(username)) {
            throw new HttpError(400, 'Invalid username', {
                legacyCode: 'bad_request',
            });
        }
    }

    /** Free names near `username`, checked for availability. Never auto-applied. */
    async suggestUsernames(username: string, count = 3): Promise<string[]> {
        // Room for the suffix, or every suggestion breaks the length rule.
        const base = username.slice(0, USERNAME_MAX_LENGTH - 3);
        const found: string[] = [];
        for (let n = 1; n <= 40 && found.length < count; n++) {
            const candidate = `${base}${n}`;
            if (this.#usernameRejection(candidate)) continue;
            if (!(await this.stores.user.getByUsername(candidate))) {
                found.push(candidate);
            }
        }
        return found;
    }

    /** Returns the activation link; the account has no password until used. */
    async provisionAccount(
        teamUid: string,
        actorUserId: number,
        input: { username: string; email: string },
    ): Promise<{
        userId: number;
        username: string;
        temporaryPassword: string;
    }> {
        const team = await this.requireOwner(teamUid, actorUserId);
        this.#assertUsableUsername(input.username);
        if (!validator.isEmail(input.email)) {
            throw new HttpError(400, 'Invalid email', {
                legacyCode: 'bad_request',
            });
        }

        // Before any write, so a taken name fails cleanly.
        if (await this.stores.user.getByUsername(input.username)) {
            throw new HttpError(409, 'That username is taken', {
                legacyCode: 'username_already_in_use',
                fields: {
                    suggestions: await this.suggestUsernames(input.username),
                },
            });
        }

        // `idx_user_owned_email` is partial and skips password-null rows.
        if (await this.stores.user.findEmailOwner(input.email)) {
            throw new HttpError(409, 'That email is already in use', {
                legacyCode: 'email_already_in_use',
            });
        }

        const user = await this.stores.user.create({
            username: input.username,
            uuid: uuidv4(),
            password: null,
            email: input.email,
            clean_email: cleanEmail(input.email),
            // The address came from the administrator, not its holder.
            requires_email_confirmation: true,
        });

        await generateDefaultFsentries(this.clients.db, this.stores.user, user);

        // Otherwise a vanished workspace leaves a real account nobody owns.
        const admitted = await this.stores.team.addMember(teamUid, user.id, {
            orgOwned: true,
        });
        if (!admitted) {
            await this.services.userAccount.cascadeDelete(user.id);
            throw new HttpError(409, 'That workspace is no longer available', {
                legacyCode: 'conflict',
            });
        }

        await this.stores.team.appendAudit({
            teamId: team.id,
            userId: user.id,
            actorUserId,
            action: 'provision',
        });

        // Returned once; forced change on first use is what bounds it.
        const temporaryPassword = generateTemporaryPassword();
        await this.stores.user.update(user.id, {
            password: await bcrypt.hash(temporaryPassword, 8),
            requires_password_change: 1,
        });
        await this.#notifyAccountCreated(user, team);

        return {
            userId: user.id,
            username: user.username,
            temporaryPassword,
        };
    }

    /** Issues a fresh credential, invalidating the previous one. */
    async reissueCredential(
        teamUid: string,
        actorUserId: number,
        targetUserId: number,
    ): Promise<{ temporaryPassword: string }> {
        const team = await this.requireOwner(teamUid, actorUserId);
        await this.requireOrgAccount(teamUid, targetUserId);

        const user = await this.stores.user.getByProperty('id', targetUserId, {
            force: true,
        });
        if (!user) {
            throw new HttpError(404, 'Account not found', {
                legacyCode: 'not_found',
            });
        }
        // Only before first use; changing a live account's password is reset.
        if (!user.requires_password_change) {
            throw new HttpError(409, 'That account is already activated', {
                legacyCode: 'conflict',
            });
        }

        const temporaryPassword = generateTemporaryPassword();
        await this.stores.user.update(targetUserId, {
            password: await bcrypt.hash(temporaryPassword, 8),
            requires_password_change: 1,
        });
        await this.#notifyAccountCreated(user, team);
        return { temporaryPassword };
    }

    /** A notice only -- it carries no credential, so delivery is best effort. */
    async #notifyAccountCreated(user: UserRow, team: TeamRow): Promise<void> {
        if (!this.clients.email || !user.email) return;
        try {
            const sent = await this.clients.email.send(
                user.email,
                'team_account_created',
                {
                    username: user.username,
                    team_name: team.name ?? 'Your workspace',
                },
            );
            // `sendRaw` returns null with no transport rather than throwing.
            if (sent === null) {
                console.warn('[team-provision] no email transport configured');
            }
        } catch (e) {
            console.warn('[team-provision] notice failed:', e);
        }
    }

    // -- Disable and re-enable ---- the whole of offboarding ------------

    /** Rejects the account's next request; its files are untouched. */
    async disableMember(
        teamUid: string,
        actorUserId: number,
        targetUserId: number,
    ): Promise<void> {
        const team = await this.requireOwner(teamUid, actorUserId);
        await this.requireOrgAccount(teamUid, targetUserId);

        // Recorded first: a failed append must not leave an unlogged suspension.
        await this.stores.team.appendAudit({
            teamId: team.id,
            userId: targetUserId,
            actorUserId,
            action: 'disable',
        });
        await this.#suspend(targetUserId);
    }

    /** Nothing was destroyed, so the account returns as it was. */
    async enableMember(
        teamUid: string,
        actorUserId: number,
        targetUserId: number,
    ): Promise<void> {
        const team = await this.requireOwner(teamUid, actorUserId);
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

        await this.stores.team.appendAudit({
            teamId: team.id,
            userId: targetUserId,
            actorUserId,
            action: 'enable',
        });
        await this.stores.user.update(targetUserId, {
            suspended: 0,
            suspended_at: null,
            suspended_reason: null,
        });
        await this.stores.user.invalidateById(targetUserId);
    }

    /** The three columns together; `suspended` is the one that gates requests. */
    async #suspend(userId: number): Promise<void> {
        await this.stores.user.update(userId, {
            suspended: 1,
            suspended_at: Math.floor(Date.now() / 1000),
            suspended_reason: DISABLED_BY_WORKSPACE,
        });
        await this.#dropSessions(userId);
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
