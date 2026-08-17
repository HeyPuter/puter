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

import { createHash } from 'node:crypto';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { Actor } from '../../core/actor';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import {
    mergeShareSender,
    shareNotifyCount,
    shareNotifyTitle,
    shareSendersFromFields,
    type ShareSender,
} from './shareNotifyTitle';
import type { ResolvedShare } from './ShareService';

/**
 * How long one sharer stays quiet after reaching a recipient, and how long a
 * recipient's notification keeps absorbing new shares.
 */
export const SHARE_NOTIFY_WINDOW_SECONDS = 15 * 60;

/** Times one sharer may interrupt the same recipient in a day. */
export const SHARE_NOTIFY_PAIR_DAILY_LIMIT = 20;

/** Times a recipient may be interrupted per hour, whoever it is from. */
export const SHARE_NOTIFY_RECIPIENT_HOURLY_LIMIT = 10;

/** Same, over a day. */
export const SHARE_NOTIFY_RECIPIENT_DAILY_LIMIT = 50;

/** How far back to look for the notification a new share folds into. */
const OPEN_NOTIFICATION_SCAN = 20;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Notifications this service folds shares into. */
const SHARE_TEMPLATE = 'file-shared-with-you';

/** Kept distinct from `SHARE_TEMPLATE` so grouping never rewrites it. */
const CLAIM_TEMPLATE = 'file-shared-before-you-joined';

/** A budget: a key, how many are allowed, and over what window. */
type Budget = [key: string, limit: number, windowMs: number];

/**
 * Telling people what has been shared with them. Separate from `ShareService`
 * because sharing succeeds or fails on its own; being told is best-effort and
 * always off the response path.
 *
 * Two decisions per share: what the recipient's notification _says_ is always
 * kept current, while whether it may _interrupt_ them — pushed to their screen,
 * mailed to them — is budgeted, since that is the part that can bury someone.
 */
