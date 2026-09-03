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

import type { Request, Response } from 'express';
import {
    Controller,
    Delete,
    Get,
    Post,
    Put,
} from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { TeamRow } from '../../stores/team/TeamStore.js';
import { PuterController } from '../types.js';

/** Mirrors ShareController's dual-window shape. */
const TEAM_LIMIT = [
    { scope: 'team:mutate', limit: 60, window: 60_000, key: 'user' as const },
    {
        scope: 'team:mutate-daily',
        limit: 500,
        window: 24 * 60 * 60_000,
        key: 'user' as const,
    },
];

const TEAM_READ_LIMIT = {
    scope: 'team:read',
    limit: 600,
    window: 60_000,
    key: 'user' as const,
};

/** What a workspace looks like on the wire. `id` stays internal. */
const toClientTeam = (team: TeamRow, isOwner: boolean) => ({
    uid: team.uid,
    name: team.name,
    handle: team.handle,
    is_owner: isOwner,
    created_at: team.created_at,
});

@Controller('/teams')
export class TeamController extends PuterController {
    // `requireUserActor` installs the auth gates; reads need it too.

    /** Off means `/teams` 404s and no team route is registered at all. */
    isEnabled(): boolean {
        return this.config.teams_enabled === true;
    }

    @Post('', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async createTeam(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const body = this.#body(req);

        const team = await this.services.team.createWorkspace(userId, {
            name: this.#requireString(body.name, 'name'),
            handle:
                body.handle === undefined || body.handle === null
                    ? null
                    : this.#requireString(body.handle, 'handle'),
        });
        res.json(toClientTeam(team, true));
    }

    @Get('', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_READ_LIMIT,
    })
    async listTeams(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const teams = await this.stores.team.listTeamsForUser(userId);
        res.json({
            items: teams.map((t) =>
                toClientTeam(t, t.owner_user_id === userId),
            ),
        });
    }

