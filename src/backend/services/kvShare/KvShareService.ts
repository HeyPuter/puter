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

import { randomUUID } from 'node:crypto';
import {
    EVENTS_KV_HANDLE_LIMIT,
    EVENTS_KV_HANDLES_PER_APP,
    EVENTS_KV_HANDLES_PER_HOLDER,
    EVENTS_KV_HANDLES_PER_USER,
    KV_SHARE_GRANT_LIMITS,
    KV_SHARE_NOTICE_LIMIT,
    limitFor,
    type TieredQuota,
} from '../../controllers/events/limits.js';
import {
    isAccessTokenActor,
    isAccountContext,
    makeActor,
    userRelatedActor,
    type Actor,
} from '../../core/actor.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import {
    checkRateLimit,
    claimRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import {
    KV_HANDLE_RETIRE_BATCH,
    type FindLiveKvShareHandleInput,
    type HeldKvShareHandle,
    type KvShareHandle,
    type KvShareHandleListOptions,
    type KvShareOwnerListOptions,
    type KvShareRevokedBy,
} from '../../stores/events/KvShareHandleStore.js';
import {
    KV_GLOBAL_APP_KEY,
    kvNamespace,
} from '../../stores/systemKv/SystemKVStore.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { runWithConcurrencyLimit } from '../../util/concurrency.js';
import type { PageResult } from '../../util/pagination.js';
import { withRedisLock } from '../../util/redisLock.js';
import { appGenerationStart, predatesApp } from '../../util/appGeneration.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import {
    kvShareHandleDisabled,
    unknownKvShareHandle,
} from '../events/authorization.js';
import { actorPlanId } from '../metering/enforcement.js';
import {
    recipientNotAcceptingShares,
    refusesSharesFrom,
} from '../share/shareBlocks.js';
import { PuterService } from '../types.js';
import {
    assertBoundedManageGrant,
    assertNewShareSegments,
    assertPrefixFitsAccess,
    assertShareableAppUid,
    assertShareablePrefix,
    invalidAppUid,
    keyPrefixSegments,
    KV_SHARE_ACCESS_LEVELS,
    kvShareAccessOf,
    kvHandlesDisabled,
    kvShareAppDelegateImplicator,
    kvShareGrantAtEveryLevel,
    kvShareGrantCovers,
    kvShareLevelsExploder,
    kvShareManageNamespaceRoots,
    kvShareManagePermission,
    kvShareOwnerImplicator,
    kvSharePrefixCaseConflict,
    parseKvShareAccess,
    parseKvShareLabel,
    parseKvShareRecipient,
    type KvShareAccess,
    type KvShareRecipient,
} from './kvShares.js';

/**
 * Sharing a region of one account's key-value data with another account. The
 * actor gates live here, not at the edge, because every route that reaches a
 * handle needs the same ones.
 */

// -- Wire shapes ------------------------------------------------------

/** A share request, with the recipient already read off the route's body. */
export interface KvShareRequest {
    prefix?: unknown;
    recipient: KvShareRecipient;
    access?: unknown;
    appUid?: unknown;
    /** `undefined` keeps the stored label, `null` clears it. */
    label?: unknown;
}

/** A share request's fields other than who it is for. */
export type KvShareMintFields = Omit<KvShareRequest, 'recipient'>;

/** A batch share request: raw recipients, parsed one by one. */
export interface KvShareBatchRequest extends KvShareMintFields {
    recipients: readonly unknown[];
}

export interface KvShareMintOptions {
    defaultAccess: KvShareAccess;
    /** A request naming no level leaves an existing share's level. */
    keepLevelUnlessNamed?: boolean;
}

type Grantee = UserRow & { id: number; username: string };

/** What a share that doesn't exist yet is made of. */
interface NewShare {
    ownerUserId: number;
    appUid: string;
    keyPrefix: string;
    permission: string;
    label: string | null;
}

interface KvShareMintResult {
    share?: KvShareView;
    error?: HttpError;
    /** Set while the batch resolves its recipients. */
    grantee?: Grantee;
}

/** One recipient's outcome in a batch: its share, or why it was refused. */
export interface KvShareBatchItem {
    recipient: unknown;
    share?: KvShareView;
    error?: HttpError;
}

/** A share as its owner is told about it right after making or changing it. */
export interface KvShareView {
    handle: string;
    prefix: string;
    access: KvShareAccess;
    appUid: string;
    holderUsername: string;
    label: string | null;
    createdAt: number;
}

/**
 * One share as its owner's listing reports it, retired ones included — they are
 * the record of what was shared and when it stopped.
 */
export interface KvShareOwnerView extends Omit<KvShareView, 'holderUsername'> {
    holderUsername: string | null;
    revokedAt: number | null;
    revokedBy: KvShareRevokedBy | null;
}

/** What revoking or unsharing reports: the handle and when it stopped. */
export interface RetiredKvShare {
    handle: string;
    revokedAt: number;
}

// -- Errors -----------------------------------------------------------

const disabled = (): HttpError =>
    new HttpError(503, 'Events are not enabled on this server', {
        legacyCode: 'events_disabled',
    });

const tooManyCalls = (): HttpError =>
    new HttpError(429, 'Too many subscription changes', {
        legacyCode: 'too_many_requests',
    });

const badRequest = (message: string, code: string): HttpError =>
    new HttpError(400, message, { legacyCode: code });

/**
 * Listing and revoking are the owner's, and an app's only where the handle is
 * the app's own: its namespace, its user, and a delegation it still holds.
 * Anything else — another app, a token an app issued, a handle outside the
 * namespace — reads as somebody else's surface.
 */
const handleOwnerOnly = (): HttpError =>
    new HttpError(
        403,
        'Only the account, or the app whose namespace this is, may manage share handles',
        { legacyCode: 'events_kv_handle_owner_only' },
    );

/**
 * An app minting is delegation, and the `manage:` grant on the region is the
 * consent for it. Without one there is nothing authorizing the app to dispose
 * of its user's data, whatever the user themselves could do here.
 */
const handleNotDelegated = (): HttpError =>
    new HttpError(
        403,
        'This app has not been given permission to share this data',
        { legacyCode: 'events_kv_handle_not_delegated' },
    );

/**
 * A delegation is the app's to hold, not to pass on: a token it minted may
 * carry the `manage:` permission and still not mint through it. The user's own
 * token is not this case — it acts for the user, who needs no delegation.
 */
const handleAccessTokenForbidden = (): HttpError =>
    new HttpError(403, 'An access token may not mint a share handle', {
        legacyCode: 'forbidden',
    });

/**
 * An app addresses exactly one key-value namespace — its own, under its user —
 * so that is the only one it can hand a region of out.
 */
const handleOutsideNamespace = (): HttpError =>
    new HttpError(403, 'An app may only share its own key-value data', {
        legacyCode: 'events_kv_handle_outside_namespace',
    });

const handleListOutsideNamespace = (): HttpError =>
    new HttpError(
        403,
        'An app may only list shares of its own key-value data',
        {
            legacyCode: 'events_kv_handle_outside_namespace',
        },
    );

/**
 * The namespace a listing covers. An app sees its own and is refused another;
 * the account sees every app's unless it names one.
 */
const listingNamespace = (
    app: NonNullable<Actor['effectiveApp']> | null,
    named: string | null | undefined,
): string | null => {
    if (!app) return named ?? null;
    if (named !== undefined && named !== null && named !== app.uid)
        throw handleListOutsideNamespace();
    return app.uid;
};

/**
 * A temporary account holds no share handles: the grant outlives the session
 * that made it, and there is no account left behind it to take one back.
 */
const kvHandleNeedsAccount = (): HttpError =>
    new HttpError(403, 'A temporary account may not share its key-value data', {
        legacyCode: 'events_kv_handle_requires_account',
    });

/**
 * Past a handle ceiling. One code for both of them — the remedy is the same,
 * revoke something — with the message saying which one it was.
 */
const QUOTA_MESSAGES = {
    account: (limit: number) =>
        `An account may hold out ${limit} share handles at a time`,
    app: (limit: number) =>
        `An app may hold out ${limit} share handles for one account`,
    holder: (limit: number) =>
        `An account may hold out ${limit} share handles to one user`,
};

const handleQuotaReached = (
    limit: number,
    scope: keyof typeof QUOTA_MESSAGES,
): HttpError =>
    new HttpError(409, QUOTA_MESSAGES[scope](limit), {
        legacyCode: 'events_kv_handle_limit_reached',
    });

/** An app uid a user session names, for a surface with no app of its own. */
const parseAppUid = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string')
        throw badRequest('appUid must be a string', 'bad_request');
    return value;
};

/** Recipients of one batch looked up or minted at once. */
const MINT_RECIPIENT_CONCURRENCY = 4;

/** Retire announcements settled at once; each is one holder-index read. */
const RETIRE_SETTLE_CONCURRENCY = 8;

