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
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import type {
    ResolvedShare,
    ShareRecipient,
    ShareTarget,
} from '../../services/share/ShareService.js';
import { expandTildePath } from '../../services/fs/resolveNode.js';
import { signEntryThumbnail } from '../fs/legacyFsHelpers.js';
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

/**
 * A success carries the created share; a failure carries why. `pending` is an
 * invite: recorded, but not access anyone holds yet.
 */
interface ShareOutcome {
    recipient: string;
    status: 'success' | 'error' | 'pending';
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
 *
 * Apps and tokens are admitted rather than gated out, because `ShareService`
 * bounds them properly: authority to share comes from the user behind the
 * actor, and the actor must additionally reach the node in its own right. An
 * app therefore shares its own AppData and the files it was given, and nothing
 * else its user happens to own.
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
        rateLimit: SHARE_LIMIT,
    })
    async createShares(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = this.#body(req);
        const recipients = this.#recipients(body);
        const items = this.#items(body, actor);
        const mode = typeof body.mode === 'string' ? body.mode : 'read';

        // Every (recipient, item) pair is a distinct (holder, entry) key, so
        // they can run together. Two writes to the *same* pair could not —
        // setUserUser is a read-modify-write, and a duplicated invite races
        // itself into two pending rows — so duplicates in the request execute
        // once and every original position reports that one outcome.
        const pairs = recipients.flatMap((recipient) =>
            items.map((item) => ({ recipient, item })),
        );
        const { unique, indexOf } = this.#dedupePairs(pairs);

        const settledUnique = await runWithConcurrencyLimitSettled(
            unique,
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
        const settled = indexOf.map((i) => settledUnique[i]);

        const results: ShareOutcome[] = await Promise.all(
            settled.map(async (outcome, index) => {
                const { recipient, item } = pairs[index];
                const label = recipient.email ?? recipient.username ?? '';
                if (outcome.status === 'fulfilled') {
                    // The whole share, not just an acknowledgement, so a caller
                    // needn't re-read to learn what it created.
                    const share = outcome.value as ResolvedShare;
                    return {
                        ...(await this.#toClientShare(share)),
                        recipient: label,
                        status: share.pending ? 'pending' : 'success',
                    };
                }
                return {
                    recipient: label,
                    ...(item.path ? { path: item.path } : {}),
                    status: 'error',
                    ...this.#errorShape(outcome.reason),
                };
            }),
        );

        // Off the response path: a share that landed must not be reported as
        // failed because telling the recipient didn't. Fanned out from the
        // unique outcomes, so a duplicated pair is not counted twice.
        void this.services.shareNotification.notifyShared(
            actor,
            settledUnique
                .filter((o) => o.status === 'fulfilled')
                .map((o) => (o as PromiseFulfilledResult<ResolvedShare>).value),
        );

        const succeeded = results.filter((r) => r.status !== 'error').length;
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

    /**
     * POST /share/revoke — withdraw recipients' access to items. Same fan-out
     * contract as POST /share: every (recipient, item) pair is its own revoke
     * with its own outcome. Silently dropping pairs after the first would leave
     * access standing that the caller believes is gone.
     */
    @Post('/revoke', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: SHARE_LIMIT,
    })
    async revokeShare(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = this.#body(req);
        const recipients = this.#recipients(body);
        const items = this.#items(body, actor);

        const pairs = recipients.flatMap((recipient) =>
            items.map((item) => ({ recipient, item })),
        );
        const { unique, indexOf } = this.#dedupePairs(pairs);

        const settledUnique = await runWithConcurrencyLimitSettled(
            unique,
            SHARE_CONCURRENCY,
            ({ recipient, item }) =>
                this.services.share.unshare(actor, { ...item, recipient }),
        );
        const settled = indexOf.map((i) => settledUnique[i]);

        // Totalled over the unique outcomes: a pair listed twice revoked its
        // grants once.
        const revoked = settledUnique.reduce(
            (total, outcome) =>
                outcome.status === 'fulfilled'
                    ? total + outcome.value.revoked
                    : total,
            0,
        );
        const results: ShareOutcome[] = settled.map((outcome, index) => {
            const { recipient, item } = pairs[index];
            const label = recipient.email ?? recipient.username ?? '';
            if (outcome.status === 'fulfilled') {
                return {
                    recipient: label,
                    ...(item.path ? { path: item.path } : {}),
                    ...(item.uid ? { uid: item.uid } : {}),
                    status: 'success',
                };
            }
            return {
                recipient: label,
                ...(item.path ? { path: item.path } : {}),
                ...(item.uid ? { uid: item.uid } : {}),
                status: 'error',
                ...this.#errorShape(outcome.reason),
            };
        });

        const succeeded = results.filter((r) => r.status === 'success').length;
        res.json({
            status:
                succeeded === results.length
                    ? 'success'
                    : succeeded > 0
                      ? 'mixed'
                      : 'aborted',
            revoked,
            results,
        });
    }

    /**
     * GET /share/shared-with-me — paginated listing of what others have shared
     * with the caller.
     */
    @Get('/shared-with-me', {
        subdomain: 'api',
        requireVerified: true,
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
            items: await Promise.all(
                page.items.map((share) => this.#toClientShare(share)),
            ),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        });
    }

    /** GET /share/shares — who can reach one item. */
    @Get('/shares', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: SHARE_LIST_LIMIT,
    })
    async listSharesOf(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = this.#query(req);
        const target: ShareTarget = {};
        if (typeof query.uid === 'string') target.uid = query.uid;
        if (typeof query.path === 'string')
            target.path = expandTildePath(query.path, actor.user?.username);
        if (!target.uid && !target.path) {
            throw new HttpError(400, 'one of `uid` or `path` is required', {
                legacyCode: 'bad_request',
            });
        }

        const shares = await this.services.share.listSharesOf(actor, target);
        res.json({
            items: await Promise.all(
                shares.map((share) => this.#toClientShare(share)),
            ),
        });
    }

    // -- Blocking -----------------------------------------------------

    /**
     * GET /share/blocks — who the caller is refusing shares from, and whether
     * they are refusing everyone.
     */
    @Get('/blocks', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: SHARE_LIST_LIMIT,
    })
    async listBlocks(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const { all, items } =
            await this.services.share.listBlockedSenders(actor);
        res.json({
            all,
            items: items.map((item) => ({
                username: item.username,
                created_at: item.createdAt,
            })),
        });
    }

    /**
     * POST /share/blocks — stop accepting shares. `{ all: true }` refuses
     * everyone; `{ username }` refuses one person. Idempotent either way:
     * blocking twice is the state the caller asked for.
     *
     * Access already granted is untouched — `POST /share/revoke` is what
     * withdraws that.
     */
    @Post('/blocks', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: SHARE_LIMIT,
    })
    async createBlock(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = this.#body(req);
        if (this.#isBlockAll(body)) {
            const { all } = await this.services.share.setBlockAllSenders(
                actor,
                true,
            );
            res.json({ all, blocked: true });
            return;
        }
        const { username, created } = await this.services.share.blockSender(
            actor,
            this.#username(body),
        );
        res.json({ username, blocked: true, created });
    }

    /**
     * DELETE /share/blocks — accept shares again. `{ all: true }` lifts the
     * blanket refusal, leaving the per-sender list as it was.
     */
    @Delete('/blocks', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: SHARE_LIMIT,
    })
    async deleteBlock(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const body = this.#body(req);
        if (this.#isBlockAll(body)) {
            const { all } = await this.services.share.setBlockAllSenders(
                actor,
                false,
            );
            res.json({ all, blocked: false });
            return;
        }
        const { username, unblocked } = await this.services.share.unblockSender(
            actor,
            this.#username(body),
        );
        res.json({ username, blocked: false, unblocked });
    }

    // -- Helpers ------------------------------------------------------

    /**
     * Collapse repeated (recipient, item) pairs to one execution. `indexOf`
     * maps every original position onto its unique pair, so a request that
     * names the same pair twice still gets a result in both positions — the
     * same result, which is the truth of what happened.
     */
    #dedupePairs<T extends { recipient: ShareRecipient; item: ShareTarget }>(
        pairs: T[],
    ): { unique: T[]; indexOf: number[] } {
        const unique: T[] = [];
        const seen = new Map<string, number>();
        const indexOf = pairs.map((pair) => {
            const key = JSON.stringify([
                pair.recipient.email ?? null,
                pair.recipient.username ?? null,
                pair.item.uid ?? null,
                pair.item.path ?? null,
            ]);
            let at = seen.get(key);
            if (at === undefined) {
                at = unique.length;
                seen.set(key, at);
                unique.push(pair);
            }
            return at;
        });
        return { unique, indexOf };
    }

    /**
     * Whether this call is about the blanket switch rather than one person.
     * Only the literal `true` counts, so a client sending `all: false`
     * alongside a username still means the username.
     */
    #isBlockAll(body: Record<string, unknown>): boolean {
        return body.all === true;
    }

    #username(body: Record<string, unknown>): string {
        const username =
            typeof body.username === 'string' ? body.username.trim() : '';
        if (!username) {
            throw new HttpError(400, '`username` is required', {
                legacyCode: 'bad_request',
            });
        }
        return username;
    }

    /**
     * Only ever the username — never the internal id, and never an email the
     * caller didn't already supply.
     *
     * `thumbnail` is stored as an `s3://bucket/key` URI, so it is swapped for a
     * signed URL rather than emitted: the raw value names internal storage and
     * no client can render it.
     */
    async #toClientShare(share: ResolvedShare) {
        const thumbnail =
            share.thumbnail === undefined
                ? undefined
                : await signEntryThumbnail(
                      this.clients.event,
                      share.entryUid,
                      share.thumbnail,
                  );
        return {
            uid: share.uid,
            mode: share.mode,
            path: share.path,
            // A share listing has no fsentry behind it for a client to stat.
            ...(share.name === undefined ? {} : { name: share.name }),
            ...(share.type === undefined ? {} : { type: share.type }),
            ...(thumbnail === undefined ? {} : { thumbnail }),
            ...(share.owner === undefined
                ? {}
                : { owner: share.owner.username }),
            ...(share.pending
                ? { pending: true, recipient_email: share.recipientEmail }
                : {}),
            uid_entry: share.entryUid,
            is_dir: share.isDir,
            issuer: share.issuer.username,
            holder: share.holder.username,
            created_at: share.createdAt,
            issued_by_app: share.issuedByApp ?? null,
            inherited_from: share.inheritedFrom ?? null,
            modified: share.modified,
            size: share.size,
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

    #items(body: Record<string, unknown>, actor: Actor): ShareTarget[] {
        const username = actor.user?.username;
        const raw = body.items ?? body.item ?? body.path ?? body.uid;
        const list = Array.isArray(raw) ? raw : [raw];
        const out: ShareTarget[] = [];
        for (const entry of list) {
            if (typeof entry === 'string') {
                const value = entry.trim();
                if (!value) continue;
                // Tilde-rooted strings are paths, as the legacy FS routes treat them.
                const isPath = value.startsWith('/') || value.startsWith('~');
                out.push(
                    isPath
                        ? { path: expandTildePath(value, username) }
                        : { uid: value },
                );
                continue;
            }
            if (entry && typeof entry === 'object') {
                const item = entry as Record<string, unknown>;
                const path =
                    typeof item.path === 'string'
                        ? expandTildePath(item.path, username)
                        : '';
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
        if (!isHttpError(reason) || reason.statusCode >= 500) {
            return { message: 'Request failed' };
        }
        const code = reason.legacyCode ?? reason.code;
        return {
            message: reason.message || 'Request failed',
            ...(code ? { code } : {}),
        };
    }
}