    @Get('/:uid', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_READ_LIMIT,
    })
    async getTeam(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const team = await this.services.team.requireMembership(
            this.#param(req, 'uid'),
            userId,
        );
        res.json(toClientTeam(team, team.owner_user_id === userId));
    }

    @Put('/:uid', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async updateTeam(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        await this.services.team.requireOwner(this.#param(req, 'uid'), userId);
        const body = this.#body(req);

        const changes: { name?: string; handle?: string | null } = {};
        if (body.name !== undefined)
            changes.name = this.#requireString(body.name, 'name');
        if (body.handle !== undefined)
            changes.handle = body.handle === null ? null : String(body.handle);

        const team = await this.stores.team.update(
            this.#param(req, 'uid'),
            changes,
        );
        if (!team) throw this.#notFound();
        res.json(toClientTeam(team, true));
    }

    @Delete('/:uid', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async deleteTeam(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        await this.services.team.deleteWorkspace(
            this.#param(req, 'uid'),
            userId,
        );
        res.json({ success: true });
    }

    // -- Members ------------------------------------------------------

    @Get('/:uid/members', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_READ_LIMIT,
    })
    async listMembers(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        await this.services.team.requireMembership(
            this.#param(req, 'uid'),
            userId,
        );

        const page = await this.stores.team.listMembers(
            this.#param(req, 'uid'),
            {
                limit: req.query.limit,
                cursor:
                    typeof req.query.cursor === 'string'
                        ? req.query.cursor
                        : undefined,
            },
        );
        res.json({
            items: page.items.map((m) => ({
                username: m.username,
                org_owned: Number(m.org_owned) === 1,
                created_at: m.created_at,
            })),
            ...(page.cursor ? { cursor: page.cursor } : {}),
        });
    }

    @Post('/:uid/members', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async createMember(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const uid = this.#param(req, 'uid');
        // Authority before shape, or a stranger learns if their body parsed.
        await this.services.team.requireOwner(uid, userId);

        const body = this.#body(req);
        const result = await this.services.team.provisionAccount(uid, userId, {
            username: this.#requireString(body.username, 'username'),
            email: this.#requireString(body.email, 'email'),
        });
        // Shown once; the admin delivers it out of band.
        res.json({
            username: result.username,
            temporary_password: result.temporaryPassword,
        });
    }

    @Post('/:uid/members/:username/activation', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async reissueCredential(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const uid = this.#param(req, 'uid');
        // Authority first, or resolving `:username` is an existence oracle.
        await this.services.team.requireOwner(uid, userId);
        const target = await this.#requireTargetUserId(req);

        const { temporaryPassword } =
            await this.services.team.reissueCredential(uid, userId, target);
        // Shown once for the admin to deliver out of band.
        res.json({ temporary_password: temporaryPassword });
    }

    @Post('/:uid/members/:username/disable', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async disableMember(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const uid = this.#param(req, 'uid');
        // Authority first, or resolving `:username` is an existence oracle.
        await this.services.team.requireOwner(uid, userId);
        const target = await this.#requireTargetUserId(req);

        await this.services.team.disableMember(
            this.#param(req, 'uid'),
            userId,
            target,
        );
        res.json({ success: true });
    }

    @Post('/:uid/members/:username/enable', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_LIMIT,
    })
    async enableMember(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        const uid = this.#param(req, 'uid');
        // Authority first, or resolving `:username` is an existence oracle.
        await this.services.team.requireOwner(uid, userId);
        const target = await this.#requireTargetUserId(req);

        await this.services.team.enableMember(
            this.#param(req, 'uid'),
            userId,
            target,
        );
        res.json({ success: true });
    }

    // -- Audit --------------------------------------------------------

    @Get('/:uid/audit', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_READ_LIMIT,
    })
    async listAudit(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        res.json(
            await this.services.team.listAudit(
                this.#param(req, 'uid'),
                userId,
                this.#pageOpts(req),
            ),
        );
    }

    @Get('/:uid/audit/me', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: TEAM_READ_LIMIT,
    })
    async listOwnAudit(req: Request, res: Response): Promise<void> {
        const userId = this.#requireUserId(req);
        res.json(
            await this.services.team.listOwnAudit(
                this.#param(req, 'uid'),
                userId,
                this.#pageOpts(req),
            ),
        );
    }

    // -- Helpers ------------------------------------------------------

    /** `limit` and `cursor` as doc/pagination.md defines them. */
    #pageOpts(req: Request): { limit?: unknown; cursor?: string } {
        return {
            limit: req.query.limit,
            cursor:
                typeof req.query.cursor === 'string'
                    ? req.query.cursor
                    : undefined,
        };
    }

    #requireUserId(req: Request): number {
        const id = (req.actor as { user?: { id?: number } } | undefined)?.user
            ?.id;
        if (!id)
            throw new HttpError(401, 'User required', {
                legacyCode: 'unauthorized',
            });
        return id;
    }

    /** Express types a param as `string | string[]`; routes here take one. */
    #param(req: Request, name: string): string {
        const value = req.params[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    }

    #body(req: Request): Record<string, unknown> {
        return (req.body ?? {}) as Record<string, unknown>;
    }

    #requireString(value: unknown, field: string): string {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new HttpError(400, `${field} is required`, {
                legacyCode: 'bad_request',
            });
        }
        return value;
    }

    #notFound(): HttpError {
        return new HttpError(404, 'Workspace not found', {
            legacyCode: 'team_not_found',
        });
    }

    /** Resolves `:username` to an id; the service decides whether it may act. */
    async #requireTargetUserId(req: Request): Promise<number> {
        const user = await this.stores.user.getByUsername(
            this.#param(req, 'username'),
        );
        if (!user)
            throw new HttpError(404, 'Not an account of this workspace', {
                legacyCode: 'not_an_org_account',
            });
        return user.id;
    }
}
