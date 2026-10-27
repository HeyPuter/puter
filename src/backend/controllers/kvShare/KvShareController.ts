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
import {
    assertShareableAppUid,
    parseKvShareRecipient,
} from '../../services/kvShare/kvShares.js';
import type {
    KvShareHandleListOptions,
    KvShareOwnerListOptions,
    KvShareOwnerListState,
} from '../../stores/events/KvShareHandleStore.js';
import {
    KV_HANDLE_LIST_LIMIT_CAP,
    KV_SHARE_OWNER_LIST_STATES,
} from '../../stores/events/KvShareHandleStore.js';
import { KV_GLOBAL_APP_KEY } from '../../stores/systemKv/SystemKVStore.js';
import { normalizeLimit } from '../../util/pagination.js';
import type { KvShareView } from '../../services/kvShare/KvShareService.js';
import { EVENTS_LIST_LIMIT, KV_SHARE_BATCH_MAX } from '../events/limits.js';
import { PuterController } from '../types.js';

/** The app-less namespace is no app, so the wire says `null` for it. */
const publicAppUid = (appUid: string): string | null =>
    appUid === KV_GLOBAL_APP_KEY ? null : appUid;

/**
 * The namespace a listing's `appUid` names, in the form responses use: an app
 * uid, or `null` for the app-less namespace.
 */
const listAppUid = (value: unknown): string | undefined => {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string')
        throw new HttpError(400, '`appUid` must be a string', {
            legacyCode: 'bad_request',
        });
    return value === 'null' ? KV_GLOBAL_APP_KEY : assertShareableAppUid(value);
};

const badRequest = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

/** A share as `POST /kv/shares` reports it. */
const shareBody = (share: KvShareView) => ({
    handle: share.handle,
    prefix: share.prefix,
    access: share.access,
    appUid: publicAppUid(share.appUid),
    holder: share.holderUsername,
    label: share.label,
    createdAt: share.createdAt,
});

/** `recipients` when the body names it: 1 to `KV_SHARE_BATCH_MAX` entries. */
const batchRecipients = (
    body: Record<string, unknown>,
): unknown[] | undefined => {
    const { recipient, recipients } = body;
    if (recipients === undefined) return undefined;
    if (recipient !== undefined)
        throw badRequest('Send either `recipient` or `recipients`, not both');
    if (
        !Array.isArray(recipients) ||
        recipients.length === 0 ||
        recipients.length > KV_SHARE_BATCH_MAX
    )
        throw badRequest(
            `\`recipients\` must be an array of 1 to ${KV_SHARE_BATCH_MAX} recipients`,
        );
    return recipients;
};

const listState = (value: unknown): KvShareOwnerListState | undefined => {
    if (value === undefined || value === '') return undefined;
    if (!(KV_SHARE_OWNER_LIST_STATES as readonly unknown[]).includes(value))
        throw new HttpError(400, '`state` must be `live`, `revoked` or `all`', {
            legacyCode: 'bad_request',
        });
    return value as KvShareOwnerListState;
};

const pageOptions = (req: Request): KvShareHandleListOptions => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    return {
        limit: normalizeLimit(query.limit, { cap: KV_HANDLE_LIST_LIMIT_CAP }),
        cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
        includeTotal: query.includeTotal === 'true',
        appUid: listAppUid(query.appUid),
    };
};

const ownerPageOptions = (req: Request): KvShareOwnerListOptions => ({
    ...pageOptions(req),
    state: listState((req.query ?? {}).state),
});

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
     * changes its level or label in place. `recipients` shares it with several
     * at once and reports each one on its own item.
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
        const fields = {
            prefix: body.prefix,
            access: body.access,
            appUid: body.appUid,
            label: body.label,
        };
        const recipients = batchRecipients(body);
        if (recipients) {
            const items = await this.services.kvShare.mintKvHandles(
                actor,
                { ...fields, recipients },
                { defaultAccess: 'read' },
            );
            res.json({
                items: items.map((item) =>
                    item.share
                        ? {
                              recipient: item.recipient,
                              ...shareBody(item.share),
                          }
                        : {
                              recipient: item.recipient,
                              error: {
                                  message: item.error?.message ?? 'Not shared',
                                  code:
                                      item.error?.legacyCode ??
                                      item.error?.code ??
                                      'internal_error',
                              },
                          },
                ),
            });
            return;
        }
        const share = await this.services.kvShare.mintKvHandle(
            actor,
            { ...fields, recipient: parseKvShareRecipient(body.recipient) },
            { defaultAccess: 'read' },
        );
        res.json(shareBody(share));
    }

    /**
     * GET /kv/shares — what this account has shared out, retired included
     * unless `state` narrows it.
     */
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
            ownerPageOptions(req),
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