export class ShareNotificationService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    /**
     * Announce a batch of shares, one notification per recipient — five items
     * for one person is one notification, not five. Never throws: a share that
     * landed must not be reported as failed because the announcement wasn't.
     *
     * Only shares that created new reach count; a mode change is not worth
     * interrupting anyone for.
     */
    async notifyShared(actor: Actor, shares: ResolvedShare[]): Promise<void> {
        const issuerId = actor.user?.id;
        const issuer = actor.user?.username;
        if (typeof issuerId !== 'number') return;

        const counts = new Map<number, number>();
        const named = new Map<number, string>();
        for (const share of shares) {
            if (share.pending) continue;
            if (!share.isNew || !share.holderId) continue;
            if (share.holderId === issuerId) continue;
            counts.set(share.holderId, (counts.get(share.holderId) ?? 0) + 1);
            if (share.name) named.set(share.holderId, share.name);
        }

        // Each recipient fails alone: one refused SMTP send must not cost the
        // next person their notification, or the invites their announcement.
        // Best-effort still — failures are logged, never thrown.
        await Promise.allSettled(
            [...counts].map(async ([holderId, count]) => {
                try {
                    const interrupt = await this.#claimInterruption(
                        issuerId,
                        holderId,
                    );
                    await this.#announce(holderId, issuer, count, interrupt);
                    if (!interrupt) return;
                    await this.#emailHolder(
                        holderId,
                        issuer,
                        count,
                        named.get(holderId),
                    );
                } catch (err) {
                    console.warn(
                        '[share-notify] could not announce to user',
                        holderId,
                        err,
                    );
                }
            }),
        );

        try {
            await this.#emailInvites(actor, shares);
        } catch (err) {
            console.warn('[share-notify] could not email invites:', err);
        }
    }

    /**
     * Fold this batch into the notification the recipient hasn't dealt with, or
     * start one. Written either way — a suppressed interruption must not lose
     * the share — so `interrupt` gates only the push.
     */
    async #announce(
        holderId: number,
        issuer: string | undefined,
        count: number,
        interrupt: boolean,
    ): Promise<void> {
        const silent = !interrupt;
        const open = await this.#openShareNotification(holderId);

        if (open) {
            const folded = this.#payload(
                issuer,
                mergeShareSender(open.senders, issuer, count),
                open.groupUntil,
            );
            if (
                await this.services.notification.notifyUpdate(
                    open.uid,
                    holderId,
                    folded,
                    { silent },
                )
            ) {
                return;
            }
            // Dismissed between the read and the write — fall through and start
            // a fresh group rather than reviving what they just cleared.
        }

        await this.services.notification.notify(
            [holderId],
            this.#payload(
                issuer,
                mergeShareSender([], issuer, count),
                Date.now() + this.#limits().pairWindowSeconds * 1000,
            ),
            { silent },
        );
    }

    /**
     * `groupUntil` is when this notification stops absorbing shares. Carried on
     * the payload rather than derived from `created_at`, whose type differs per
     * dialect, and kept as the group grows so a busy hour still closes it on
     * schedule.
     */
    #payload(
        issuer: string | undefined,
        senders: ShareSender[],
        groupUntil: number,
    ): Record<string, unknown> {
        return {
            source: 'sharing',
            title: shareNotifyTitle(senders),
            template: SHARE_TEMPLATE,
            // `username` and `count` are the pre-grouping shape, kept for
            // anything still reading it; `senders` is what the title is from.
            fields: {
                username: issuer,
                count: shareNotifyCount(senders),
                senders,
                groupUntil,
            },
        };
    }

    /** The share notification still open for more, if there is one. */
    async #openShareNotification(holderId: number): Promise<{
        uid: string;
        senders: ShareSender[];
        groupUntil: number;
    } | null> {
        const rows = await this.stores.notification.listByUserId(holderId, {
            filter: 'unacknowledged',
            limit: OPEN_NOTIFICATION_SCAN,
        });

        for (const row of rows) {
            const value = (row?.value ?? {}) as {
                template?: unknown;
                fields?: { groupUntil?: unknown };
            };
            if (value.template !== SHARE_TEMPLATE || !row?.uid) continue;

            // Newest first, so the first share notification is the only
            // candidate: if its group has closed, every older one's has too.
            const groupUntil = Number(value.fields?.groupUntil);
            if (!Number.isFinite(groupUntil) || groupUntil <= Date.now()) {
                return null;
            }
            return {
                uid: String(row.uid),
                senders: shareSendersFromFields(value.fields),
                groupUntil,
            };
        }
        return null;
    }

    /**
     * Whether this share may interrupt the recipient at all.
     *
     * Both axes matter: the pair budget stops one person nagging, and the
     * recipient budget bounds the noise a pair limit can't, since twenty
     * accounts would each spend a full one on the same person. Fails open,
     * because one notification too many beats going silent.
     *
     * Order carries the cost of refusal: `checkRateLimit` records the hit as it
     * allows, with no refund, so every budget after the refusing one stays
     * unspent — and each earlier one paid for an interruption that never
     * happened. The pair window leads (it refuses most, and what it burns
     * self-expires in minutes, while letting a re-sharing pair drain the
     * recipient's budgets would mute everyone else). The pair-day budget goes
     * last for the same reason in reverse: burning a day-scale token because
     * the _recipient_ was saturated would let twenty refusals mute a sender's
     * first-ever contact for the rest of the day.
     */
    async #claimInterruption(
        issuerId: number,
        holderId: number,
    ): Promise<boolean> {
        const limits = this.#limits();
        return this.#withinBudget([
            [
                `share:notify:pair:${issuerId}:${holderId}`,
                1,
                limits.pairWindowSeconds * 1000,
            ],
            [`share:notify:to:${holderId}`, limits.recipientHourly, HOUR_MS],
            [`share:notify:to-day:${holderId}`, limits.recipientDaily, DAY_MS],
            [
                `share:notify:pair-day:${issuerId}:${holderId}`,
                limits.pairDaily,
                DAY_MS,
            ],
        ]);
    }

    /**
     * The same question for an address with no account, in the same order for
     * the same reasons. Keyed on the canonical form, so `foo+1@` and `foo+2@`
     * can't each buy a budget, and hashed to keep addresses out of cache keys.
     */
    async #claimInviteEmail(issuerId: number, email: string): Promise<boolean> {
        const limits = this.#limits();
        const to = this.#addressKey(email);
        return this.#withinBudget([
            [
                `share:notify:invite:${issuerId}:${to}`,
                1,
                limits.pairWindowSeconds * 1000,
            ],
            [`share:notify:to-addr:${to}`, limits.recipientHourly, HOUR_MS],
            [`share:notify:to-addr-day:${to}`, limits.recipientDaily, DAY_MS],
            [
                `share:notify:invite-day:${issuerId}:${to}`,
                limits.pairDaily,
                DAY_MS,
            ],
        ]);
    }

    /** All bounds hold. A non-positive limit removes its bound, as elsewhere. */
    async #withinBudget(budgets: Budget[]): Promise<boolean> {
        for (const [key, limit, windowMs] of budgets) {
            if (limit <= 0) continue;
            if (!(await checkRateLimit(key, limit, windowMs))) return false;
        }
        return true;
    }

    #addressKey(email: string): string {
        const canonical = this.clients.email.clean(email.trim().toLowerCase());
        return createHash('sha256')
            .update(canonical)
            .digest('hex')
            .slice(0, 32);
    }

    #limits(): {
        pairWindowSeconds: number;
        pairDaily: number;
        recipientHourly: number;
        recipientDaily: number;
    } {
        const configured = this.config.share_notify_limits ?? {};
        return {
            pairWindowSeconds:
                configured.pairWindowSeconds ?? SHARE_NOTIFY_WINDOW_SECONDS,
            pairDaily: configured.pairDaily ?? SHARE_NOTIFY_PAIR_DAILY_LIMIT,
            recipientHourly:
                configured.recipientHourly ??
                SHARE_NOTIFY_RECIPIENT_HOURLY_LIMIT,
            recipientDaily:
                configured.recipientDaily ?? SHARE_NOTIFY_RECIPIENT_DAILY_LIMIT,
        };
    }

    /**
     * Email an existing recipient. Off by default: with no per-user preference
     * yet, nobody could decline.
     */
    async #emailHolder(
        holderId: number,
        issuer: string | undefined,
        count: number,
        itemName: string | undefined,
    ): Promise<void> {
        if (!this.config.share_email_notifications) return;
        if (!this.clients.email.isConfigured) return;

        const holder = await this.stores.user.getById(holderId);
        const to = holder?.email;
        if (!to || !holder?.email_confirmed) return;
        if (!(await this.clients.email.validate(to))) return;

        await this.clients.email.send(to, 'file_shared_with_you', {
            recipient: holder.username,
            issuer,
            count,
            multiple: count > 1,
            item_name: itemName ?? 'an item',
            link: this.#appLink(),
        });
    }

    /**
     * Email an address with no account. Sent whatever
     * `share_email_notifications` says — there is no Puter inbox to use instead
     * — but still budgeted: an invite reaches someone who never asked for it.
     */
    async #emailInvites(actor: Actor, shares: ResolvedShare[]): Promise<void> {
        if (!this.clients.email.isConfigured) return;
        const issuerId = actor.user?.id;
        if (typeof issuerId !== 'number') return;

        const byEmail = new Map<string, { count: number; name?: string }>();
        for (const share of shares) {
            if (!share.pending || !share.isNew || !share.recipientEmail) {
                continue;
            }
            const seen = byEmail.get(share.recipientEmail) ?? { count: 0 };
            seen.count += 1;
            seen.name ??= share.name;
            byEmail.set(share.recipientEmail, seen);
        }
        if (byEmail.size === 0) return;

        const issuer = actor.user?.username;
        for (const [to, { count, name }] of byEmail) {
            // Each address fails alone — one refused send must not cost the
            // next invitee their only channel.
            try {
                if (!(await this.clients.email.validate(to))) continue;
                if (!(await this.#claimInviteEmail(issuerId, to))) continue;
                await this.clients.email.send(to, 'file_shared_invite', {
                    email: to,
                    issuer,
                    count,
                    multiple: count > 1,
                    item_name: name ?? 'an item',
                    link: this.#appLink(),
                });
            } catch (err) {
                console.warn('[share-notify] invite email failed:', err);
            }
        }
    }

    /**
     * What was waiting once they confirmed their address — one notification for
     * the lot, since several people may have shared with it.
     */
    async notifyClaimed(
        holderId: number,
        shares: ResolvedShare[],
    ): Promise<void> {
        if (shares.length === 0) return;
        try {
            const count = shares.length;
            await this.services.notification.notify([holderId], {
                source: 'sharing',
                title: `${count === 1 ? 'An item was' : `${count} items were`} shared with you before you joined`,
                template: CLAIM_TEMPLATE,
                fields: { count },
            });
        } catch {
            // Best-effort by design; see the class comment.
        }
    }

    /**
     * `config.origin` is what every other email link uses, and it carries the
     * port — re-deriving from protocol and domain sent self-hosters' "Open it
     * on Puter" links to an address nothing answers on.
     */
    #appLink(): string {
        return (
            this.config.origin ??
            `${this.config.protocol ?? 'http'}://${this.config.domain ?? 'puter.com'}`
        );
    }
}
