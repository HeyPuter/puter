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

import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../core/actor';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import { PuterService } from '../types';
import {
    digestItemPaths,
    digestLines,
    digestSubject,
    mergeDigestEntry,
    mergeShareSender,
    shareNotifyCount,
    shareNotifyTitle,
    shareSendersFromFields,
    type DigestEntry,
    type DigestItem,
    type ShareSender,
} from './shareNotifyTitle';
import {
    maskedSharePath,
    ownerFromSharePath,
    shareDeepLink,
    sharedViewLink,
} from './shareDeepLink';
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

/**
 * How long emails to one recipient are held so that everything triggered in the
 * span goes as a single message. Email can't be rewritten the way the in-app
 * notification can, so it gets the grouped wording by waiting instead.
 */
export const SHARE_EMAIL_BATCH_SECONDS = 30;

// Long enough to list, claim and send; short enough that a crashed flusher
// doesn't strand the digest.
const DIGEST_LOCK_SECONDS = 20;

// Ceiling on how long an entry may sit unflushed: a node dying with the only
// timer leaves entries behind, and mail this stale is noise rather than news.
const DIGEST_ENTRY_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long past its window an entry must sit before the sweep treats it as
 * orphaned.
 *
 * The sweep exists for entries whose timer died with the node that armed it,
 * and only the owning node can tell the difference between that and a timer
 * about to fire. Claiming an entry is exclusive only among flushers that can
 * see each other's deletes, so a sweep racing a live timer elsewhere can send
 * the same digest twice. Waiting gives the owner first refusal, and costs a
 * genuinely stranded digest only this much delay.
 */
const DIGEST_SWEEP_GRACE_MS = 5 * 60_000;

/**
 * Entries one listing carries. A recipient over this in a single window has the
 * rest picked up by the next pass rather than dropped, but the cap is logged
 * either way — a silent truncation here reads as "nothing left to send".
 */
const DIGEST_LIST_LIMIT = 200;

/** Names carried per sender; the wording counts the rest. */
const DIGEST_NAMES_PER_SENDER = 5;

/** How far back to look for the notification a new share folds into. */
const OPEN_NOTIFICATION_SCAN = 20;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Notifications this service folds shares into. */
const SHARE_TYPE = 'share.received';

/**
 * The `template` marker `SHARE_TYPE` rows carried before the type registry.
 * Still matched when looking for an open group, so a notification written by
 * the previous release still absorbs today's shares.
 */
const LEGACY_SHARE_TEMPLATE = 'file-shared-with-you';

/** A budget: a key, how many are allowed, and over what window. */
type Budget = [key: string, limit: number, windowMs: number];

/**
 * Why a recipient heard nothing. Every gate on this path is a deliberate early
 * return, so without a line each they are indistinguishable from a lost email
 * once it's running somewhere you can't attach a debugger to.
 */
const skipped = (reason: string, detail: Record<string, unknown>): void => {
    console.log('[share-notify] not emailing:', reason, detail);
};

/**
 * Telling people what has been shared with them. Separate from `ShareService`
 * because sharing succeeds or fails on its own; being told is best-effort and
 * always off the response path.
 *
 * Two decisions per share: what the recipient's notification _says_ is always
 * kept current, while whether it may _interrupt_ them — pushed to their screen,
 * mailed to them — is budgeted, since that is the part that can bury someone.
 */
/** Where a single-item notification points; a masked path, opened in place. */
interface ShareNotificationTarget {
    path: string;
    name: string;
}

/**
 * A queued send's durable form: persisted to KV so it survives the node that
 * queued it and is visible to every other node's flush.
 */
interface DigestEntryRecord {
    kind: 'holder' | 'invite';
    to: string;
    /** Holder's username, for the greeting. Absent for invites. */
    recipient?: string;
    /** Holder's uuid, so the digest can carry their unsubscribe link. */
    recipientUuid?: string;
    sender?: string;
    count: number;
    names: string[];
    /** As `names`, plus links. Absent on records queued before this shipped. */
    items?: DigestItem[];
    /** Arrival order — KV lists by key, which is a uuid and says nothing. */
    queuedAt: number;
}

export class ShareNotificationService extends PuterService {
    /**
     * The flush timers this node owns, keyed per recipient. Timers only — the
     * queued sends live in KV, where any node's flush can pick them up.
     */
    #digestTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /** The recovery sweep; see `onServerStart`. */
    #digestSweep: ReturnType<typeof setInterval> | null = null;

