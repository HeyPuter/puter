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
import type { Actor } from '../../core/actor.js';
import { Controller, Delete, Get, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { bodyRecord } from '../../core/http/requestBody.js';
import { parseKvShareRecipient } from '../../services/kvShare/kvShares.js';
import type { KvShareHandleListOptions } from '../../stores/events/KvShareHandleStore.js';
import { KV_HANDLE_LIST_LIMIT_CAP } from '../../stores/events/KvShareHandleStore.js';
import { KV_GLOBAL_APP_KEY } from '../../stores/systemKv/SystemKVStore.js';
import { normalizeLimit } from '../../util/pagination.js';
import { EVENTS_LIST_LIMIT } from '../events/limits.js';
import { PuterController } from '../types.js';

/** The app-less namespace is no app, so the wire says `null` for it. */
const publicAppUid = (appUid: string): string | null =>
    appUid === KV_GLOBAL_APP_KEY ? null : appUid;

const pageOptions = (req: Request): KvShareHandleListOptions => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    return {
        limit: normalizeLimit(query.limit, { cap: KV_HANDLE_LIST_LIMIT_CAP }),
        cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
        includeTotal: query.includeTotal === 'true',
    };
};

/**
 * Sharing a region of one account's key-value data with another account.
 *
 * Gated like the events surface: `subdomain: 'api'` plus `allowAccessToken`,
 * with app-ness decided from `effectiveApp` in the service, which is where the
 * owner, holder, delegation and namespace rules live. Only sharing asks for a
 * confirmed email; listing, revoking and unsharing only narrow or report.
 */
@Controller('/kv')
export class KvShareController extends PuterController {
    /**
     * POST /kv/shares — share a region with another account, `read` unless the
     * body asks otherwise. Sharing the same region with the same account again
     * changes its level or label in place.
     */
    @Post('/shares', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        requireVerified: true,
    })
    async share(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = bodyRecord(req);
        const share = await this.services.kvShare.mintKvHandle(
            actor,
            {
                prefix: body.prefix,
                recipient: parseKvShareRecipient(body.recipient),
                access: body.access,
                appUid: body.appUid,
                label: body.label,
            },
            { defaultAccess: 'read' },
        );
        res.json({
            handle: share.handle,
            prefix: share.prefix,
            access: share.access,
            appUid: publicAppUid(share.appUid),
            holder: share.holderUsername,
            label: share.label,
            createdAt: share.createdAt,
        });
    }

    /** GET /kv/shares — what this account has shared out, retired included. */
    @Get('/shares', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_LIST_LIMIT,
    })
    async listSharedByMe(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const page = await this.services.kvShare.listKvHandles(
            actor,
            pageOptions(req),
        );
        res.json({
            items: page.items.map((row) => ({
                handle: row.handle,
                prefix: row.prefix,
                access: row.access,
                appUid: publicAppUid(row.appUid),
                holder: row.holderUsername,
                label: row.label,
                createdAt: row.createdAt,
                revokedAt: row.revokedAt,
                revokedBy: row.revokedBy,
            })),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        });
    }

    /** GET /kv/shares/with-me — live shares this account holds. */
    @Get('/shares/with-me', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_LIST_LIMIT,
    })
    async listSharedWithMe(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const page = await this.services.kvShare.listKvSharesWithMe(
            actor,
            pageOptions(req),
        );
        res.json({
            items: page.items.map((row) => ({
                handle: row.handle,
                access: row.access,
                appUid: publicAppUid(row.appUid),
                label: row.label,
                createdAt: row.createdAt,
            })),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        });
    }

    /**
     * DELETE /kv/shares/:handle — the owner revokes, the holder gives it up,
     * and anyone else is told it is not there.
     */
    @Delete('/shares/:handle', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async unshare(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json(
            await this.services.kvShare.removeKvShare(actor, req.params.handle),
        );
    }

    #requireActor(req: Request): Actor {
        const actor = req.actor;
        if (!actor?.user)
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        return actor;
    }
}