const levelRank = (permission: string): number =>
    KV_SHARE_ACCESS_LEVELS.indexOf(kvShareAccessOf(permission) ?? 'watch');

/** Whether a mint finding this live row changes its level or label. */
const shareChanges = (
    row: KvShareHandle,
    wanted: { permission: string; label: string | null | undefined },
): boolean =>
    row.permission !== wanted.permission ||
    (wanted.label !== undefined && wanted.label !== row.label);

/** A share change's lock: its lifetime, and how long another change waits. */
const SHARE_CHANGE_LOCK_MS = 10_000;
const SHARE_CHANGE_LOCK_ATTEMPTS = 20;
const SHARE_CHANGE_LOCK_RETRY_MS = 50;

/** Retired handles are kept this long for their owner's listing, then deleted. */
export const KV_SHARE_REVOKED_RETENTION_SECONDS = 30 * 24 * 60 * 60;
// Every node checks hourly; the gate lets one node through per day.
const PURGE_CHECK_MS = 60 * 60 * 1000;
const PURGE_INITIAL_DELAY_MS = 5 * 60 * 1000;
const PURGE_GATE_KEY = 'kvShare:purge:gate';
const PURGE_GATE_SECONDS = 24 * 60 * 60;
// Rows per delete, with a pause between, so replicas keep up.
const PURGE_BATCH = 500;
const PURGE_PAUSE_MS = 50;
const PURGE_MAX_BATCHES = 2_000;

/** Items one app-data purge call deletes. */
const APP_DATA_PURGE_STEP = 5_000;

// -- Cleanup jobs -------------------------------------------------------
//
// Retiring a deleted app's shares, and taking back an uninstalled app's shares
// and data, are recorded as reserved items before they run, so a failure or a
// restart resumes them. The record carries the job's lease, retry schedule and
// attempts, and a node claims it by compare-and-set. A job stays with the
// deployment that recorded or last ran it; another one takes it over only once
// it has gone unclaimed for a while past due.

const JOB_KEY_PREFIX = 'kvShareJob#';
/** How long one run works before handing its job back, and the lease on it. */
const JOB_RUN_MS = 60_000;
const JOB_LEASE_MS = 5 * 60_000;
/**
 * How often each node looks through the records, how many per look, and how
 * long it keeps starting runs.
 */
const JOB_CHECK_MS = 60_000;
const JOB_CHECK_INITIAL_DELAY_MS = 60_000;
const JOB_CHECK_PAGE = 100;
const JOB_CHECK_BUDGET_MS = 2 * 60_000;
/** How long a due job waits for its own deployment before another takes it. */
const JOB_ADOPT_AFTER_MS = 30 * 60_000;
/** Wait after a failed run: doubling from a minute, at most six hours. */
const JOB_RETRY_BASE_MS = 60_000;
const JOB_RETRY_MAX_MS = 6 * 60 * 60_000;
/** Failed runs before a job stops retrying, and how long its record stays. */
const JOB_MAX_ATTEMPTS = 10;
const JOB_FAILED_RETENTION_SECONDS = 30 * 24 * 60 * 60;
/** Deleted apps whose retire one call runs at once. */
const JOB_START_CONCURRENCY = 4;

/**
 * Work recorded before it runs. `cutoff` (unix seconds) bounds it to handles
 * made by then: a later one belongs to an app registered again under the same
 * uid, or to a share made after the app was authorized again.
 */
type KvShareJob =
    | { kind: 'app'; appUid: string; cutoff: number }
    | {
          kind: 'uninstall';
          userId: number;
          userUuid: string;
          appUid: string;
          cutoff: number;
      };

/** A job's record: the job, and the state every node claims it by. */
interface KvShareJobRecord {
    job: KvShareJob;
    failed: boolean;
    attempts: number;
    /** Unix ms before which it isn't due. */
    runAfter: number;
    /** The deployment that recorded or last claimed it. */
    home: string | null;
    /** Unix ms it was last recorded or claimed. */
    touched: number;
    /** Unix ms its current lease runs out; 0 when nobody holds it. */
    leaseUntil: number;
}

interface KvShareJobRun {
    done: boolean;
    retired: number;
}

const JOB_NOT_RUN: KvShareJobRun = { done: false, retired: 0 };

const jobKey = (job: KvShareJob): string =>
    job.kind === 'app'
        ? `${JOB_KEY_PREFIX}app#${job.appUid}`
        : `${JOB_KEY_PREFIX}uninstall#${job.userId}#${job.appUid}`;

const finiteOr0 = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

/** A recorded job, or `null` for an item that isn't one. */
const parseJobRecord = (
    item: Record<string, unknown>,
): KvShareJobRecord | null => {
    const appUid = item.appUid;
    const cutoff = Number(item.cutoff);
    if (typeof appUid !== 'string' || !Number.isFinite(cutoff)) return null;
    let job: KvShareJob;
    if (item.kind === 'app') job = { kind: 'app', appUid, cutoff };
    else if (item.kind === 'uninstall') {
        const userId = Number(item.userId);
        if (!Number.isInteger(userId) || typeof item.userUuid !== 'string')
            return null;
        job = {
            kind: 'uninstall',
            userId,
            userUuid: item.userUuid,
            appUid,
            cutoff,
        };
    } else return null;
    if (item.key !== jobKey(job)) return null;
    return {
        job,
        failed: item.state === 'failed',
        attempts: finiteOr0(item.attempts),
        runAfter: finiteOr0(item.runAfter),
        home: typeof item.home === 'string' ? item.home : null,
        touched: finiteOr0(item.touched),
        leaseUntil: finiteOr0(item.leaseUntil),
    };
};

/**
 * What a claim requires of the record: not given up on, unleased, due, and this
 * deployment's or left unclaimed past due for long enough to adopt.
 */
const JOB_CLAIM_CONDITION = [
    'attribute_exists(#c)',
    '#st <> :failed',
    '#lu < :now',
    '#ra <= :now',
    '(#home = :home OR (#tc < :adopt AND #ra < :adopt))',
].join(' AND ');

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const ownerView = (
    row: KvShareHandle,
    holderUsername: string | null,
): KvShareOwnerView => ({
    handle: row.handle,
    prefix: row.keyPrefix,
    access: kvShareAccessOf(row.permission) ?? 'watch',
    appUid: row.appUid,
    holderUsername,
    label: row.label,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
});

export class KvShareService extends PuterService {
    #timers: ReturnType<typeof setTimeout>[] = [];
    #stopping = false;
    #resuming = false;
    /** Where this node's next look through the job records starts. */
    #jobCursor: string | undefined;

    override onServerStart(): void {
        this.#armPurge();
        this.#armJobs();

        // A check at one level is answered by a grant at any level above it.
        this.services.permission.registerExploder(kvShareLevelsExploder());

        // Owning a key-value namespace is holding every share grant over it,
        // which is what lets its owner mint a handle on their own data.
        this.services.permission.registerImplicator(kvShareOwnerImplicator());

        // Lets an app-under-user actor exercise a share grant its user holds,
        // scoped to the app the grant's namespace names. The answer is cached
        // under the app-under-user generation, which removing the app bumps.
        this.services.permission.registerImplicator(
            kvShareAppDelegateImplicator({
                userHolds: async (actor, permission) =>
                    (await this.services.permission.check(actor, permission)) &&
                    (await this.#grantForCurrentApp(actor, permission)),
                appAuthorized: (actor) => this.#appAuthorized(actor),
            }),
        );

        // A handle must not outlive its app: an origin-derived uid comes back
        // verbatim when the app is registered again.
        this.clients.event.on('app.changed', async (_key, data) => {
            const { app_uid: appUid, action } = (data ?? {}) as {
                app_uid?: string;
                action?: string;
            };
            if (action !== 'deleted' || !appUid) return;
            try {
                await this.retireForDeletedApps([appUid]);
            } catch {
                // Alarmed, and retried from its record.
            }
        });

        // Removing an app with its data takes back what the user shared out of
        // it, then empties the namespace, in that order so no holder reads it
        // while it empties. Both run in the background, off the request.
        this.clients.event.on('app.uninstalled', async (_key, data) => {
            if (!data?.deleteData || data.appUid === KV_GLOBAL_APP_KEY) return;
            await this.#startJob({
                kind: 'uninstall',
                userId: data.userId,
                userUuid: data.userUuid,
                appUid: data.appUid,
                cutoff: nowSeconds(),
            });
        });