    /**
     * Recover digests whose timer died with the node that armed it — a restart,
     * a rolling deploy, or a SIGKILL that never reached the drain below. The
     * entries are in KV, so any node can finish them; without this sweep they
     * would sit there until their TTL and nobody would ever be told.
     */
    override onServerStart(): void {
        const every = Math.max(30, this.#limits().emailBatchSeconds) * 1000;
        const sweep = setInterval(() => {
            void this.#sweepDigests();
        }, every);
        sweep.unref?.();
        this.#digestSweep = sweep;
    }

    /** Send what's still waiting while the transport is alive to send it. */
    override async onServerPrepareShutdown(): Promise<void> {
        if (this.#digestSweep) clearInterval(this.#digestSweep);
        this.#digestSweep = null;
        const keys = [...this.#digestTimers.keys()];
        for (const [, timer] of this.#digestTimers) clearTimeout(timer);
        this.#digestTimers.clear();
        await Promise.all(keys.map((key) => this.#flushDigest(key)));
    }

    /** The recovery sweep, for tests that can't wait out an interval. */
    async sweepForTests(): Promise<void> {
        await this.#sweepDigests();
    }

    /**
     * Flush every digest whose window has elapsed and which no node here is
     * still holding a timer for. Cheap: one prefix listing, and the lock plus
     * `take` make a premature or duplicated sweep harmless.
     */
    async #sweepDigests(): Promise<void> {
        try {
            const { res } = await this.stores.kv.list({
                as: 'entries',
                pattern: 'share:digest:',
                limit: DIGEST_LIST_LIMIT,
            });
            const listed = (
                Array.isArray(res)
                    ? res
                    : ((res as { items?: unknown[] })?.items ?? [])
            ) as Array<{ key: string; value: unknown }>;
            if (listed.length === 0) return;
            if (listed.length >= DIGEST_LIST_LIMIT) {
                console.log('[share-notify] sweep listing hit its cap:', {
                    limit: DIGEST_LIST_LIMIT,
                });
            }

            const staleAfterMs =
                this.#limits().emailBatchSeconds * 1000 + DIGEST_SWEEP_GRACE_MS;
            const due = new Set<string>();
            for (const entry of listed) {
                const key = entry.key.slice(
                    'share:digest:'.length,
                    entry.key.lastIndexOf(':'),
                );
                if (!key || this.#digestTimers.has(key)) continue;
                const queuedAt = Number(
                    (entry.value as DigestEntryRecord | null)?.queuedAt ?? 0,
                );
                if (Date.now() - queuedAt < staleAfterMs) continue;
                due.add(key);
            }
            if (due.size === 0) return;

            console.log('[share-notify] sweeping orphaned digests:', {
                count: due.size,
            });
            for (const key of due) await this.#flushDigest(key);
        } catch (err) {
            console.warn('[share-notify] digest sweep failed:', err);
        }
    }

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
        const named = new Map<number, DigestItem[]>();
        const targets = new Map<number, ShareNotificationTarget | null>();
        for (const share of shares) {
            if (share.pending) continue;
            if (!share.isNew || !share.holderId) continue;
            if (share.holderId === issuerId) continue;
            counts.set(share.holderId, (counts.get(share.holderId) ?? 0) + 1);
            const item = this.#digestItem(share);
            if (item) {
                const items = named.get(share.holderId) ?? [];
                if (items.length < DIGEST_NAMES_PER_SENDER) items.push(item);
                named.set(share.holderId, items);
            }
            // Only a lone item is worth pointing at; a second nulls it.
            const path = this.#targetPath(share);
            targets.set(
                share.holderId,
                targets.has(share.holderId) || !path
                    ? null
                    : { path, name: share.name as string },
            );
        }

        // Each recipient fails alone: one refused send must not cost the next
        // person their notification. Failures are logged, never thrown.
        await Promise.allSettled(
            [...counts].map(async ([holderId, count]) => {
                try {
                    const interrupt = await this.#claimInterruption(
                        issuerId,
                        holderId,
                    );
                    await this.#announce(
                        holderId,
                        issuer,
                        count,
                        interrupt,
                        targets.get(holderId) ?? null,
                    );
                    await this.#emailHolder(
                        holderId,
                        issuer,
                        count,
                        named.get(holderId) ?? [],
                        interrupt,
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
        target: ShareNotificationTarget | null,
    ): Promise<void> {
        const silent = !interrupt;
        const open = await this.#openShareNotification(holderId);

        if (open) {
            // Folding means the group now covers more than one item, so no
            // single target describes it — the click goes to Shared instead.
            const folded = this.#payload(
                issuer,
                mergeShareSender(open.senders, issuer, count),
                open.groupUntil,
                null,
            );
            if (
                await this.services.notification.notifyUpdate(
                    open.uid,
                    holderId,
                    folded,
                    { type: SHARE_TYPE, silent },
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
                count === 1 ? target : null,
            ),
            { type: SHARE_TYPE, silent },
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
        target: ShareNotificationTarget | null,
    ): Record<string, unknown> {
        return {
            title: shareNotifyTitle(senders),
            // `username` and `count` are the pre-grouping shape, kept for
            // anything still reading it; `senders` is what the title is from.
            fields: {
                username: issuer,
                count: shareNotifyCount(senders),
                senders,
                groupUntil,
                // A masked path, not a URL: the GUI opens it in place.
                ...(target ? { target } : {}),
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
            const isOpenShare =
                row?.type === SHARE_TYPE ||
                value.template === LEGACY_SHARE_TEMPLATE;
            if (!isOpenShare || !row?.uid) continue;

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
     * Whether this share may interrupt the recipient at all. The pair budget
     * stops one person nagging; the recipient budget bounds the total noise.
     * Fails open — one notification too many beats going silent.
     *
     * Order matters because `checkRateLimit` records on allow with no refund:
     * budgets after the refusing one stay unspent. The pair window leads (it
     * refuses most, and its token self-expires in minutes); pair-day goes last
     * so a saturated recipient can't burn a sender's day-scale budget.
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
        emailBatchSeconds: number;
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
            emailBatchSeconds:
                configured.emailBatchSeconds ?? SHARE_EMAIL_BATCH_SECONDS,
        };
    }

    /**
     * Email a recipient who already has an account. On unless configuration
     * says otherwise: they decline with the unsubscribe link the mail carries,
     * or by blocking the sender.
     */
    async #emailHolder(
        holderId: number,
        issuer: string | undefined,
        count: number,
        items: DigestItem[],
        mayOpen: boolean,
    ): Promise<void> {
        // Explicitly false, not falsy: unset means on.
        if (this.config.share_email_notifications === false) {
            skipped('share_email_notifications is off', { holderId });
            return;
        }
        if (!this.config.email) {
            skipped('no email transport configured', { holderId });
            return;
        }

        const holder = await this.stores.user.getById(holderId);
        const to = holder?.email;
        if (!to || !holder?.email_confirmed) {
            skipped('recipient has no confirmed address', {
                holderId,
                hasAddress: Boolean(to),
                confirmed: Boolean(holder?.email_confirmed),
            });
            return;
        }
        // The account-wide opt-out every other transactional sender honors.
        if (holder.unsubscribed) {
            skipped('recipient has unsubscribed', { holderId });
            return;
        }
        if (!(await this.clients.email.validate(to))) {
            skipped('address refused by validate', { holderId });
            return;
        }

        await this.#queueDigest(
            `user:${holderId}`,
            {
                kind: 'holder',
                to,
                recipient: holder.username,
                recipientUuid: holder.uuid,
            },
            issuer,
            count,
            items,
            mayOpen,
        );
    }

    /**
     * One named, linked item for the digest. Built from the uuid and owner, not
     * `share.path` — that is the owner's real path here, not the recipient's to
     * see. Both forms name the owner first, which is where it comes from.
     */
    #digestItem(share: ResolvedShare): DigestItem | null {
        if (!share.name) return null;
        const path = this.#targetPath(share);
        if (!path) return { name: share.name };
        return {
            name: share.name,
            link: shareDeepLink(this.#appLink(), path),
            path,
        };
    }

    /** The masked path for a share, or `null` when it isn't addressable. */
    #targetPath(share: ResolvedShare): string | null {
        if (!share.name) return null;
        const ownerUsername =
            share.owner?.username ?? ownerFromSharePath(share.path);
        if (!ownerUsername) return null;
        return maskedSharePath({
            name: share.name,
            uid: share.entryUid,
            ownerUsername,
        });
    }

    /** A record's items, or its names alone when it predates the links. */
    #recordItems(record: DigestEntryRecord): DigestItem[] {
        if (record.items?.length) return record.items;
        return (record.names ?? []).map((name) => ({ name }));
    }

    /**
     * Queue a send into the recipient's digest and arm the window. The entry
     * goes to durable KV first, so nothing rides on this process surviving; the
     * timer is only the alarm clock, and the flush arbitrates who sends.
     */
    async #queueDigest(
        key: string,
        seed: Pick<
            DigestEntryRecord,
            'kind' | 'to' | 'recipient' | 'recipientUuid'
        >,
        sender: string | undefined,
        count: number,
        items: DigestItem[],
        mayOpen: boolean,
    ): Promise<void> {
        // A digest is one email, so the budget is spent opening one, not per
        // share — anything arriving while one collects joins it for free.
        if (!mayOpen && !(await this.#digestIsOpen(key))) {
            skipped('interruption budget spent, no digest open', { key });
            return;
        }

        const record: DigestEntryRecord = {
            ...seed,
            sender,
            count,
            // `names` stays written so a node still running the previous build
            // can flush this entry; `items` is what this one reads.
            names: items.map((item) => item.name),
            items,
            queuedAt: Date.now(),
        };
        await this.stores.kv.set({
            key: `share:digest:${key}:${randomUUID()}`,
            value: record as unknown as Record<string, unknown>,
            expireAt: Math.floor(Date.now() / 1000) + DIGEST_ENTRY_TTL_SECONDS,
        });

        if (this.#digestTimers.has(key)) {
            console.log('[share-notify] queued into an open digest:', { key });
            return;
        }
        const seconds = this.#limits().emailBatchSeconds;
        if (seconds > 0) {
            console.log('[share-notify] digest window opened:', {
                key,
                seconds,
            });
            const timer = setTimeout(() => {
                this.#digestTimers.delete(key);
                void this.#flushDigest(key);
            }, seconds * 1000);
            // A pending email must not keep the process alive on its own;
            // shutdown drains the timers explicitly.
            timer.unref?.();
            this.#digestTimers.set(key, timer);
        } else {
            await this.#flushDigest(key);
        }
    }

    /**
     * Whether a digest is already collecting for this recipient. Falls back to
     * KV, since another node or region may have opened it.
     */
    async #digestIsOpen(key: string): Promise<boolean> {
        if (this.#digestTimers.has(key)) return true;
        try {
            const { res } = await this.stores.kv.list({
                as: 'keys',
                pattern: `share:digest:${key}:`,
                limit: 1,
            });
            const listed = Array.isArray(res)
                ? res
                : ((res as { items?: unknown[] })?.items ?? []);
            return listed.length > 0;
        } catch {
            // Fail closed: a broken read must not become unlimited joins.
            return false;
        }
    }

    /**
     * Send one recipient's digest: everything queued for them, from any node,
     * as one message. Two arbiters keep it to one email: the region-local Redis
     * lock stops same-region stampedes (losers just leave — the winner sends
     * everything queued), and across regions the KV `take` is the real claim,
     * handing each entry to exactly one flusher.
     */
    async #flushDigest(key: string): Promise<void> {
        const lockKey = `share:digest:lock:${key}`;
        try {
            const locked = await this.clients.redis.set(
                lockKey,
                '1',
                'EX',
                DIGEST_LOCK_SECONDS,
                'NX',
            );
            if (locked !== 'OK') {
                console.log('[share-notify] another flush holds the lock:', {
                    key,
                });
                return;
            }
        } catch {
            // No lock beats no mail; `take` still prevents double sends.
        }

        try {
            const prefix = `share:digest:${key}:`;
            const { res } = await this.stores.kv.list({
                as: 'keys',
                pattern: prefix,
                limit: DIGEST_LIST_LIMIT,
            });
            // `list` answers with a paged envelope; unwrap defensively.
            const listed = Array.isArray(res)
                ? res
                : ((res as { items?: unknown[] })?.items ?? []);
            const keys = listed.filter(
                (entry): entry is string => typeof entry === 'string',
            );
            if (keys.length >= DIGEST_LIST_LIMIT) {
                // The rest keep their TTL and go in a later flush; say so,
                // because the digest that goes out now undercounts.
                console.log('[share-notify] digest listing hit its cap:', {
                    key,
                    limit: DIGEST_LIST_LIMIT,
                });
            }

            const claimed: Array<{ key: string; record: DigestEntryRecord }> =
                [];
            for (const entryKey of keys) {
                const taken = await this.stores.kv.take({ key: entryKey });
                if (taken.res == null) continue; // another flush won this one
                claimed.push({
                    key: entryKey,
                    record: taken.res as DigestEntryRecord,
                });
            }
            if (claimed.length === 0) {
                // Listed nothing, or every entry went to another flusher.
                console.log('[share-notify] nothing to send:', {
                    key,
                    listed: keys.length,
                });
                return;
            }

            // Arrival order, so "alice and bob" reads in the order they
            // actually shared rather than however the keys happened to sort.
            claimed.sort(
                (a, b) => (a.record.queuedAt ?? 0) - (b.record.queuedAt ?? 0),
            );
            let entries: DigestEntry[] = [];
            for (const { record } of claimed) {
                entries = mergeDigestEntry(
                    entries,
                    record.sender,
                    record.count,
                    this.#recordItems(record),
                );
            }
            const [{ record: first }] = claimed;
            console.log('[share-notify] sending digest:', {
                key,
                kind: first.kind,
                to: first.to,
                entries: claimed.length,
                senders: entries.length,
            });

            try {
                if (first.kind === 'holder') {
                    await this.clients.email.send(
                        first.to,
                        'file_shared_with_you',
                        {
                            recipient: first.recipient,
                            subject_line: digestSubject(entries),
                            shares: digestLines(entries),
                            // "Open Puter" lands on Shared with everything
                            // in this mail picked out, not just one item.
                            link: sharedViewLink(
                                this.#appLink(),
                                digestItemPaths(entries),
                            ),
                            // The template composes the unsubscribe URL from
                            // the origin, so `?` and `=` stay literal instead
                            // of escaping to `&#x3D;`.
                            origin: this.#appLink(),
                            unsubscribe_uuid: first.recipientUuid ?? null,
                        },
                    );
                } else {
                    await this.clients.email.send(
                        first.to,
                        'file_shared_invite',
                        {
                            email: first.to,
                            subject_line: digestSubject(entries, {
                                suffix: 'on Puter',
                            }),
                            shares: digestLines(entries),
                            link: this.#appLink(),
                        },
                    );
                }
                console.log('[share-notify] digest sent:', {
                    key,
                    to: first.to,
                });
            } catch (err) {
                // The entries are claimed but unsent — put them back so a
                // later flush retries, instead of losing the notification.
                console.warn('[share-notify] digest email failed:', err);
                await Promise.allSettled(
                    claimed.map(({ key: entryKey, record }) =>
                        this.stores.kv.set({
                            key: entryKey,
                            value: record as unknown as Record<string, unknown>,
                            expireAt:
                                Math.floor(Date.now() / 1000) +
                                DIGEST_ENTRY_TTL_SECONDS,
                        }),
                    ),
                );
            }
        } catch (err) {
            console.warn('[share-notify] digest flush failed:', err);
        } finally {
            try {
                await this.clients.redis.del(lockKey);
            } catch {
                // The lock self-expires.
            }
        }
    }

    /**
     * Email an address with no account. Sent whatever
     * `share_email_notifications` says — there is no Puter inbox to use instead
     * — but still budgeted: an invite reaches someone who never asked for it.
     */
    async #emailInvites(actor: Actor, shares: ResolvedShare[]): Promise<void> {
        if (!this.config.email) return;
        const issuerId = actor.user?.id;
        if (typeof issuerId !== 'number') return;

        const byEmail = new Map<
            string,
            { count: number; items: DigestItem[] }
        >();
        for (const share of shares) {
            if (!share.pending || !share.isNew || !share.recipientEmail) {
                continue;
            }
            const seen = byEmail.get(share.recipientEmail) ?? {
                count: 0,
                items: [] as DigestItem[],
            };
            seen.count += 1;
            if (share.name && seen.items.length < DIGEST_NAMES_PER_SENDER) {
                // Named but not linked: there is no account to route yet, and
                // the invite's own call to action is to create one.
                seen.items.push({ name: share.name });
            }
            byEmail.set(share.recipientEmail, seen);
        }
        if (byEmail.size === 0) return;

        const issuer = actor.user?.username;
        for (const [to, { count, items }] of byEmail) {
            // Each address fails alone — one refused send must not cost the
            // next invitee their only channel.
            try {
                if (!(await this.clients.email.validate(to))) {
                    skipped('invite address refused by validate', { to });
                    continue;
                }
                const mayOpen = await this.#claimInviteEmail(issuerId, to);
                await this.#queueDigest(
                    `invite:${to}`,
                    { kind: 'invite', to },
                    issuer,
                    count,
                    items,
                    mayOpen,
                );
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
            await this.services.notification.notify(
                [holderId],
                {
                    title: `${count === 1 ? 'An item was' : `${count} items were`} shared with you before you joined`,
                    fields: { count },
                },
                { type: 'share.claimed' },
            );
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
