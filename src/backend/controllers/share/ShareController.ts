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
import { Controller, Get, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import type {
    ResolvedShare,
    ShareRecipient,
    ShareTarget,
} from '../../services/share/ShareService.js';
import { runWithConcurrencyLimitSettled } from '../../util/concurrency.js';
import { normalizeLimit } from '../../util/pagination.js';
import { PuterController } from '../types.js';

/**
 * Two windows: a burst ceiling, and a daily one so a slow drip can't add up to
 * a mail-merge. Neither bounds _shares_ — one request carries many — which is
 * what `ShareService`'s per-day quota is for.
 */
const SHARE_LIMIT = [
    { scope: 'share:mutate', limit: 60, window: 60_000, key: 'user' as const },
    {
        scope: 'share:mutate-daily',
        limit: 500,
        window: 24 * 60 * 60_000,
        key: 'user' as const,
    },
];

const SHARE_LIST_LIMIT = {
    scope: 'share:list',
    limit: 600,
    window: 60_000,
    key: 'user' as const,
};

/** Distinct (holder, item) pairs run together; see the note on grouping below. */
const SHARE_CONCURRENCY = 8;
const LIST_LIMIT_CAP = 200;

/**
 * Caps on one request's fan-out. Recipients matter most: that number is how
 * many people a single call can reach, so it stays small by default and only
 * moves by configuration.
 */
export const DEFAULT_MAX_RECIPIENTS = 10;
export const DEFAULT_MAX_ITEMS = 50;

/** A success carries the created share; a failure carries why. */
interface ShareOutcome {
    recipient: string;
    status: 'success' | 'error';
    path?: string;
    uid?: string;
    mode?: string;
    uid_entry?: string;
    is_dir?: boolean;
    issuer?: string | null;
    holder?: string | null;
    created_at?: unknown;
    message?: string;
    code?: string;
}

/**
 * Sharing endpoints. `ShareService` owns the semantics; this layer parses
 * input, bounds fan-out, and shapes responses.
 */
@Controller('/share')
export class ShareController extends PuterController {
    /**
     * POST /share — grant `mode` on one or more items to one or more
     * recipients. Partial success is the contract: each pair reports its own
     * outcome and the envelope summarizes.
     */
    @Post('', {
        subdomain: 'api',
        requireVerified: true,
        requireUserActor: true,
        rateLimit: SHARE_LIMIT,
    })
    async createShares(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = this.#body(req);
        const recipients = this.#recipients(body);
        const items = this.#items(body);
        const mode = typeof body.mode === 'string' ? body.mode : 'read';

        // Every (recipient, item) pair is a distinct (holder, entry) key, so
        // they can run together. Two writes to the *same* pair could not —
        // setUserUser is a read-modify-write.
        const pairs = recipients.flatMap((recipient) =>
            items.map((item) => ({ recipient, item })),
        );

        const settled = await runWithConcurrencyLimitSettled(
            pairs,
            SHARE_CONCURRENCY,
            async ({ recipient, item }) => {
                const share = await this.services.share.share(actor, {
                    ...item,
                    recipient,
                    mode: mode as never,
                });
                return share;
            },
        );

        const results: ShareOutcome[] = settled.map((outcome, index) => {
            const { recipient, item } = pairs[index];
            const label = recipient.email ?? recipient.username ?? '';
            if (outcome.status === 'fulfilled') {
                // The whole share, not just an acknowledgement, so a caller
                // needn't re-read to learn what it created.
                const share = outcome.value as ResolvedShare;
                return {
                    ...this.#toClientShare(share),
                    recipient: label,
                    status: 'success',
                };
            }
            return {
                recipient: label,
                ...(item.path ? { path: item.path } : {}),
                status: 'error',
                ...this.#errorShape(outcome.reason),
            };
        });

        this.#notifyRecipients(actor, settled, pairs);

        const succeeded = results.filter((r) => r.status === 'success').length;
        res.json({
            status:
                succeeded === results.length
                    ? 'success'
                    : succeeded > 0
                      ? 'mixed'
                      : 'aborted',
            results,
        });
    }

    /** POST /share/revoke — withdraw a recipient's access to an item. */
    @Post('/revoke', {
        subdomain: 'api',
        requireVerified: true,
        requireUserActor: true,
        rateLimit: SHARE_LIMIT,
    })
    async revokeShare(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = this.#body(req);
        const [recipient] = this.#recipients(body);
        const [item] = this.#items(body);

        const result = await this.services.share.unshare(actor, {
            ...item,
            recipient,
        });
        res.json({ status: 'success', revoked: result.revoked });
    }

    /**
     * GET /share/shared-with-me — paginated listing of what others have shared
     * with the caller.
     */
    @Get('/shared-with-me', {
        subdomain: 'api',
        requireVerified: true,
        requireUserActor: true,
        rateLimit: SHARE_LIST_LIMIT,
    })
    async listSharedWithMe(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = this.#query(req);

        const page = await this.services.share.listSharedWithMe(actor, {
            limit: normalizeLimit(query.limit, { cap: LIST_LIMIT_CAP }),
            cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
            includeTotal: query.includeTotal === 'true',
        });

        res.json({
            items: page.items.map((share) => this.#toClientShare(share)),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        });
    }

    /** GET /share/shares — who can reach one item. */
    @Get('/shares', {
        subdomain: 'api',
        requireVerified: true,
        requireUserActor: true,
        rateLimit: SHARE_LIST_LIMIT,
    })
    async listSharesOf(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = this.#query(req);
        const target: ShareTarget = {};
        if (typeof query.uid === 'string') target.uid = query.uid;
        if (typeof query.path === 'string') target.path = query.path;
        if (!target.uid && !target.path) {
            throw new HttpError(400, 'one of `uid` or `path` is required', {
                legacyCode: 'bad_request',
            });
        }

        const shares = await this.services.share.listSharesOf(actor, target);
        res.json({ items: shares.map((share) => this.#toClientShare(share)) });
    }

    // -- Helpers ------------------------------------------------------

    /**
     * Only ever the username — never the internal id, and never an email the
     * caller didn't already supply.
     */
    #toClientShare(share: ResolvedShare) {
        return {
            uid: share.uid,
            mode: share.mode,
            path: share.path,
            uid_entry: share.entryUid,
            is_dir: share.isDir,
            issuer: share.issuer.username,
            holder: share.holder.username,
            created_at: share.createdAt,
            inherited_from: share.inheritedFrom ?? null,
        };
    }

    #requireActor(req: Request): Actor {
        const actor = req.actor;
        if (!actor?.user)
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        return actor;
    }

    #body(req: Request): Record<string, unknown> {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new HttpError(400, 'body must be an object', {
                legacyCode: 'bad_request',
            });
        }
        return body as Record<string, unknown>;
    }

    #query(req: Request): Record<string, unknown> {
        return (req.query ?? {}) as Record<string, unknown>;
    }

    #recipients(body: Record<string, unknown>): ShareRecipient[] {
        const raw = body.recipients ?? body.recipient;
        const list = Array.isArray(raw) ? raw : [raw];
        const out: ShareRecipient[] = [];
        for (const entry of list) {
            if (typeof entry === 'string') {
                const value = entry.trim();
                if (!value) continue;
                out.push(
                    value.includes('@')
                        ? { email: value }
                        : { username: value },
                );
                continue;
            }
            if (entry && typeof entry === 'object') {
                const rec = entry as Record<string, unknown>;
                const email =
                    typeof rec.email === 'string' ? rec.email.trim() : '';
                const username =
                    typeof rec.username === 'string' ? rec.username.trim() : '';
                if (email || username) {
                    out.push(email ? { email } : { username });
                }
            }
        }
        if (out.length === 0) {
            throw new HttpError(400, '`recipients` is required', {
                legacyCode: 'bad_request',
            });
        }
        const max = this.config.share_max_recipients ?? DEFAULT_MAX_RECIPIENTS;
        if (out.length > max) {
            throw new HttpError(400, `at most ${max} recipients per request`, {
                legacyCode: 'too_many_recipients',
            });
        }
        return out;
    }

    #items(body: Record<string, unknown>): ShareTarget[] {
        const raw = body.items ?? body.item ?? body.path ?? body.uid;
        const list = Array.isArray(raw) ? raw : [raw];
        const out: ShareTarget[] = [];
        for (const entry of list) {
            if (typeof entry === 'string') {
                const value = entry.trim();
                if (!value) continue;
                out.push(
                    value.startsWith('/') ? { path: value } : { uid: value },
                );
                continue;
            }
            if (entry && typeof entry === 'object') {
                const item = entry as Record<string, unknown>;
                const path = typeof item.path === 'string' ? item.path : '';
                const uid = typeof item.uid === 'string' ? item.uid : '';
                if (path || uid) out.push(path ? { path } : { uid });
            }
        }
        if (out.length === 0) {
            throw new HttpError(400, '`items` is required', {
                legacyCode: 'bad_request',
            });
        }
        const max = this.config.share_max_items ?? DEFAULT_MAX_ITEMS;
        if (out.length > max) {
            throw new HttpError(400, `at most ${max} items per request`, {
                legacyCode: 'too_many_items',
            });
        }
        return out;
    }

    /**
     * Report a failure without widening what the caller already knew. The
     * service already decides 404-vs-403; anything unrecognized becomes a
     * generic error rather than leaking an internal message.
     */
    #errorShape(reason: unknown): { message: string; code?: string } {
        const err = reason as {
            statusCode?: number;
            message?: string;
            fields?: { code?: string };
        };
        if (typeof err?.statusCode === 'number' && err.statusCode < 500) {
            return {
                message: err.message ?? 'Request failed',
                ...(err.fields?.code ? { code: err.fields.code } : {}),
            };
        }
        return { message: 'Request failed' };
    }

    /**
     * One notification per recipient who gained access, off the response path —
     * a share must not fail because its notification didn't land.
     */
    #notifyRecipients(
        actor: Actor,
        settled: PromiseSettledResult<unknown>[],
        pairs: Array<{ recipient: ShareRecipient; item: ShareTarget }>,
    ): void {
        const byRecipient = new Map<string, number>();
        settled.forEach((outcome, index) => {
            if (outcome.status !== 'fulfilled') return;
            const label =
                pairs[index].recipient.email ??
                pairs[index].recipient.username ??
                '';
            byRecipient.set(label, (byRecipient.get(label) ?? 0) + 1);
        });
        if (byRecipient.size === 0) return;

        void (async () => {
            try {
                for (const [label, count] of byRecipient) {
                    const user = label.includes('@')
                        ? await this.stores.user.getByEmail(label)
                        : await this.stores.user.getByUsername(label);
                    if (!user) continue;
                    await this.services.notification.notify([user.id], {
                        source: 'sharing',
                        title: `${actor.user.username} shared ${count === 1 ? 'an item' : `${count} items`} with you`,
                        template: 'file-shared-with-you',
                        fields: { username: actor.user.username, count },
                    });
                }
            } catch {
                // Never fail a completed share over its notification.
            }
        })();
    }
}