        // A developer's apps go with their account, without `app.changed`.
        this.clients.event.on('user.delete', async (_key, data) => {
            if (!data?.appUids?.length) return;
            try {
                await this.retireForDeletedApps(data.appUids);
            } catch {
                // Alarmed, and retried from its record.
            }
        });
    }

    override onServerPrepareShutdown(): void {
        this.#stopping = true;
        for (const timer of this.#timers) clearTimeout(timer);
        this.#timers = [];
    }

    // -- Retention purge ---------------------------------------------

    /**
     * Delete handles retired longer ago than the retention, in batches. Returns
     * the rows deleted, or null when another node holds today's gate. A missing
     * row reads like a retired one everywhere a handle is resolved.
     */
    async purgeRevokedHandles(): Promise<number | null> {
        const claimed = await this.clients.redis.set(
            PURGE_GATE_KEY,
            String(Date.now()),
            'EX',
            PURGE_GATE_SECONDS,
            'NX',
        );
        if (claimed !== 'OK') return null;

        const cutoff =
            Math.floor(Date.now() / 1000) - KV_SHARE_REVOKED_RETENTION_SECONDS;
        let purged = 0;
        let finished = false;
        try {
            for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
                if (this.#stopping) return purged;
                const batch =
                    await this.stores.kvShareHandle.deleteRevokedBefore(
                        cutoff,
                        PURGE_BATCH,
                    );
                purged += batch;
                if (batch < PURGE_BATCH) break;
                await new Promise((resolve) =>
                    setTimeout(resolve, PURGE_PAUSE_MS),
                );
            }
            finished = true;
            return purged;
        } finally {
            // A run cut short frees the gate, so another node picks it up on
            // its next check instead of tomorrow.
            if (!finished) {
                try {
                    await this.clients.redis.del(PURGE_GATE_KEY);
                } catch {
                    // The gate expires on its own.
                }
            }
        }
    }

    /**
     * Empty an uninstalled app's namespace in steps until it's empty, the user
     * authorizes the app again, or the deadline passes. The authorization is
     * checked before each page is deleted, so what the app writes once it's
     * authorized again is kept. Returns whether the purge is finished.
     */
    async #purgeAppData(
        job: Extract<KvShareJob, { kind: 'uninstall' }>,
        deadline: number,
    ): Promise<boolean> {
        const appId = (await this.stores.app.getByUid(job.appUid))?.id;
        const stillWanted = async () =>
            typeof appId !== 'number' ||
            (
                await this.stores.permission.listUserAppPermsFromPrimary(
                    job.userId,
                    appId,
                )
            ).length === 0;
        if (!(await stillWanted())) return true;

        const namespace = kvNamespace(job.userUuid, job.appUid);
        while (!this.#stopping && Date.now() < deadline) {
            const { done, stopped } = await this.stores.kv.purgeNamespace(
                namespace,
                { maxItems: APP_DATA_PURGE_STEP, stillWanted },
            );
            if (done || stopped) return true;
            await new Promise((resolve) => setTimeout(resolve, PURGE_PAUSE_MS));
        }
        return false;
    }

    // -- Cleanup jobs -------------------------------------------------

    /** What this deployment calls itself, which is what a job's home names. */
    get #home(): string {
        return this.services.broadcast.regionId;
    }

    /**
     * Look through the next page of recorded jobs and run the ones this node
     * may claim. Each look starts where the last one stopped, so records that
     * can't run yet never hide the ones after them. Every node calls this on a
     * timer, which is how a failed, interrupted or unfinished job resumes.
     * Returns how many finished.
     */
    async resumeKvShareJobs(): Promise<number> {
        if (this.#resuming) return 0;
        this.#resuming = true;
        try {
            const started = Date.now();
            const after = this.#jobCursor;
            const page = await this.stores.kv.pageReservedItems(
                JOB_KEY_PREFIX,
                { limit: JOB_CHECK_PAGE, afterKey: after },
            );
            this.#jobCursor = page.nextKey;
            let finished = 0;
            for (const [index, item] of page.items.entries()) {
                if (
                    this.#stopping ||
                    Date.now() - started > JOB_CHECK_BUDGET_MS
                ) {
                    // The rest of this page is first in line next time.
                    this.#jobCursor =
                        index > 0 ? String(page.items[index - 1].key) : after;
                    break;
                }
                const record = parseJobRecord(item);
                if (!record || !this.#claimable(record, Date.now())) continue;
                try {
                    if ((await this.#runJob(jobKey(record.job))).done)
                        finished++;
                } catch {
                    // Alarmed, and backed off in its record.
                }
            }
            return finished;
        } finally {
            this.#resuming = false;
        }
    }

    /** The claim condition, read off a record already in hand. */
    #claimable(record: KvShareJobRecord, now: number): boolean {
        if (record.failed || record.leaseUntil >= now || record.runAfter > now)
            return false;
        const adopt = now - JOB_ADOPT_AFTER_MS;
        return (
            record.home === this.#home ||
            (record.touched < adopt && record.runAfter < adopt)
        );
    }

    /** Record a job, then run it in the background. */
    async #startJob(job: KvShareJob): Promise<void> {
        await this.#recordJob(job);
        void (async () => {
            try {
                await this.#runJob(jobKey(job));
            } catch {
                // Alarmed, and retried from its record.
            }
        })();
    }

    /**
     * Record a job as due now, here. The cutoff only grows, so recording a job
     * again never narrows it; a lease someone holds is left alone. A failed
     * write is alarmed: without its record the job can't be claimed or run.
     */
    async #recordJob(job: KvShareJob): Promise<void> {
        const key = jobKey(job);
        const due = {
            state: 'pending',
            attempts: 0,
            runAfter: 0,
            home: this.#home,
            touched: Date.now(),
        };
        const change = {
            setIfAbsent: { leaseUntil: 0 },
            remove: ['ttl'],
        };
        try {
            const recorded = await this.stores.kv.updateReservedItemIf(
                key,
                { ...change, set: { ...job, ...due } },
                'attribute_not_exists(#c) OR #c <= :c',
                { ':c': job.cutoff },
                { '#c': 'cutoff' },
            );
            if (!recorded)
                await this.stores.kv.updateReservedItemIf(
                    key,
                    { ...change, set: due },
                    'attribute_exists(#c)',
                    {},
                    { '#c': 'cutoff' },
                );
        } catch (err) {
            this.clients.alarm.create(
                `kv_share_job_record_failed:${key}`,
                'Failed to record a key-value share cleanup',
                { job, error: err as Error },
                'warning',
                { dedup: true },
            );
        }
    }

    /**
     * One run of a recorded job: claimed off its record, then worked for at
     * most `JOB_RUN_MS`. Finished, the record is deleted unless the job was
     * recorded again meanwhile; unfinished, it's handed back due now. A failure
     * is alarmed, backs the record off and rethrows. A job that isn't
     * claimable, or that another node claimed first, reads as not done.
     */
    async #runJob(key: string): Promise<KvShareJobRun> {
        const lease = randomUUID();
        const now = Date.now();
        let claimed: Record<string, unknown> | null;
        try {
            claimed = await this.stores.kv.updateReservedItemIf(
                key,
                {
                    set: {
                        leaseOwner: lease,
                        leaseUntil: now + JOB_LEASE_MS,
                        home: this.#home,
                        touched: now,
                    },
                },
                JOB_CLAIM_CONDITION,
                {
                    ':failed': 'failed',
                    ':now': now,
                    ':home': this.#home,
                    ':adopt': now - JOB_ADOPT_AFTER_MS,
                },
                {
                    '#c': 'cutoff',
                    '#st': 'state',
                    '#lu': 'leaseUntil',
                    '#ra': 'runAfter',
                    '#home': 'home',
                    '#tc': 'touched',
                },
            );
        } catch (err) {
            // The record stays, and the next check claims it.
            console.warn('[kvShare] could not claim a cleanup job', err);
            return JOB_NOT_RUN;
        }
        const record = claimed && parseJobRecord(claimed);
        if (!record) return JOB_NOT_RUN;

        let run: KvShareJobRun;
        try {
            run = await this.#jobStep(record.job, now + JOB_RUN_MS);
        } catch (err) {
            await this.#jobFailed(key, lease, record, err);
            throw err;
        }
        if (run.done) await this.#jobFinished(key, lease, record.job);
        else {
            console.log(
                `[kvShare] cleanup ${key} continues after retiring ${run.retired}`,
            );
            try {
                await this.#releaseJob(key, lease, { runAfter: 0 });
            } catch (err) {
                // The lease runs out and the next claim carries on.
                console.warn(
                    '[kvShare] could not hand back a cleanup job',
                    err,
                );
            }
        }
        return run;
    }

    async #jobStep(job: KvShareJob, deadline: number): Promise<KvShareJobRun> {
        if (job.kind === 'app')
            return this.#retireAsSystem(
                () =>
                    this.stores.kvShareHandle.listLiveForApps(
                        [job.appUid],
                        KV_HANDLE_RETIRE_BATCH,
                        job.cutoff,
                    ),
                'kv share app deleted',
                deadline,
            );
        // Handles the user holds in this app are left alone.
        const retire = await this.#retireAsSystem(
            () =>
                this.stores.kvShareHandle.listLiveForOwnerApp(
                    job.userId,
                    job.appUid,
                    KV_HANDLE_RETIRE_BATCH,
                    job.cutoff,
                ),
            'kv share app data deleted',
            deadline,
        );
        if (!retire.done) return retire;
        return {
            done: await this.#purgeAppData(job, deadline),
            retired: retire.retired,
        };
    }

    /** Delete a finished job's record, or hand it back if it was recorded again. */
    async #jobFinished(
        key: string,
        lease: string,
        job: KvShareJob,
    ): Promise<void> {
        try {
            const deleted = await this.stores.kv.deleteReservedItemIf(
                key,
                '#lo = :lease AND #c = :c',
                { ':lease': lease, ':c': job.cutoff },
                { '#lo': 'leaseOwner', '#c': 'cutoff' },
            );
            if (!deleted) await this.#releaseJob(key, lease, {});
        } catch (err) {
            // The record runs again and finds nothing left to do.
            console.warn('[kvShare] could not clear a finished job', err);
        }
    }

    /**
     * Count a failed run in the record and back it off, or, past
     * `JOB_MAX_ATTEMPTS`, mark it failed for good and let it expire.
     */
    async #jobFailed(
        key: string,
        lease: string,
        record: KvShareJobRecord,
        err: unknown,
    ): Promise<void> {
        const attempts = record.attempts + 1;
        const gaveUp = attempts >= JOB_MAX_ATTEMPTS;
        try {
            await this.#releaseJob(
                key,
                lease,
                gaveUp
                    ? {
                          attempts,
                          state: 'failed',
                          ttl: nowSeconds() + JOB_FAILED_RETENTION_SECONDS,
                      }
                    : {
                          attempts,
                          runAfter:
                              Date.now() +
                              Math.min(
                                  JOB_RETRY_BASE_MS * 2 ** (attempts - 1),
                                  JOB_RETRY_MAX_MS,
                              ),
                      },
            );
        } catch {
            // The lease runs out and the next claim retries it.
        }
        this.clients.alarm.create(
            gaveUp
                ? `kv_share_job_gave_up:${key}`
                : `kv_share_job_failed:${key}`,
            gaveUp
                ? 'A key-value share cleanup kept failing and stopped retrying'
                : 'A key-value share cleanup failed and will be retried',
            { job: record.job, attempts, error: err as Error },
            'warning',
            { dedup: true },
        );
    }

    /** Give up this node's lease on a job, writing `set` with it. */
    async #releaseJob(
        key: string,
        lease: string,
        set: Record<string, unknown>,
    ): Promise<void> {
        await this.stores.kv.updateReservedItemIf(
            key,
            { set: { ...set, leaseUntil: 0, touched: Date.now() } },
            '#lo = :lease',
            { ':lease': lease },
            { '#lo': 'leaseOwner' },
        );
    }

    #armJobs(): void {
        const run = async () => {
            try {
                await this.resumeKvShareJobs();
            } catch (err) {
                console.warn('[kvShare] job check failed', err);
            }
        };
        const kick = setTimeout(
            () => void run(),
            JOB_CHECK_INITIAL_DELAY_MS * (0.5 + Math.random()),
        );
        kick.unref?.();
        const timer = setInterval(() => void run(), JOB_CHECK_MS);
        timer.unref?.();
        this.#timers.push(kick, timer);
    }

    #armPurge(): void {
        const run = async () => {
            try {
                const purged = await this.purgeRevokedHandles();
                if (purged)
                    console.log(`[kvShare] purged ${purged} retired handles`);
            } catch (err) {
                console.warn('[kvShare] retired-handle purge failed', err);
            }
        };
        // Jittered so a deploy does not have every node check at once.
        const kick = setTimeout(
            () => void run(),
            PURGE_INITIAL_DELAY_MS * (0.5 + Math.random()),
        );
        kick.unref?.();
        const timer = setInterval(() => void run(), PURGE_CHECK_MS);
        timer.unref?.();
        this.#timers.push(kick, timer);
    }

    /** Whether the level a mint asks for is available on this server. */
    #assertAccessEnabled(access: KvShareAccess): void {
        if (access === 'watch') {
            if (this.config.events?.enabled !== true) throw disabled();
            if (this.config.events?.kvHandles !== true)
                throw kvShareHandleDisabled();
            return;
        }
        if (this.config.kv?.shareHandles !== true) throw kvHandlesDisabled();
    }

    /**
     * Hand another user a region of this account's key-value data, to watch,
     * read or write. One recipient's form of {@link mintKvHandles}.
     */
    async mintKvHandle(
        actor: Actor,
        request: KvShareRequest,
        options: KvShareMintOptions,
    ): Promise<KvShareView> {
        const { recipient, ...fields } = request;
        const [item] = await this.#mintShares(
            actor,
            fields,
            [recipient],
            options,
        );
        if (item.error) throw item.error;
        return item.share!;
    }

    /**
     * {@link mintKvHandle} for several recipients: one region, level and label
     * for all of them. Quotas and budgets are checked for the whole batch
     * before anything is granted. A failure about one recipient (unknown,
     * yourself, not accepting shares, at the per-holder cap) is reported on its
     * item; anything else fails the call.
     */
    async mintKvHandles(
        actor: Actor,
        request: KvShareBatchRequest,
        options: KvShareMintOptions,
    ): Promise<KvShareBatchItem[]> {
        const { recipients, ...fields } = request;
        const parsed = recipients.map((raw): KvShareRecipient | HttpError => {
            try {
                return parseKvShareRecipient(raw);
            } catch (err) {
                if (isHttpError(err)) return err;
                throw err;
            }
        });
        const results = await this.#mintShares(actor, fields, parsed, options);
        return results.map((result, i) => ({
            recipient: recipients[i],
            ...result,
        }));
    }

    /**
     * The one mint path. Two writes per new share, in this order: the grant,
     * which is the authorization, and then the handle, which is only a name for
     * it. A handle whose grant never landed would be a name for nothing; a
     * grant whose handle never landed is unaddressable.
     *
     * An app may mint too: authority is the user's, asked of the user behind
     * the actor, and the app's own consent to delegate is a `manage:` grant on
     * the region.
     */
    async #mintShares(
        actor: Actor,
        request: KvShareMintFields,
        recipients: readonly (KvShareRecipient | HttpError)[],
        options: KvShareMintOptions,
    ): Promise<KvShareMintResult[]> {
        const access = parseKvShareAccess(
            request.access,
            options.defaultAccess,
        );
        this.#assertAccessEnabled(access);

        const owner = actor.user;
        if (!owner?.uuid || owner.id === undefined) throw handleOwnerOnly();
        // `undefined` is an app that could not be resolved, not the absence of
        // one.
        const app = actor.effectiveApp;
        if (app === undefined) throw handleOwnerOnly();
        // A token scoped to less than its issuer holds is not the account. A
        // token an app issued is refused by the delegation check below.
        if (app === null && !isAccountContext(actor)) throw handleOwnerOnly();

        const ownerUserId = owner.id;
        // The budget is the user's, so an app spends its user's slots.
        await this.#spendHandleBudget(ownerUserId);

        const keyPrefix = assertShareablePrefix(request.prefix);
        const label = parseKvShareLabel(request.label);
        const appUid = await this.#mintNamespace(app, request);
        const permission = assertPrefixFitsAccess(
            owner.uuid,
            appUid,
            keyPrefix,
            access,
        );
        // Before any recipient lookup, so an app without the consent learns
        // neither whether a username exists nor a handle it may no longer
        // hand out.
        if (app) await this.#assertKvShareDelegated(actor, permission);

        // One unit per named recipient, before any lookup, so a batch is no
        // cheaper way to probe usernames than single calls.
        const named = recipients.filter((r) => !isHttpError(r)).length;
        await this.#spendGrantBudget(ownerUserId, named);

        const results: KvShareMintResult[] = recipients.map((r) =>
            isHttpError(r) ? { error: r } : {},
        );
        const grantees = new Map<number, number>();
        const plans: Array<{
            index: number;
            grantee: Grantee;
            existing: KvShareHandle | null;
        }> = [];
        const duplicates: Array<[number, number]> = [];
        await runWithConcurrencyLimit(
            recipients.map((r, index) => ({ r, index })),
            MINT_RECIPIENT_CONCURRENCY,
            async ({ r, index }) => {
                if (isHttpError(r)) return;
                try {
                    results[index].grantee = await this.#resolveGrantee(r);
                } catch (err) {
                    if (!isHttpError(err)) throw err;
                    results[index].error = err;
                }
            },
        );
        for (let index = 0; index < results.length; index++) {
            const grantee = results[index].grantee;
            delete results[index].grantee;
            if (!grantee) continue;
            const first = grantees.get(grantee.id);
            if (first !== undefined) {
                duplicates.push([index, first]);
                continue;
            }
            grantees.set(grantee.id, index);
            plans.push({ index, grantee, existing: null });
        }

        // Resolved before the idempotent answer below, so a plan that holds
        // none is refused whatever it asks for. Behind the delegation check: an
        // app with no delegation must not learn anything about the plan.
        const quota = await this.#handleQuota(actor);

        // The same region minted again for the same grantee is the same
        // capability: handing back what exists keeps two handles from ever
        // sharing one permission row. It takes no slot, so no cap is asked.
        const regionFor = (grantee: Grantee) => ({
            ownerUserId,
            granteeUserId: grantee.id,
            appUid,
            keyPrefix,
        });
        await runWithConcurrencyLimit(
            plans,
            MINT_RECIPIENT_CONCURRENCY,
            async (plan) => {
                plan.existing = await this.stores.kvShareHandle.findLive(
                    regionFor(plan.grantee),
                );
            },
        );
        // New shares only, so ones made before these rules can still be
        // narrowed or taken back.
        const added = plans.filter((plan) => !plan.existing);
        if (added.length > 0)
            assertNewShareSegments(keyPrefixSegments(keyPrefix));
        await runWithConcurrencyLimit(
            added,
            MINT_RECIPIENT_CONCURRENCY,
            async (plan) => {
                try {
                    await this.#assertNewShareFor(
                        ownerUserId,
                        plan.grantee,
                        regionFor(plan.grantee),
                    );
                } catch (err) {
                    if (!isHttpError(err)) throw err;
                    results[plan.index].error = err;
                }
            },
        );
        const fresh = plans.filter(
            (plan) => !plan.existing && !results[plan.index].error,
        );
        await this.#assertHandleCeiling(
            ownerUserId,
            appUid,
            quota,
            fresh.length,
        );

        const keepLevel =
            options.keepLevelUnlessNamed &&
            (request.access === undefined || request.access === null);
        // No lock spans the batch: each recipient is its own region, a level
        // change takes its handle's own lock, and the caps above were checked
        // for the whole batch.
        await runWithConcurrencyLimit(
            plans.filter((plan) => !results[plan.index].error),
            MINT_RECIPIENT_CONCURRENCY,
            async ({ index, grantee, existing }) => {
                try {
                    const row = existing
                        ? await this.#changeShare(actor, existing, grantee, {
                              permission: keepLevel
                                  ? existing.permission
                                  : permission,
                              label,
                          })
                        : await this.#grantAndMint(actor, grantee, {
                              ownerUserId,
                              appUid,
                              keyPrefix,
                              permission,
                              label: label ?? null,
                          });
                    results[index].share = this.#view(row, grantee.username);
                } catch (err) {
                    if (!isHttpError(err)) throw err;
                    results[index].error = err;
                }
            },
        );
        for (const [index, first] of duplicates)
            results[index] = { ...results[first] };
        return results;
    }

    /**
     * What a new share to this holder must pass beyond the caps: not yourself,
     * no case-variant prefix, not blocked, and under the per-holder cap.
     */
    async #assertNewShareFor(
        ownerUserId: number,
        grantee: Grantee,
        region: FindLiveKvShareHandleInput,
    ): Promise<void> {
        if (grantee.id === ownerUserId)
            throw badRequest(
                'cannot grant permissions to yourself',
                'bad_request',
            );
        if (await this.stores.kvShareHandle.hasLiveCaseVariant(region))
            throw kvSharePrefixCaseConflict();
        if (
            await refusesSharesFrom(this.stores.userBlock, grantee, ownerUserId)
        )
            throw recipientNotAcceptingShares();
        const held =
            await this.stores.kvShareHandle.countLiveForOwnerAndGrantee(
                ownerUserId,
                grantee.id,
            );
        if (held >= EVENTS_KV_HANDLES_PER_HOLDER)
            throw handleQuotaReached(EVENTS_KV_HANDLES_PER_HOLDER, 'holder');
    }

    /**
     * One new share: the grant, then its handle, then the holder's notice. One
     * mint per region at a time, so racing mints of it make one handle: the
     * ones that wait their turn get it back as it stands.
     */
    async #grantAndMint(
        actor: Actor,
        grantee: Grantee,
        share: NewShare,
    ): Promise<KvShareHandle> {
        const region = {
            ownerUserId: share.ownerUserId,
            granteeUserId: grantee.id,
            appUid: share.appUid,
            keyPrefix: share.keyPrefix,
        };
        const mintUnlessLive = async () => {
            const existing = await this.stores.kvShareHandle.findLive(region);
            if (existing) return { row: existing, minted: false };
            return {
                row: await this.#grantAndInsert(actor, grantee, share),
                minted: true,
            };
        };
        // A mint that waits out the lock looks again and goes ahead: the
        // holder is far likelier slow than doing anything but this same mint.
        const { row, minted } = await withRedisLock(
            this.clients.redis,
            `kvShare:mint:${region.ownerUserId}:${region.granteeUserId}:` +
                `${region.appUid}:${region.keyPrefix}`,
            mintUnlessLive,
            {
                ttlMs: SHARE_CHANGE_LOCK_MS,
                attempts: SHARE_CHANGE_LOCK_ATTEMPTS,
                retryMs: SHARE_CHANGE_LOCK_RETRY_MS,
                onUnavailable: 'run',
                onBusy: () => mintUnlessLive(),
            },
        );
        if (minted) await this.#notifyReceived(row);
        return row;
    }

    /** {@link #grantAndMint} under its lock, with no live handle on the region. */
    async #grantAndInsert(
        actor: Actor,
        grantee: Grantee,
        share: NewShare,
    ): Promise<KvShareHandle> {
        await this.#retireOlderThanApp(
            share.ownerUserId,
            grantee.id,
            share.appUid,
        );
        // The user behind the app, so the authority checked is theirs. Which
        // app acted goes on the audit row, not in the grant's authority.
        const authority = userRelatedActor(actor);
        const meta = {
            reason: 'kv share handle',
            appUid: actor.effectiveApp?.uid,
        };
        // No live handle names this region, so a grant on exactly it at
        // another level is left over from a retired one.
        const stale = kvShareGrantAtEveryLevel(share.permission).filter(
            (other) => other !== share.permission,
        );
        if (
            await this.services.permission.hasUserUserGrant(
                grantee.id,
                share.ownerUserId,
                stale,
            )
        )
            await this.services.permission.revokeUserUserPermissions(
                authority,
                grantee.username,
                stale,
                meta,
            );
        await this.services.permission.grantUserUserPermission(
            authority,
            grantee.username,
            share.permission,
            {},
            meta,
        );

        return this.stores.kvShareHandle.mint({
            ownerUserId: share.ownerUserId,
            granteeUserId: grantee.id,
            appUid: share.appUid,
            keyPrefix: share.keyPrefix,
            permission: share.permission,
            label: share.label,
        });
    }

    /**
     * Tell the holder, in the app whose data it is, that a share arrived, never
     * naming the owner. Best-effort and bounded per owner and holder: the share
     * stands either way.
     */
    async #notifyReceived(row: KvShareHandle): Promise<void> {
        if (row.appUid === KV_GLOBAL_APP_KEY) return;
        try {
            const allowed = await checkRateLimit(
                `${KV_SHARE_NOTICE_LIMIT.scope}:${row.ownerUserId}:${row.granteeUserId}`,
                KV_SHARE_NOTICE_LIMIT.limit,
                KV_SHARE_NOTICE_LIMIT.window,
            );
            if (!allowed) return;
            await this.services.notification.notify(
                [row.granteeUserId],
                {
                    handle: row.handle,
                    access: kvShareAccessOf(row.permission) ?? 'watch',
                    label: row.label,
                    createdAt: row.createdAt,
                },
                { type: 'kv.share.received', appUid: row.appUid },
            );
        } catch (err) {
            console.warn('[kvShare] share notification failed', err);
        }
    }

    /**
     * A level or label change on a live handle, keeping its id. One change per
     * handle at a time, applied to the row as it then stands, so two racing
     * changes can't leave a grant the row doesn't name.
     */
    async #changeShare(
        actor: Actor,
        existing: KvShareHandle,
        holder: UserRow & { id: number; username: string },
        wanted: { permission: string; label: string | null | undefined },
    ): Promise<KvShareHandle> {
        if (!shareChanges(existing, wanted)) return existing;
        return withRedisLock(
            this.clients.redis,
            `kvShare:change:${existing.handle}`,
            async () => {
                const current = await this.stores.kvShareHandle.getByHandle(
                    existing.handle,
                );
                if (!current || current.revokedAt !== null)
                    throw unknownKvShareHandle(existing.handle);
                return this.#applyShareChange(actor, current, holder, wanted);
            },
            {
                ttlMs: SHARE_CHANGE_LOCK_MS,
                attempts: SHARE_CHANGE_LOCK_ATTEMPTS,
                retryMs: SHARE_CHANGE_LOCK_RETRY_MS,
                onUnavailable: 'run',
                onBusy: () => {
                    throw tooManyCalls();
                },
            },
        );
    }

    /**
     * {@link #changeShare} under its lock. The new grant lands before the old
     * one goes (exactly, so narrower handles keep theirs), and every step is
     * safe to retry.
     */
    async #applyShareChange(
        actor: Actor,
        existing: KvShareHandle,
        holder: UserRow & { id: number; username: string },
        wanted: { permission: string; label: string | null | undefined },
    ): Promise<KvShareHandle> {
        const levelChanges = existing.permission !== wanted.permission;
        const labelChanges =
            wanted.label !== undefined && wanted.label !== existing.label;
        if (!levelChanges && !labelChanges) return existing;

        // An app also needs the consent the share stands on, as it would to
        // revoke it.
        if (actor.effectiveApp)
            await this.#assertKvShareDelegated(actor, existing.permission);

        // A holder who now refuses this owner's shares can still be narrowed
        // or have the label cleared, and nothing more.
        const raises =
            levelChanges &&
            levelRank(wanted.permission) > levelRank(existing.permission);
        const relabels = labelChanges && wanted.label !== null;
        if (
            (raises || relabels) &&
            (await refusesSharesFrom(
                this.stores.userBlock,
                holder,
                existing.ownerUserId,
            ))
        )
            throw recipientNotAcceptingShares();

        const authority = userRelatedActor(actor);
        const meta = {
            reason: 'kv share handle level changed',
            appUid: actor.effectiveApp?.uid,
        };
        if (levelChanges) {
            await this.services.permission.grantUserUserPermission(
                authority,
                holder.username,
                wanted.permission,
                {},
                meta,
            );
            await this.services.permission.revokeUserUserPermission(
                authority,
                holder.username,
                existing.permission,
                meta,
            );
        }
        const updated = await this.stores.kvShareHandle.update(
            existing.handle,
            existing.ownerUserId,
            {
                ...(levelChanges ? { permission: wanted.permission } : {}),
                ...(labelChanges ? { label: wanted.label } : {}),
            },
        );
        if (updated && updated.revokedAt === null) return updated;
        // Retired meanwhile: the retire withdrew the region before the grant
        // above landed, so that grant is withdrawn here.
        if (levelChanges)
            await this.services.permission.revokeUserUserPermission(
                authority,
                holder.username,
                wanted.permission,
                meta,
            );
        throw unknownKvShareHandle(existing.handle);
    }

    #view(row: KvShareHandle, holderUsername: string): KvShareView {
        return {
            handle: row.handle,
            prefix: row.keyPrefix,
            access: kvShareAccessOf(row.permission) ?? 'watch',
            appUid: row.appUid,
            holderUsername,
            label: row.label,
            createdAt: row.createdAt,
        };
    }

    /**
     * Which namespace a mint may name. An app reaches `v1:<user>:<its own app>`
     * and nothing else, so a request naming another one is refused rather than
     * quietly minted somewhere the app cannot even write. An account names an
     * app that exists, since the share notifies its holder inside that app.
     */
    async #mintNamespace(
        app: Actor['effectiveApp'],
        request: KvShareMintFields,
    ): Promise<string> {
        const named = parseAppUid(request.appUid);
        if (app) {
            if (named !== null && named !== app.uid)
                throw handleOutsideNamespace();
            return app.uid;
        }
        const appUid = assertShareableAppUid(named ?? KV_GLOBAL_APP_KEY);
        if (
            appUid !== KV_GLOBAL_APP_KEY &&
            !(await this.stores.app.getByUid(appUid))
        )
            throw invalidAppUid('`appUid` does not name a namespace');
        return appUid;
    }

    /**
     * Whether this app was given the region to hand out. The `manage:` grant is
     * the user's consent, and prefix implication makes one taken on a region
     * cover the keys beneath it — so a handle deeper than the consent is still
     * inside it, and one above it is not.
     */
    async #assertKvShareDelegated(
        actor: Actor,
        permission: string,
    ): Promise<void> {
        // Consequential enough to require the app's own session, whatever a
        // token it minted happens to carry.
        if (isAccessTokenActor(actor)) throw handleAccessTokenForbidden();
        // The consent surface refuses a namespace-root delegation because no
        // prompt can describe it; refused here too, so a row written any other
        // way cannot authorize a mint.
        assertBoundedManageGrant(kvShareManagePermission(permission));
        const delegated = await this.services.permission.canManagePermission(
            actor,
            permission,
        );
        if (!delegated) throw handleNotDelegated();
        // `canManagePermission` walks ancestors, so a namespace-root grant
        // written by any path other than the consent surface would otherwise
        // authorize a mint anywhere in the namespace, bounded region or not.
        // Asked at every level, whatever level this mint is at.
        const unbounded = await this.services.permission.check(
            actor,
            kvShareManageNamespaceRoots(permission),
        );
        if (unbounded) throw handleNotDelegated();
    }

    /**
     * Take a shared region back, as its owner. The alias route's revoke: a
     * handle this account did not mint reads as absent, whoever holds it.
     *
     * Not gated on any feature flag. Withdrawing access only ever narrows, and
     * an install that turned sharing off must still be able to retire what it
     * has.
     */
    async revokeKvHandle(
        actor: Actor,
        handle: unknown,
    ): Promise<RetiredKvShare> {
        const owner = actor.user;
        if (owner?.id === undefined) throw handleOwnerOnly();
        this.#assertOwnerSurface(actor);

        await this.#spendHandleBudget(owner.id);

        const named = typeof handle === 'string' ? handle : '';
        const share = await this.stores.kvShareHandle.getByHandle(named);
        // Unknown and somebody else's read the same way, so revoking cannot be
        // used to find out that a handle exists.
        if (!share || share.ownerUserId !== owner.id)
            throw unknownKvShareHandle(named);
        return this.#revokeAsOwner(actor, share);
    }

    /**
     * Stop a share from either side, the role read off the row: its owner
     * revokes it, its holder gives it up, and anyone else is told it is not
     * there.
     */
    async removeKvShare(
        actor: Actor,
        handle: unknown,
    ): Promise<RetiredKvShare> {
        const named = typeof handle === 'string' ? handle : '';
        const userId = actor.user?.id;
        if (userId === undefined) throw unknownKvShareHandle(named);

        await this.#spendHandleBudget(userId);

        const share = await this.stores.kvShareHandle.getByHandle(named);
        if (share?.ownerUserId === userId) {
            this.#assertOwnerSurface(actor);
            return this.#revokeAsOwner(actor, share);
        }
        if (
            share?.granteeUserId === userId &&
            this.#holderSurface(actor, share)
        )
            return this.#unshareAsHolder(actor, share);
        throw unknownKvShareHandle(named);
    }

    /**
     * `appUid`'s app when its uid was held by a deleted app before, so handles
     * in its namespace can be older than it; `null` otherwise, which spares the
     * caller looking at handles at all.
     */
    async #reusedUidApp(
        appUid: string,
    ): Promise<{ created_epoch?: unknown } | null> {
        if (appUid === KV_GLOBAL_APP_KEY) return null;
        const app = await this.stores.app.getByUid(appUid);
        if (appGenerationStart(app) === null) return null;
        const deleted = await this.stores.app.getDeletedOwnersByUids([appUid]);
        return deleted.has(appUid) ? app : null;
    }

    /**
     * Whether a share grant the user holds was made for the app its namespace
     * names now, not an earlier app under the same uid: a live handle of theirs
     * no older than the app covers the region at the level asked.
     */
    async #grantForCurrentApp(
        user: Actor,
        permission: string,
    ): Promise<boolean> {
        const [, ownerUuid, appUid] = PermissionUtil.split(permission);
        if (!ownerUuid || !appUid) return true;
        const app = await this.#reusedUidApp(appUid);
        if (!app) return true;

        const owner = await this.stores.user.getByUuid(ownerUuid);
        const holderId = user.user?.id;
        if (owner?.id === undefined || typeof holderId !== 'number')
            return false;
        const held = await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
            owner.id,
            holderId,
        );
        return held.some(
            (row) =>
                row.appUid === appUid &&
                !predatesApp(row.createdAt, app) &&
                kvShareGrantCovers(row.permission, permission) &&
                levelRank(row.permission) >= levelRank(permission),
        );
    }

    /**
     * Retire, grants and all, the live handles this owner gave this holder in
     * `appUid`'s namespace for an earlier app under the uid. Done before a new
     * share between them lands, so no withdrawal of the old ones can take the
     * new grant with it, and no old grant outlives them inside its region.
     */
    async #retireOlderThanApp(
        ownerUserId: number,
        granteeUserId: number,
        appUid: string,
    ): Promise<void> {
        const app = await this.#reusedUidApp(appUid);
        if (!app) return;
        let older: KvShareHandle[] = (
            await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
                ownerUserId,
                granteeUserId,
            )
        ).filter(
            (row) => row.appUid === appUid && predatesApp(row.createdAt, app),
        );
        if (older.length === 0) return;
        await this.#retireAsSystem(
            async () => {
                const batch = older;
                older = [];
                return batch;
            },
            'kv share app uid reused',
            Infinity,
        );
    }

    /** Whether the actor's user still has its app authorized. */
    async #appAuthorized(actor: Actor): Promise<boolean> {
        const userId = actor.user?.id;
        const app = actor.effectiveApp;
        if (typeof userId !== 'number' || !app) return false;
        const appId = app.id ?? (await this.stores.app.getByUid(app.uid))?.id;
        if (typeof appId !== 'number') return false;
        return this.stores.permission.hasAnyUserAppPerm(userId, appId);
    }

    /**
     * The account, or an app acting for it. An unresolved app (`undefined`) and
     * a token an app issued are neither.
     */
    #assertOwnerSurface(actor: Actor): void {
        if (actor.effectiveApp === undefined) throw handleOwnerOnly();
        if (isAccessTokenActor(actor) && !isAccountContext(actor))
            throw handleOwnerOnly();
    }

    /**
     * Whether this actor may give up a share its user holds: the account, or
     * the app whose namespace the share is in. Any other app of the same user
     * gets the answer a stranger gets.
     */
    #holderSurface(actor: Actor, share: KvShareHandle): boolean {
        const app = actor.effectiveApp;
        if (app === undefined) return false;
        if (isAccessTokenActor(actor) && !isAccountContext(actor)) return false;
        return app === null || share.appUid === app.uid;
    }

    /**
     * The grant goes first, at every level with its subtree, then the handle is
     * retired, so a failure anywhere is a retry. Then the grant goes again: a
     * level change that landed between the two still saw a live row.
     */
    async #revokeAsOwner(
        actor: Actor,
        share: KvShareHandle,
    ): Promise<RetiredKvShare> {
        const app = actor.effectiveApp;
        // An app reaches one namespace, so a handle outside it is not its to
        // take back — checked after the owner test, which must answer first.
        if (app && share.appUid !== app.uid) throw handleOwnerOnly();
        // The same consent the mint took: a withdrawn delegation withdraws the
        // app's surface on the region with it.
        if (app) await this.#assertKvShareDelegated(actor, share.permission);
        // Revoking again would withdraw the region from a newer share of it.
        if (share.revokedAt !== null)
            return { handle: share.handle, revokedAt: share.revokedAt };

        const granteeName = (
            await this.stores.user.getById(share.granteeUserId)
        )?.username;
        if (!granteeName)
            throw new HttpError(500, 'The grantee of this handle is gone', {
                legacyCode: 'internal_error',
            });
        const withdraw = () =>
            this.services.permission.revokeUserUserPermissionSubtree(
                userRelatedActor(actor),
                granteeName,
                kvShareGrantAtEveryLevel(share.permission),
                { reason: 'kv share handle revoked', appUid: app?.uid },
            );
        await withdraw();

        const revoked = await this.stores.kvShareHandle.retire(
            share.handle,
            share.ownerUserId,
        );
        if (!revoked?.revokedAt) throw unknownKvShareHandle(share.handle);

        // A narrower handle to the same grantee sits inside this one's
        // subtree, which the revoke above just withdrew at every level — so
        // its grant is already gone even though its own row still reads live.
        const covered = await this.#retireCoveredHandles(revoked);
        await withdraw();
        await this.#announceRetired([revoked, ...covered]);

        return { handle: revoked.handle, revokedAt: revoked.revokedAt };
    }

    /**
     * Every other live handle to this grantee that the just-withdrawn grant
     * covered, at any level, retired in one statement. Coverage runs on the
     * permission string, whose namespace app uid sits below the root, so a
     * covered handle is always inside the same namespace.
     */
    async #retireCoveredHandles(
        revoked: KvShareHandle,
    ): Promise<KvShareHandle[]> {
        const covered = (
            await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
                revoked.ownerUserId,
                revoked.granteeUserId,
            )
        ).filter(
            (row) =>
                row.handle !== revoked.handle &&
                kvShareGrantCovers(revoked.permission, row.permission),
        );
        await this.stores.kvShareHandle.retireMany(
            covered.map((row) => row.handle),
            'owner',
            { ownerUserId: revoked.ownerUserId },
        );
        return covered;
    }

    /**
     * A holder giving up a share and every narrower one of theirs from the same
     * owner inside it, since they can't see prefixes. Exact revokes at every
     * level, so their other handles keep working; revoked again after the
     * retire for a level change that landed in between.
     */
    async #unshareAsHolder(
        actor: Actor,
        share: KvShareHandle,
    ): Promise<RetiredKvShare> {
        if (share.revokedAt !== null)
            return { handle: share.handle, revokedAt: share.revokedAt };

        const holderName = (await this.stores.user.getById(share.granteeUserId))
            ?.username;
        if (!holderName) throw unknownKvShareHandle(share.handle);

        const siblings =
            await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
                share.ownerUserId,
                share.granteeUserId,
            );
        const nested = siblings.filter(
            (row) =>
                row.handle !== share.handle &&
                kvShareGrantCovers(share.permission, row.permission),
        );
        const withdraw = () =>
            this.services.permission.revokeUserUserPermissions(
                userRelatedActor(actor),
                holderName,
                [share, ...nested].flatMap((row) =>
                    kvShareGrantAtEveryLevel(row.permission),
                ),
                {
                    reason: 'kv share handle unshared',
                    appUid: actor.effectiveApp?.uid,
                },
                { issuerUserId: share.ownerUserId },
            );
        await withdraw();

        // The nested ones first: a handle that reads as retired is how a
        // retry knows the whole unshare finished.
        await this.stores.kvShareHandle.retireMany(
            nested.map((row) => row.handle),
            'holder',
            { granteeUserId: share.granteeUserId },
        );
        const retired = await this.stores.kvShareHandle.retireAsHolder(
            share.handle,
            share.granteeUserId,
        );
        if (!retired?.revokedAt) throw unknownKvShareHandle(share.handle);
        await withdraw();
        await this.#announceRetired([retired, ...nested]);
        return { handle: retired.handle, revokedAt: retired.revokedAt };
    }

    /**
     * Retire every live handle in deleted apps' namespaces as the platform's.
     * Each app's retire is recorded before it runs, and what one run doesn't
     * finish carries on in the background. Resolves with the handles retired
     * here; rejects, after alarming, when a run failed.
     */
    async retireForDeletedApps(appUids: readonly string[]): Promise<number> {
        const cutoff = nowSeconds();
        const uids = [...new Set(appUids)].filter(
            (uid) => uid !== KV_GLOBAL_APP_KEY,
        );
        let retired = 0;
        let failure: unknown;
        await runWithConcurrencyLimit(
            uids,
            JOB_START_CONCURRENCY,
            async (appUid) => {
                try {
                    retired += (await this.#retireApp(appUid, cutoff)).retired;
                } catch (err) {
                    failure ??= err;
                }
            },
        );
        if (failure !== undefined) throw failure;
        return retired;
    }

    /**
     * Retire, in the background, the live handles an earlier app under `app`'s
     * uid left in its namespace. They already read as gone, being older than
     * the app; this withdraws their grants and ends what was made through them.
     * Never throws.
     */
    retireSharesOlderThanApp(app: { uid: string; created_epoch?: unknown }) {
        const start = appGenerationStart(app);
        if (start === null || app.uid === KV_GLOBAL_APP_KEY) return;
        void (async () => {
            try {
                await this.#retireApp(app.uid, start - 1);
            } catch {
                // Alarmed, and retried from its record.
            }
        })();
    }

    /** One app's retire: nothing to record when it has no live handles. */
    async #retireApp(appUid: string, cutoff: number): Promise<KvShareJobRun> {
        const job: KvShareJob = { kind: 'app', appUid, cutoff };
        const live = await this.stores.kvShareHandle.listLiveForApps(
            [appUid],
            1,
            cutoff,
        );
        if (live.length === 0) return { done: true, retired: 0 };
        await this.#recordJob(job);
        return this.#runJob(jobKey(job));
    }

    /**
     * Retire every live handle a user holds, before their account's rows
     * cascade away, and tell each owner: what they subscribed to through it
     * ends. The grants go with the account.
     */
    async retireForDeletedHolder(userId: number): Promise<number> {
        let retired = 0;
        let afterId = 0;
        for (;;) {
            const batch = await this.stores.kvShareHandle.listLiveHeldBy(
                userId,
                afterId,
            );
            if (batch.length === 0) return retired;
            await this.stores.kvShareHandle.retireMany(
                batch.map((row) => row.handle),
                'system',
            );
            await this.#announceRetired(batch, userId);
            retired += batch.length;
            if (batch.length < KV_HANDLE_RETIRE_BATCH) return retired;
            afterId = batch[batch.length - 1].id;
        }
    }

    /**
     * Retire what `nextBatch` lists until a batch comes back short or the
     * deadline passes. Grants go before handles, so a retry after a failure
     * still finds them, and a later share of the same region can't inherit
     * them.
     */
    async #retireAsSystem(
        nextBatch: () => Promise<KvShareHandle[]>,
        reason: string,
        deadline: number,
    ): Promise<KvShareJobRun> {
        let retired = 0;
        for (;;) {
            const batch = await nextBatch();
            await this.#withdrawRetiredGrants(batch, reason);
            await this.stores.kvShareHandle.retireMany(
                batch.map((row) => row.handle),
                'system',
            );
            await this.#announceRetired(batch);
            retired += batch.length;
            if (batch.length < KV_HANDLE_RETIRE_BATCH)
                return { done: true, retired };
            if (this.#stopping || Date.now() >= deadline)
                return { done: false, retired };
        }
    }

    /**
     * Each handle's region, at every level and beneath, withdrawn in one revoke
     * per owner, holder and app.
     */
    async #withdrawRetiredGrants(
        rows: readonly KvShareHandle[],
        reason: string,
    ): Promise<void> {
        const groups = new Map<string, KvShareHandle[]>();
        for (const row of rows) {
            const key = `${row.ownerUserId}:${row.granteeUserId}:${row.appUid}`;
            groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        if (groups.size === 0) return;
        const users = await this.stores.user.getByIds([
            ...new Set(
                rows.flatMap((row) => [row.ownerUserId, row.granteeUserId]),
            ),
        ]);
        await runWithConcurrencyLimit(
            [...groups.values()],
            RETIRE_SETTLE_CONCURRENCY,
            async (group) => {
                const owner = users.get(group[0].ownerUserId);
                const holder = users.get(group[0].granteeUserId);
                // A deleted account's grants went with it.
                if (!owner?.uuid || !holder?.username) return;
                await this.services.permission.revokeUserUserPermissionSubtree(
                    makeActor({ user: owner }),
                    holder.username,
                    group.flatMap((row) =>
                        kvShareGrantAtEveryLevel(row.permission),
                    ),
                    { reason, appUid: group[0].appUid },
                );
            },
        );
    }

    /**
     * Tell listeners which handles stopped being addresses, one event per user
     * who could have subscribed through them (owner and holder alike), and wait
     * for them: what was made through a handle ends with it. `except` is a user
     * whose account is going, and its subscriptions with it.
     */
    async #announceRetired(
        rows: readonly KvShareHandle[],
        except?: number,
    ): Promise<void> {
        const byUser = new Map<number, Set<string>>();
        for (const row of rows)
            for (const userId of [row.granteeUserId, row.ownerUserId]) {
                if (userId === except) continue;
                byUser.set(
                    userId,
                    (byUser.get(userId) ?? new Set()).add(row.handle),
                );
            }
        await runWithConcurrencyLimit(
            [...byUser],
            RETIRE_SETTLE_CONCURRENCY,
            ([userId, handles]) =>
                this.clients.event.emitAndWait(
                    'kv.share.retired',
                    { handles: [...handles], userId },
                    {},
                ),
        );
    }

    /**
     * What this account has shared out of its key-value data, retired handles
     * included: they are the only record of what was shared and when it
     * stopped.
     */
    async listKvHandles(
        actor: Actor,
        options: KvShareOwnerListOptions = {},
    ): Promise<PageResult<KvShareOwnerView>> {
        const owner = actor.user;
        if (owner?.id === undefined) throw handleOwnerOnly();
        this.#assertOwnerSurface(actor);

        // An app sees its own namespace and nothing else; an account session
        // sees across apps, which is what makes the account the surface for a
        // row whose app is long gone. Listing disposes of nothing, so the gate
        // is app-ness and the namespace rather than the region's delegation.
        const page = await this.stores.kvShareHandle.listForOwner(owner.id, {
            limit: options.limit,
            cursor: options.cursor,
            includeTotal: options.includeTotal,
            appUid: listingNamespace(
                actor.effectiveApp ?? null,
                options.appUid,
            ),
            state: options.state,
        });
        const holders = await this.stores.user.getByIds([
            ...new Set(page.items.map((row) => row.granteeUserId)),
        ]);

        return {
            ...page,
            items: page.items.map((row) =>
                ownerView(
                    row,
                    holders.get(row.granteeUserId)?.username ?? null,
                ),
            ),
        };
    }

    /**
     * Live shares held by this account, by handle, level, app and label only.
     * An app sees its own namespace, the account every app's; an unresolved app
     * or a scoped token sees nothing.
     */
    async listKvSharesWithMe(
        actor: Actor,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<HeldKvShareHandle>> {
        const holderId = actor.user?.id;
        const app = actor.effectiveApp;
        if (holderId === undefined || app === undefined) return { items: [] };
        if (isAccessTokenActor(actor) && !isAccountContext(actor))
            return { items: [] };

        return this.stores.kvShareHandle.listLiveForGrantee(holderId, {
            limit: options.limit,
            cursor: options.cursor,
            includeTotal: options.includeTotal,
            appUid: listingNamespace(app, options.appUid),
        });
    }

    /** Who a mint is for. Named by username or uuid; unknown reads as absent. */
    async #resolveGrantee(recipient: KvShareRecipient): Promise<Grantee> {
        const username =
            typeof recipient?.username === 'string'
                ? recipient.username.trim()
                : '';
        const uid =
            typeof recipient?.uid === 'string' ? recipient.uid.trim() : '';
        if (!username && !uid)
            throw badRequest(
                'Name the recipient by username or user uid',
                'bad_request',
            );

        const user = username
            ? await this.stores.user.getByUsername(username)
            : await this.stores.user.getByUuid(uid);
        if (!user?.username || user.id === undefined)
            throw new HttpError(404, 'user_does_not_exist', {
                legacyCode: 'subject_does_not_exist',
            });
        return { ...user, id: user.id, username: user.username };
    }

    /**
     * How many handles this caller's plan lets the account hold out, in total
     * and in one namespace. Resolved before the idempotent answer on the mint
     * path, so a plan that may hold none is refused whatever it asks for.
     *
     * A deployment with no metering has no plans to read, and is held to the
     * paid caps.
     */
    async #handleQuota(actor: Actor): Promise<TieredQuota> {
        const plan = await actorPlanId(this.services.metering, actor);
        if (plan !== null && limitFor(EVENTS_KV_HANDLES_PER_USER, plan) === 0)
            throw kvHandleNeedsAccount();
        return {
            perUser: limitFor(EVENTS_KV_HANDLES_PER_USER, plan),
            perApp: limitFor(EVENTS_KV_HANDLES_PER_APP, plan),
        };
    }

    /**
     * Whether this account may hold out `adding` more share handles, in total
     * and in the namespace this mint names. Retired ones do not count.
     * Check-then-act: two mints racing past it can both proceed, which the
     * budgets bound well enough for an abuse backstop.
     */
    async #assertHandleCeiling(
        userId: number,
        appUid: string,
        quota: TieredQuota,
        adding: number,
    ): Promise<void> {
        if (adding === 0) return;
        const live = await this.stores.kvShareHandle.countLiveForOwner(
            userId,
            appUid,
        );
        if (live.total + adding > quota.perUser)
            throw handleQuotaReached(quota.perUser, 'account');
        // The global namespace is the account's own shelf rather than an
        // app's, so the account cap is its only bound.
        if (appUid !== KV_GLOBAL_APP_KEY && live.forApp + adding > quota.perApp)
            throw handleQuotaReached(quota.perApp, 'app');
    }

    /**
     * One unit per recipient from each grant window. All or nothing: a batch
     * that doesn't fit is refused, and what it claimed of the window stays
     * spent.
     */
    async #spendGrantBudget(userId: number, units: number): Promise<void> {
        if (units === 0) return;
        for (const window of KV_SHARE_GRANT_LIMITS) {
            const admitted = await claimRateLimit(
                `${window.scope}:${userId}`,
                window.limit,
                window.window,
                units,
            );
            if (admitted < units) throw tooManyCalls();
        }
    }

    async #spendHandleBudget(userId: number): Promise<void> {
        const ok = await checkRateLimit(
            `${EVENTS_KV_HANDLE_LIMIT.scope}:${userId}`,
            EVENTS_KV_HANDLE_LIMIT.limit,
            EVENTS_KV_HANDLE_LIMIT.window,
        );
        if (!ok) throw tooManyCalls();
    }
}
