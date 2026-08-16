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

import murmurhash from 'murmurhash';
import type { Actor } from '../../core/actor';
import { isSystemActor } from '../../core/actor';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterService } from '../types';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
    GLOBAL_APP_KEY,
    METRICS_PREFIX,
    MONTHLY_CHARGE_CLAIM,
    PERIOD_ESCAPE,
    POLICY_PREFIX,
    UNLIMITED_SUBSCRIPTION,
} from './consts';
import { EGRESS_COSTS } from './costs';
import type {
    AppTotals,
    CreditHold,
    UsageAddons,
    UsageByType,
    UsageInput,
    UsageRecord,
} from './types';
import { NO_CREDIT_HOLD } from './types';

import { LOCAL_UNLIMITED_USER } from '../../data/subPolicies/localUnlimitedUserPolicy.js';
import { SUB_POLICIES } from '../../data/subPolicies/index.js';
import { REGISTERED_USER_FREE } from '../../data/subPolicies/registeredUserFreePolicy.js';
import { runWithConcurrencyLimitSettled } from '../../util/concurrency.js';

// -- Types ------------------------------------------------------------

type SubscriptionPolicy = (typeof SUB_POLICIES)[number];

export type SubscriptionResolver = (
    actor: Actor,
) => Promise<string | null | undefined> | string | null | undefined;

// -- Helpers ----------------------------------------------------------

/**
 * How an actor is named in metering alarms. Email is what someone reading the
 * alert actually needs to find the account; username and uuid are fallbacks for
 * actors that have no email (temp accounts).
 */
function actorLabel(actor: Actor): string {
    return (
        actor.user?.email ??
        actor.user?.username ??
        actor.user?.uuid ??
        'unknown-user'
    );
}

// -- MeteringService --------------------------------------------------

/**
 * Tracks per-actor and global usage, and exposes subscription/addon lookup. All
 * metering data is persisted under the system namespace via `stores.kv`
 * (SystemKVStore)
 *
 * Callers (typically drivers or controllers) pass the user-scoped actor in; we
 * fan that out into several aggregated KV records.
 */
export class MeteringService extends PuterService {
    /**
     * How wide the global and per-app aggregates are spread. These are counters
     * many actors increment at once, so spreading them keeps any single record
     * from being written by everyone — including from several deployments
     * concurrently, where writes to one record can otherwise lose an increment.
     * The width is why reading an aggregate has to sum every shard.
     */
    static GLOBAL_SHARD_COUNT = 10000;
    static APP_SHARD_COUNT = 10000;

    /**
     * Share of the allowance past which an approximate running total is no
     * longer good enough to decide on.
     */
    static PRECISION_THRESHOLD = 0.9;

    /**
     * How many actors this deployment remembers as settled for the month. The
     * claim in the KV store is what makes monthly charges once-only; this
     * memory only saves the round trip that would discover that, so forgetting
     * it costs a claim write and nothing else.
     */
    static MONTHLY_CHARGE_MEMO_LIMIT = 100_000;

    /**
     * How long a resolved subscription is reused before asking the resolvers
     * again, and how many actors are remembered at once. Rate/concurrency gates
     * resolve the subscription on every gated request, and a resolver may reach
     * a remote store to answer — without this, adding a tiered limit to a hot
     * route would add a round trip to that route.
     *
     * This is the backstop, not the mechanism: a change we know about is
     * announced to every node by `invalidateActorSubscription` and applies at
     * once. The window only bounds staleness for changes nobody told us about —
     * a resolver reading state that moved underneath it, or a node that missed
     * the announcement.
     */
    static SUBSCRIPTION_CACHE_MS = 60_000;
    static SUBSCRIPTION_CACHE_LIMIT = 50_000;

    /**
     * How long "does this actor have budget left" is reused before being
     * recomputed, and how many actors are remembered at once.
     *
     * This answer gates operations that arrive by the hundred per minute and
     * cost a fraction of a microcent each — file reads, KV calls — so computing
     * it per request would put two store reads in front of every one of them,
     * costing more than the operations being gated. The window is deliberately
     * a little wider than `USAGE_BUFFER_FLUSH_MS`: the buffered usage those
     * operations produce settles on that cycle, and settling is what refreshes
     * this (see `rememberRemainingCredits`), so an active actor's answer is
     * normally replaced by a write that was happening anyway rather than by a
     * read this cache had to make.
     *
     * Staleness is bounded by the same argument that bounds the buffer: the
     * usage in flight is worth a fraction of a microcent per request, and
     * request count is bounded by the rate and concurrency limits the same
     * routes declare. A change we know about — a purchase, a plan change — is
     * announced and applied at once rather than waited out.
     */
    static CREDIT_CACHE_MS = 15_000;
    static CREDIT_CACHE_LIMIT = 50_000;

    /**
     * How long usage that isn't decided on may sit in memory before it is
     * written, and how many actor buckets are held at once. Egress and
     * object-store requests arrive once per HTTP request and cost a fraction of
     * a microcent each; writing them as they land would spend more on metering
     * than the usage is worth. The window is the exposure: a host lost without
     * warning takes at most this much unbilled usage with it.
     */
    static USAGE_BUFFER_FLUSH_MS = 10_000;
    static USAGE_BUFFER_LIMIT = 5_000;

    /** Buckets written at once per flush. Matches the buffer store's own pacing. */
    static USAGE_FLUSH_CONCURRENCY = 20;

    private rateCheckTimer: ReturnType<typeof setInterval> | null = null;
    private usageBufferTimer: ReturnType<typeof setInterval> | null = null;
    private extraPolicies: SubscriptionPolicy[] = [];
    private subscriptionResolvers: SubscriptionResolver[] = [];
    private defaultSubscriptionResolvers: SubscriptionResolver[] = [];

    /** Uuid → resolved policy + expiry. See SUBSCRIPTION_CACHE_MS. */
    private subscriptionCache = new Map<
        string,
        { policy: SubscriptionPolicy; expiresAt: number }
    >();

    /** Uuid → whether the actor had budget left. See CREDIT_CACHE_MS. */
    private creditCache = new Map<
        string,
        { hasCredits: boolean; expiresAt: number }
    >();

    /**
     * Uuid → the refresh currently running for it, so concurrent requests share
     * one. This matters most where there is nothing cached at all: a process
     * that has just started, or an actor evicted from the cache, has every
     * request that arrives before the first answer landing on the same three
     * store reads. One per actor, not one per request.
     */
    private creditRefreshes = new Map<string, Promise<void>>();

    /** Actors settled for `settledMonth`; see MONTHLY_CHARGE_MEMO_LIMIT. */
    private settledMonth: string | null = null;
    private settledActors = new Set<string>();
    /**
     * Actors with a claim in flight. Unlike `settledActors` this is never
     * dropped early, because it is what stops a second claim inside the first:
     * applying the charges goes back through `batchIncrementUsages`, which
     * arrives here again for the same actor and month.
     */
    private claimsInFlight = new Set<string>();

    /**
     * Usage waiting to be written, keyed by actor and app so each bucket
     * settles against the same records a direct increment would have. Holds the
     * actor it was recorded for — the flush needs a subject, and the buckets
     * are capped.
     */
    private usageBuffer = new Map<
        string,
        {
            actor: Actor;
            amounts: Map<string, { units: number; cost: number }>;
        }
    >();

    /** The flush cycle currently running, so ticks join it instead of stacking. */
    private usageFlushInFlight: Promise<void> | null = null;

    // -- Lifecycle ----------------------------------------------------

    override onServerStart(): void {
        // Applied, not re-announced: the sender already fanned this out, and
        // echoing it would put every node's drop back on the wire.
        this.clients.event.on(
            'outer.pubsub.metering.subscription-changed',
            (_key, data) => {
                if (!data?.userUuid) return;
                this.#dropCachedSubscription(data.userUuid);
                // The allowance is half of what "has budget left" is computed
                // from, so a plan change invalidates that answer too.
                this.#dropCachedCredits(data.userUuid);
            },
        );

        this.clients.event.on(
            'outer.pubsub.metering.credits-changed',
            (_key, data) => {
                if (data?.userUuid) this.#dropCachedCredits(data.userUuid);
            },
        );

        this.rateCheckTimer = setInterval(
            () => {
                this.checkRateOfChange().catch((e) => {
                    console.error('[metering] rate-of-change check failed', e);
                });
            },
            1000 * 60 * 25,
        );
        this.rateCheckTimer.unref?.();

        const flushInterval =
            this.config.meteringUsageBufferFlushMs &&
            this.config.meteringUsageBufferFlushMs > 0
                ? this.config.meteringUsageBufferFlushMs
                : MeteringService.USAGE_BUFFER_FLUSH_MS;
        this.usageBufferTimer = setInterval(() => {
            this.flushBufferedUsages().catch((e) => {
                console.error('[metering] usage buffer flush failed', e);
            });
        }, flushInterval);
        this.usageBufferTimer.unref?.();
    }

    /**
     * Drain the buffer while the layers it writes through are still up.
     *
     * This is the hook that has to do the work, not `onServerShutdown`: both
     * run clients first, then stores, then services, so by the time a service's
     * shutdown hook is reached the Redis cluster is closed, the metering buffer
     * store has drained and stopped, and the database pool a subscription
     * lookup needs is gone — a flush there resolves the buckets against layers
     * that have already said goodbye and drops them.
     */
    override async onServerPrepareShutdown(): Promise<void> {
        // The timer is deliberately left running: connections are still open at
        // this point, so usage keeps arriving, and the ordinary cycle is the
        // only thing that can still write it through a live stack.
        await this.#drainUsageBuffer();
    }

    override async onServerShutdown(): Promise<void> {
        if (this.rateCheckTimer) {
            clearInterval(this.rateCheckTimer);
            this.rateCheckTimer = null;
        }
        if (this.usageBufferTimer) {
            clearInterval(this.usageBufferTimer);
            this.usageBufferTimer = null;
        }

        // Whatever landed after the drain above — the responses that were still
        // in flight when the listener was severed. Worth attempting because the
        // buffer store falls back to writing straight through when its own
        // buffer is gone, and worth nothing if that fails too.
        await this.#drainUsageBuffer();
    }

    /**
     * Write everything buffered, and everything that arrives while that is
     * happening. Looped because a cycle already in flight took its buckets
     * before the ones added since, and joining it says nothing about those.
     */
    async #drainUsageBuffer(): Promise<void> {
        try {
            for (let pass = 0; pass < 3; pass++) {
                await this.flushBufferedUsages();
                if (this.usageBuffer.size === 0) break;
            }
        } catch (e) {
            console.warn('[metering] usage buffer shutdown flush failed', e);
        }
    }

    /**
     * Egress is priced here because it is metered for every host, not per
     * feature.
     */
    getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(EGRESS_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: 'byte',
                source: 'service:metering',
            }),
        );
    }

    // -- Extension hooks ----------------------------------------------

    /** Register a policy that should be available to actors. */
    registerPolicy(policy: SubscriptionPolicy): void {
        this.extraPolicies.push(policy);
    }

    /**
     * The registered policy for a subscription id, extension-registered
     * policies first (they shadow the built-ins, matching how
     * `#resolveActorSubscription` searches). Lets pricing surfaces derive
     * display figures from the same allowance metering actually enforces.
     */
    getRegisteredPolicy(id: string): SubscriptionPolicy | undefined {
        return [...this.extraPolicies, ...SUB_POLICIES].find(
            (p) => p.id === id,
        );
    }

    /**
     * Register a resolver that maps an actor to a subscription id. The first
     * resolver that returns a non-empty id wins; later resolvers are skipped.
     */
    registerSubscriptionResolver(fn: SubscriptionResolver): void {
        this.subscriptionResolvers.push(fn);
    }

    /**
     * Register a resolver that maps an actor to a _default_ subscription id,
     * used when no explicit subscription is set. First non-empty wins.
     */
    registerDefaultSubscriptionResolver(fn: SubscriptionResolver): void {
        this.defaultSubscriptionResolvers.push(fn);
    }

    // -- Public API: increment usage ----------------------------------

    utilRecordUsageObject<T extends Record<string, number>>(
        trackedUsageObject: T,
        actor: Actor,
        modelPrefix: string,
        costsOverrides?: Partial<Record<keyof T, number>>,
    ) {
        return this.batchIncrementUsages(
            actor,
            Object.entries(trackedUsageObject).map(([usageKind, amount]) => {
                const hasOverride =
                    !!costsOverrides &&
                    Number.isFinite(costsOverrides[usageKind]);
                return {
                    usageType: `${modelPrefix}:${usageKind}`,
                    usageAmount: amount,
                    costOverride: hasOverride
                        ? costsOverrides![usageKind as keyof T]
                        : undefined,
                };
            }),
        );
    }

    async incrementUsage(
        actor: Actor,
        usageType: string,
        usageAmount: number,
        costOverride?: number,
    ): Promise<UsageByType> {
        usageAmount = usageAmount < 0 ? 1 : usageAmount;

        const costOverrideRaw = costOverride;
        costOverride = !Number.isFinite(costOverride)
            ? undefined
            : (costOverride as number) < 0
              ? 1
              : costOverride;

        if (costOverrideRaw && costOverrideRaw < 0) {
            this.clients.alarm.create(
                `metering unexpected negative cost access to: ${usageType}`,
                `negative cost abuse vector! (${actorLabel(actor)})`,
                {
                    userId: actor.user?.uuid,
                    username: actor.user?.username,
                    email: actor.user?.email,
                    appId: actor.app?.uid,
                    usageType,
                    usageAmount,
                    costOverride,
                },
                'info',
            );
        }

        try {
            if (!usageAmount || !usageType || !actor)
                return { total: 0 } as UsageByType;
            if (isSystemActor(actor)) return { total: 0 } as UsageByType;

            const currentMonth = this.monthYearString();

            const totalCost = costOverride ?? 0;

            const escapedUsageType = String(usageType).replace(
                /\./g,
                PERIOD_ESCAPE,
            );
            const appId = actor.app?.uid || GLOBAL_APP_KEY;
            const userId = actor.user.uuid!;
            const pathAndAmountMap = {
                total: totalCost,
                [`${escapedUsageType}.units`]: usageAmount,
                [`${escapedUsageType}.cost`]: totalCost,
                [`${escapedUsageType}.count`]: 1,
            };

            const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
            const actorUsagesPromise = this.stores.meteringBuffer.incr({
                key: actorUsageKey,
                pathAndAmountMap,
            });

            // Aux writes — fire and forget
            this.handleAuxPromise(
                `puterConsumption ${userId}/${appId}`,
                this.stores.meteringBuffer.incrAux({
                    key: this.globalUsageKey(userId, appId, currentMonth),
                    pathAndAmountMap,
                }),
            );

            this.handleAuxPromise(
                `actorAppUsage ${userId}/${appId}`,
                this.stores.meteringBuffer.incrAux({
                    key: `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`,
                    pathAndAmountMap,
                }),
            );

            if (appId !== GLOBAL_APP_KEY) {
                this.handleAuxPromise(
                    `appUsage ${appId}/${userId}`,
                    this.stores.meteringBuffer.incrAux({
                        key: this.appUsageKey(appId, userId, currentMonth),
                        pathAndAmountMap,
                    }),
                );
            }

            this.handleAuxPromise(
                `actorAppTotals ${userId}`,
                this.stores.meteringBuffer.incrAux({
                    key: `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalCost,
                        [`${appId}.count`]: 1,
                    },
                }),
            );

            const [usageResult, actorSubscription, actorAddons] =
                await Promise.all([
                    actorUsagesPromise,
                    this.getActorSubscription(actor),
                    this.getActorAddons(actor),
                ]);

            const actorUsages = await this.exactUsageNearAllowance(
                actorUsageKey,
                usageResult,
                actorSubscription.monthUsageAllowance,
            );

            const settledAllowanceUsed = await this.settleIncrementCharges(
                userId,
                actorUsageKey,
                actorUsages,
                actorSubscription.monthUsageAllowance,
                actorAddons,
                totalCost,
            );

            this.maybeAlertOveruse({
                actor,
                userId,
                actorUsages,
                actorSubscription,
                actorAddons,
                incrementCost: totalCost,
                usageType,
                usageAmount,
                costOverride,
            });

            this.rememberRemainingCredits(
                userId,
                settledAllowanceUsed,
                actorSubscription.monthUsageAllowance,
                actorAddons,
            );

            return (
                (await this.applyMonthlyCharges(
                    actor,
                    currentMonth,
                    actorUsages,
                )) ?? actorUsages
            );
        } catch (e) {
            console.error('[metering] incrementUsage failed', {
                actor,
                usageType,
                usageAmount,
                error: e,
            });
            this.clients.alarm.create(
                `metering service error for user: ${actorLabel(actor)} app: ${actor.app?.uid}`,
                (e as Error).message,
                {
                    userId: actor.user?.uuid,
                    username: actor.user?.username,
                    email: actor.user?.email,
                    appId: actor.app?.uid,
                    error: e as Error,
                    usageType,
                    usageAmount,
                    costOverride,
                },
                'info',
            );
            return { total: 0 } as UsageByType;
        }
    }

    async batchIncrementUsages(
        actor: Actor,
        usages: UsageInput[],
    ): Promise<UsageByType> {
        try {
            if (!usages || usages.length === 0 || !actor)
                return { total: 0 } as UsageByType;
            if (isSystemActor(actor)) return { total: 0 } as UsageByType;

            const currentMonth = this.monthYearString();
            const aggregated: Record<string, number> = {};
            let totalBatchCost = 0;

            for (const {
                usageType,
                usageAmount: usageAmountRaw,
                costOverride: costOverrideRaw,
            } of usages) {
                const usageAmount =
                    !Number.isFinite(usageAmountRaw) || usageAmountRaw < 0
                        ? 1
                        : usageAmountRaw;
                const costOverride = !Number.isFinite(costOverrideRaw)
                    ? undefined
                    : (costOverrideRaw as number) < 0
                      ? 1
                      : costOverrideRaw;

                if (!usageAmount || !usageType) continue;

                if (costOverrideRaw && costOverrideRaw < 0) {
                    this.clients.alarm.create(
                        `metering unexpected negative cost access to: ${usageType}`,
                        `negative cost abuse vector! (${actorLabel(actor)})`,
                        {
                            userId: actor.user?.uuid,
                            username: actor.user?.username,
                            email: actor.user?.email,
                            appId: actor.app?.uid,
                            usageType,
                            usageAmount,
                            costOverride,
                            costOverrideRaw,
                        },
                        'info',
                    );
                }

                const totalCost = costOverride ?? 0;
                totalBatchCost += totalCost;

                const escaped = String(usageType).replace(/\./g, PERIOD_ESCAPE);
                aggregated['total'] = (aggregated['total'] || 0) + totalCost;
                aggregated[`${escaped}.units`] =
                    (aggregated[`${escaped}.units`] || 0) + usageAmount;
                aggregated[`${escaped}.cost`] =
                    (aggregated[`${escaped}.cost`] || 0) + totalCost;
                aggregated[`${escaped}.count`] =
                    (aggregated[`${escaped}.count`] || 0) + 1;
            }

            // Every usage entry may be skipped (zero amount or missing type);
            // an empty map would build an invalid `SET ` update expression.
            if (Object.keys(aggregated).length === 0)
                return { total: 0 } as UsageByType;

            const appId = actor.app?.uid || GLOBAL_APP_KEY;
            const userId = actor.user.uuid!;

            const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
            const actorUsagesPromise = this.stores.meteringBuffer.incr({
                key: actorUsageKey,
                pathAndAmountMap: aggregated,
            });

            this.handleAuxPromise(
                `puterConsumption ${userId}/${appId}`,
                this.stores.meteringBuffer.incrAux({
                    key: this.globalUsageKey(userId, appId, currentMonth),
                    pathAndAmountMap: aggregated,
                }),
            );
            this.handleAuxPromise(
                `actorAppUsage ${userId}/${appId}`,
                this.stores.meteringBuffer.incrAux({
                    key: `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`,
                    pathAndAmountMap: aggregated,
                }),
            );
            // Only for usage an app actually incurred. The sentinel stands for
            // "no app", so writing it here would spread one record per shard
            // across an aggregate that exists for app developers to read —
            // paid for on every increment that has no app behind it, which is
            // most of them. `incrementUsage` has always skipped it.
            if (appId !== GLOBAL_APP_KEY) {
                this.handleAuxPromise(
                    `appUsage ${appId}/${userId}`,
                    this.stores.meteringBuffer.incrAux({
                        key: this.appUsageKey(appId, userId, currentMonth),
                        pathAndAmountMap: aggregated,
                    }),
                );
            }
            this.handleAuxPromise(
                `actorAppTotals ${userId}`,
                this.stores.meteringBuffer.incrAux({
                    key: `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalBatchCost,
                        [`${appId}.count`]: usages.length,
                    },
                }),
            );

            const [usageResult, actorSubscription, actorAddons] =
                await Promise.all([
                    actorUsagesPromise,
                    this.getActorSubscription(actor),
                    this.getActorAddons(actor),
                ]);

            const actorUsages = await this.exactUsageNearAllowance(
                actorUsageKey,
                usageResult,
                actorSubscription.monthUsageAllowance,
            );

            const settledAllowanceUsed = await this.settleIncrementCharges(
                userId,
                actorUsageKey,
                actorUsages,
                actorSubscription.monthUsageAllowance,
                actorAddons,
                totalBatchCost,
            );

            this.maybeAlertOveruse({
                actor,
                userId,
                actorUsages,
                actorSubscription,
                actorAddons,
                incrementCost: totalBatchCost,
                batchUsages: usages,
            });

            this.rememberRemainingCredits(
                userId,
                settledAllowanceUsed,
                actorSubscription.monthUsageAllowance,
                actorAddons,
            );

            return (
                (await this.applyMonthlyCharges(
                    actor,
                    currentMonth,
                    actorUsages,
                )) ?? actorUsages
            );
        } catch (e) {
            console.error('[metering] batchIncrementUsages failed', {
                actor,
                usages,
                error: e,
            });
            this.clients.alarm.create(
                `metering service error for user: ${actorLabel(actor)} app: ${actor.app?.uid}`,
                (e as Error).message,
                {
                    userId: actor.user?.uuid,
                    username: actor.user?.username,
                    email: actor.user?.email,
                    appId: actor.app?.uid,
                    error: e as Error,
                    actor,
                    batchUsages: usages,
                },
                'info',
            );
            return { total: 0 } as UsageByType;
        }
    }

    /**
     * Record usage that nothing is about to decide on, to be written with the
     * same actor's other usage a few seconds later.
     *
     * For usage that arrives per HTTP request — response bytes, object-store
     * requests — this is the increment to reach for: each one costs a fraction
     * of a microcent, and collapsing a busy actor's requests into one write is
     * the difference between metering paying for itself and costing more than
     * it records. Returns nothing, because the running total it would return is
     * one this call has not applied yet; use `batchIncrementUsages` where the
     * answer gates what happens next.
     *
     * Per-type `count` therefore counts flushes rather than requests. Units and
     * cost are exact.
     */
    bufferIncrementUsages(actor: Actor, usages: UsageInput[]): void {
        if (!usages?.length || !actor?.user?.uuid) return;
        if (isSystemActor(actor)) return;

        const key = `${actor.user.uuid}:${actor.app?.uid ?? GLOBAL_APP_KEY}`;
        let bucket = this.usageBuffer.get(key);
        if (!bucket) {
            bucket = { actor, amounts: new Map() };
            this.usageBuffer.set(key, bucket);
        }

        for (const { usageType, usageAmount, costOverride } of usages) {
            if (!usageType) continue;
            if (!Number.isFinite(usageAmount) || usageAmount <= 0) continue;
            const cost =
                Number.isFinite(costOverride) && (costOverride as number) > 0
                    ? (costOverride as number)
                    : 0;

            const amount = bucket.amounts.get(usageType) ?? {
                units: 0,
                cost: 0,
            };
            amount.units += usageAmount;
            amount.cost += cost;
            bucket.amounts.set(usageType, amount);
        }

        if (this.usageBuffer.size >= MeteringService.USAGE_BUFFER_LIMIT) {
            this.flushBufferedUsages().catch((e) => {
                console.error('[metering] usage buffer flush failed', e);
            });
        }
    }

    /**
     * Write everything buffered so far. Buckets are taken before the first
     * await so usage recorded while this runs lands in the next cycle instead
     * of being written twice.
     *
     * Paced rather than fired at once: a cycle can hold a bucket for every
     * actor active in the window, and each one is several counter writes and a
     * read. Releasing all of them into the same tick is how a flush turns into
     * a latency spike for everything else sharing those connections.
     *
     * A cycle already running is joined rather than doubled — a flush slower
     * than the interval would otherwise have every subsequent tick pile another
     * fan-out on top of it.
     */
    flushBufferedUsages(): Promise<void> {
        if (this.usageFlushInFlight) return this.usageFlushInFlight;
        if (this.usageBuffer.size === 0) return Promise.resolve();

        const buckets = [...this.usageBuffer.values()];
        this.usageBuffer.clear();

        this.usageFlushInFlight = runWithConcurrencyLimitSettled(
            buckets,
            MeteringService.USAGE_FLUSH_CONCURRENCY,
            ({ actor, amounts }) =>
                this.batchIncrementUsages(
                    actor,
                    [...amounts].map(([usageType, { units, cost }]) => ({
                        usageType,
                        usageAmount: units,
                        costOverride: cost,
                    })),
                ),
        )
            .then((): void => undefined)
            .finally(() => {
                this.usageFlushInFlight = null;
            });

        return this.usageFlushInFlight;
    }

    // -- Public API: read usage ---------------------------------------

    async getActorCurrentMonthUsageDetails(actor: Actor): Promise<{
        usage: UsageByType;
        appTotals: Record<string, AppTotals>;
    }> {
        if (!actor.user?.uuid)
            throw new HttpError(
                403,
                'Actor must be a user to get usage details',
                {
                    legacyCode: 'forbidden',
                },
            );

        const currentMonth = this.monthYearString();
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.user.uuid}:${currentMonth}`,
            `${METRICS_PREFIX}:actor:${actor.user.uuid}:apps:${currentMonth}`,
        ];

        const { res } = await this.stores.meteringBuffer.get({ key: keys });
        const [usage, appTotals] = (res ?? []) as [
            UsageByType | null,
            Record<string, AppTotals> | null,
        ];

        // Reading the month is one of the two things that settles its
        // recurring charges. The per-app breakdown is written by the same
        // increment but read above it, so it picks them up a read later than
        // the total does.
        const charged = await this.applyMonthlyCharges(
            actor,
            currentMonth,
            usage,
        );
        const resolvedUsage = charged ?? usage ?? ({ total: 0 } as UsageByType);

        const appId = actor.app?.uid;
        if (appTotals && appId) {
            const filtered: Record<string, AppTotals> = {};
            const others: AppTotals = {} as AppTotals;
            Object.entries(appTotals).forEach(([appKey, appUsage]) => {
                if (appKey === appId) {
                    filtered[appKey] = appUsage;
                } else {
                    Object.entries(appUsage).forEach(([usageKind, amount]) => {
                        const key = usageKind as keyof AppTotals;
                        if (!others[key]) others[key] = 0;
                        others[key] += amount;
                    });
                }
            });
            if (others) filtered['others'] = others;
            return { usage: resolvedUsage, appTotals: filtered };
        }

        return { usage: resolvedUsage, appTotals: appTotals || {} };
    }

    async setActorCurrentMonthUsageTotal(
        actor: Actor,
        totalCost: number,
    ): Promise<UsageByType> {
        if (!actor.user?.uuid)
            throw new HttpError(
                403,
                'Actor must be a user to set usage details',
                {
                    legacyCode: 'forbidden',
                },
            );
        if (!Number.isFinite(totalCost) || totalCost < 0) {
            throw new HttpError(
                400,
                'Total cost must be a non-negative number',
                {
                    legacyCode: 'bad_request',
                },
            );
        }

        const normalizedTotal = Math.round(totalCost);
        const currentMonth = this.monthYearString();
        const userId = actor.user.uuid;
        const appId = actor.app?.uid || GLOBAL_APP_KEY;
        const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;

        // Setting an absolute total is only meaningful against an exact
        // starting point, so this one reads through everything pending.
        const { res: current } = await this.stores.meteringBuffer.readExact({
            key: actorUsageKey,
        });
        const currentTotal = (current as UsageByType | null)?.total ?? 0;
        const delta = normalizedTotal - currentTotal;

        // The adjusted total is taken to be allowance-charged in full — the
        // knob's job is "this is what the month has cost the plan", and it
        // doubles as the repair for records whose split predates
        // `allowanceUsed`. Overshoot past the allowance is harmless: readers
        // clamp. The credit pool is deliberately untouched; admin moves it
        // through `updateAddonCredit`.
        const subscription = await this.getActorSubscription(actor);
        const allowanceUsedDelta =
            normalizedTotal -
            MeteringService.allowanceUsedFrom(
                current as UsageByType | null,
                subscription.monthUsageAllowance,
            );

        if (delta === 0 && allowanceUsedDelta === 0) {
            return (current as UsageByType) || ({ total: 0 } as UsageByType);
        }

        const pathAndAmountMap = {
            total: delta,
            'manual_adjustment.cost': delta,
            'manual_adjustment.units': delta,
            'manual_adjustment.count': 1,
        };

        const updated = (
            await this.stores.meteringBuffer.incr({
                key: actorUsageKey,
                // `allowanceUsed` belongs to the actor record alone — the aux
                // aggregates below reuse `pathAndAmountMap` without it.
                pathAndAmountMap: {
                    ...pathAndAmountMap,
                    allowanceUsed: allowanceUsedDelta,
                },
            })
        ).res as unknown as UsageByType;

        // An adjustment moves the month's total in either direction, so what
        // every node believes about this account's budget is now wrong.
        this.invalidateActorCredits(userId);

        this.handleAuxPromise(
            `puterConsumption ${userId}/${appId}`,
            this.stores.meteringBuffer.incrAux({
                key: this.globalUsageKey(userId, appId, currentMonth),
                pathAndAmountMap,
            }),
        );
        this.handleAuxPromise(
            `actorAppUsage ${userId}/${appId}`,
            this.stores.meteringBuffer.incrAux({
                key: `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`,
                pathAndAmountMap,
            }),
        );
        this.handleAuxPromise(
            `actorAppTotals ${userId}`,
            this.stores.meteringBuffer.incrAux({
                key: `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`,
                pathAndAmountMap: {
                    [`${appId}.total`]: delta,
                    [`${appId}.count`]: 1,
                },
            }),
        );

        return updated;
    }

    async getActorCurrentMonthAppUsageDetails(
        actor: Actor,
        appId?: string,
    ): Promise<UsageByType> {
        if (!actor.user?.uuid)
            throw new HttpError(
                403,
                'Actor must be a user to get usage details',
                {
                    legacyCode: 'forbidden',
                },
            );

        const resolvedAppId = appId || actor.app?.uid || GLOBAL_APP_KEY;

        const actorAppId = actor.app?.uid;
        if (
            actorAppId &&
            actorAppId !== resolvedAppId &&
            resolvedAppId !== GLOBAL_APP_KEY
        ) {
            throw new HttpError(
                403,
                'Actor can only get usage details for their own app or global app',
                { legacyCode: 'forbidden' },
            );
        }

        const currentMonth = this.monthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.user.uuid}:app:${resolvedAppId}:${currentMonth}`;
        const { res } = await this.stores.meteringBuffer.get({ key });
        return (res as UsageByType) || ({ total: 0 } as UsageByType);
    }

    /**
     * What an actor can commit to a new operation right now.
     *
     * Their balance less what other operations of theirs already have in flight
     * (see `reserveCredits`) — which is the number a spend decision turns on,
     * and is smaller than the balance whenever the actor has several requests
     * running at once. `getAllowedUsage` is the one to read for reporting a
     * balance; this one is for deciding on a spend.
     */
    async getRemainingUsage(actor: Actor): Promise<number> {
        const [{ remaining }, held] = await Promise.all([
            this.getAllowedUsage(actor),
            this.#outstandingHolds(actor),
        ]);
        return Math.max(0, (remaining || 0) - held);
    }

    /**
     * Commit part of an actor's budget to an operation that is about to run.
     *
     * Usage is recorded when an operation finishes, so between starting and
     * finishing it is invisible to every other request that account makes —
     * they all read the same balance and are each told they can spend the whole
     * of it. What an account can actually overspend by is then bounded by its
     * concurrency limit rather than by its budget, which for an expensive model
     * is several times the allowance.
     *
     * A hold makes the in-flight spend visible for as long as it lasts. Take
     * one for what the operation could cost at worst, before the upstream call;
     * release it once the real usage has been recorded.
     *
     * Never throws, and a hold that couldn't be taken is a no-op handle: not
     * being able to reach the cache is our problem, and turning it into failed
     * requests for everyone spending money is worse than the overshoot it would
     * prevent.
     */
    async reserveCredits(
        actor: Actor,
        amount: number,
        opts: { ttlMs?: number } = {},
    ): Promise<CreditHold> {
        const userId = actor?.user?.uuid;
        if (!userId || isSystemActor(actor) || !(amount > 0)) {
            return NO_CREDIT_HOLD;
        }

        const member = await this.stores.creditHold.take(
            userId,
            amount,
            opts.ttlMs,
        );
        if (!member) return NO_CREDIT_HOLD;

        let released = false;
        return {
            release: async () => {
                if (released) return;
                released = true;
                await this.stores.creditHold.release(userId, member);
            },
            extend: async () => {
                if (released) return;
                await this.stores.creditHold.refresh(
                    userId,
                    member,
                    opts.ttlMs,
                );
            },
        };
    }

    /** Budget this actor has committed to requests that are still running. */
    async #outstandingHolds(actor: Actor): Promise<number> {
        const userId = actor?.user?.uuid;
        if (!userId || isSystemActor(actor)) return 0;
        return this.stores.creditHold.outstanding(userId);
    }

    async getAllowedUsage(actor: Actor): Promise<{
        remaining: number;
        monthUsageAllowance: number;
        addons: UsageAddons;
    }> {
        const [userSubscription, addons, currentMonthUsage] = await Promise.all(
            [
                this.getActorSubscription(actor),
                this.getActorAddons(actor),
                this.getActorCurrentMonthUsageDetails(actor),
            ],
        );

        return {
            remaining: MeteringService.remainingFrom(
                MeteringService.allowanceUsedFrom(
                    currentMonthUsage.usage,
                    userSubscription.monthUsageAllowance,
                ),
                userSubscription.monthUsageAllowance,
                addons,
            ),
            monthUsageAllowance: userSubscription.monthUsageAllowance,
            addons,
        };
    }

    /**
     * How much of this month's spend was charged to the subscription allowance.
     * Records from before `allowanceUsed` was tracked fall back to the
     * pre-split reading — everything counted against the allowance, capped at
     * it — which is also what keeps balances unchanged across the deploy that
     * introduced the field.
     */
    private static allowanceUsedFrom(
        usage: UsageByType | null | undefined,
        monthUsageAllowance: number,
    ): number {
        if (!usage) return 0;
        return (
            usage.allowanceUsed ??
            Math.min(usage.total || 0, Math.max(0, monthUsageAllowance || 0))
        );
    }

    /**
     * What's left of an actor's budget: what remains of the monthly allowance
     * plus what remains of the lifetime credit pool.
     *
     * The pools are independent and each spend lands in exactly one of them
     * (allowance first — see `settleIncrementCharges`), so this is a plain sum.
     * `allowanceUsed` rather than the month total is what the allowance is
     * netted against: the total also contains credit-charged overage, which
     * must not bill the allowance too — visibly so when a plan change raises
     * the allowance mid-month.
     */
    private static remainingFrom(
        allowanceUsed: number,
        monthUsageAllowance: number,
        addons: UsageAddons | null | undefined,
    ): number {
        const remainingAllowance = Math.max(
            0,
            (monthUsageAllowance || 0) - (allowanceUsed || 0),
        );
        const remainingPurchasedCredits = Math.max(
            0,
            (addons?.purchasedCredits || 0) -
                (addons?.consumedPurchaseCredits || 0),
        );
        return remainingAllowance + remainingPurchasedCredits;
    }

    async hasAnyUsage(actor: Actor): Promise<boolean> {
        return (await this.getRemainingUsage(actor)) > 0;
    }

    async hasEnoughCredits(actor: Actor, amount: number): Promise<boolean> {
        return (await this.getRemainingUsage(actor)) >= amount;
    }

    /**
     * Whether the actor has any budget left, answered from a short-lived cache.
     *
     * For gating an operation whose own cost is a rounding error — a file read,
     * a KV call — where what matters is whether the account has anything left
     * at all, not how much. `hasEnoughCredits` is the one to use when the
     * amount matters (an inference call, an email) and is worth two store reads
     * to get right; this one is for surfaces where those reads would cost more
     * than the operation they gate.
     *
     * Never throws: a metering failure resolves to `true`. Not being able to
     * read a balance is our problem, and the alternative is a storage outage
     * that presents as every account being out of credit.
     */
    async hasAnyUsageCached(actor: Actor): Promise<boolean> {
        const uuid = actor?.user?.uuid;
        if (!uuid) return true;

        const now = Date.now();
        const cached = this.creditCache.get(uuid);
        if (cached) {
            if (cached.expiresAt > now) return cached.hasCredits;
            // Stale: answer with what we have and replace it behind the
            // request. Waiting on the refresh would put the store read this
            // cache exists to avoid back on the hot path, once per window per
            // actor, for an answer that is about to be one increment out of
            // date either way.
            void this.#refreshCreditsOnce(actor, uuid);
            return cached.hasCredits;
        }

        await this.#refreshCreditsOnce(actor, uuid);
        return this.creditCache.get(uuid)?.hasCredits ?? true;
    }

    /**
     * `#refreshCredits`, with the one already running for this actor reused
     * instead of started again. Never rejects, so the stale path can drop the
     * promise on the floor.
     */
    #refreshCreditsOnce(actor: Actor, uuid: string): Promise<void> {
        const existing = this.creditRefreshes.get(uuid);
        if (existing) return existing;

        const refresh = this.#refreshCredits(actor).finally(() => {
            this.creditRefreshes.delete(uuid);
        });
        this.creditRefreshes.set(uuid, refresh);
        return refresh;
    }

    /**
     * Drop the cached budget answer for an actor, everywhere. Call after
     * anything that adds to what they may spend — a credit purchase, an admin
     * grant — so it applies now rather than at the end of the cache window.
     */
    invalidateActorCredits(userUuid: string): void {
        this.#dropCachedCredits(userUuid);
        this.clients.event.emit(
            'outer.pubsub.metering.credits-changed',
            { userUuid },
            {},
        );
    }

    /** Local-only drop. The announcement path is `invalidateActorCredits`. */
    #dropCachedCredits(userUuid: string): void {
        this.creditCache.delete(userUuid);
    }

    async #refreshCredits(actor: Actor): Promise<void> {
        const uuid = actor.user?.uuid;
        if (!uuid) return;
        try {
            const subscription = await this.getActorSubscription(actor);
            // A non-positive allowance is how a policy says it isn't metered
            // (the overuse alarm reads it the same way) — no budget to run out
            // of, and no reason to pay for the reads below.
            if (!(subscription.monthUsageAllowance > 0)) {
                this.rememberHasCredits(uuid, true);
                return;
            }
            const [addons, currentMonthUsage] = await Promise.all([
                this.getActorAddons(actor),
                this.getActorCurrentMonthUsageDetails(actor),
            ]);
            this.rememberRemainingCredits(
                uuid,
                MeteringService.allowanceUsedFrom(
                    currentMonthUsage.usage,
                    subscription.monthUsageAllowance,
                ),
                subscription.monthUsageAllowance,
                addons,
            );
        } catch (e) {
            // Leave whatever is cached in place rather than caching a failure;
            // an actor with no entry answers `true` and is tried again next
            // request.
            console.warn(
                `[metering] credit refresh failed for ${uuid}: ${(e as Error).message}`,
            );
        }
    }

    /**
     * Record what an increment already knows about an actor's balance.
     *
     * Every increment reads the month's total and resolves the subscription and
     * addons to price and alarm on the usage, so the answer this cache holds
     * falls out of work that has already happened. That is what keeps the gated
     * surfaces free of reads of their own: an active actor's entry is refreshed
     * by their own usage settling, and the cache window only has to cover an
     * actor who has gone quiet.
     */
    private rememberRemainingCredits(
        userId: string,
        allowanceUsed: number,
        monthUsageAllowance: number,
        addons: UsageAddons | null | undefined,
    ): void {
        if (!(monthUsageAllowance > 0)) {
            this.rememberHasCredits(userId, true);
            return;
        }
        this.rememberHasCredits(
            userId,
            MeteringService.remainingFrom(
                allowanceUsed,
                monthUsageAllowance,
                addons,
            ) > 0,
        );
    }

    private rememberHasCredits(userId: string, hasCredits: boolean): void {
        const existing = this.creditCache.get(userId);
        if (existing) {
            existing.hasCredits = hasCredits;
            existing.expiresAt = Date.now() + MeteringService.CREDIT_CACHE_MS;
            return;
        }
        // Map preserves insertion order; FIFO-evict so a flood of one-shot
        // actors can't grow this without bound.
        if (this.creditCache.size >= MeteringService.CREDIT_CACHE_LIMIT) {
            const oldest = this.creditCache.keys().next().value;
            if (oldest !== undefined) this.creditCache.delete(oldest);
        }
        this.creditCache.set(userId, {
            hasCredits,
            expiresAt: Date.now() + MeteringService.CREDIT_CACHE_MS,
        });
    }

    /**
     * Drop the cached subscription for an actor. Call after anything that
     * changes which policy they resolve to (a purchase landing, a cancellation,
     * an admin edit) so the new plan applies immediately rather than at the end
     * of the cache window.
     *
     * Announced as well as applied. Only one node handles the write that
     * changed the plan, but every node has its own cache, so dropping locally
     * fixes the tier for one node and leaves the rest serving the old one until
     * their entries expire. The event goes out on the `outer.pubsub.*` channel,
     * which reaches sibling nodes and peer clusters alike — a user who upgrades
     * shouldn't get their old limits back by being routed elsewhere.
     */
    invalidateActorSubscription(userUuid: string): void {
        this.#dropCachedSubscription(userUuid);
        this.clients.event.emit(
            'outer.pubsub.metering.subscription-changed',
            { userUuid },
            {},
        );
    }

    /** Local-only drop. The announcement path is `invalidateActorSubscription`. */
    #dropCachedSubscription(userUuid: string): void {
        this.subscriptionCache.delete(userUuid);
    }

    async getActorSubscription(actor: Actor): Promise<SubscriptionPolicy> {
        if (!actor.user?.uuid)
            throw new HttpError(403, 'Actor must be a user to get policy', {
                legacyCode: 'forbidden',
            });

        const uuid = actor.user.uuid;
        const now = Date.now();
        const cached = this.subscriptionCache.get(uuid);
        if (cached && cached.expiresAt > now) return cached.policy;

        const policy = await this.#resolveActorSubscription(actor);

        // Map preserves insertion order; FIFO-evict so a flood of one-shot
        // actors can't grow this without bound.
        if (
            this.subscriptionCache.size >=
            MeteringService.SUBSCRIPTION_CACHE_LIMIT
        ) {
            const oldest = this.subscriptionCache.keys().next().value;
            if (oldest !== undefined) this.subscriptionCache.delete(oldest);
        }
        this.subscriptionCache.set(uuid, {
            policy,
            expiresAt: now + MeteringService.SUBSCRIPTION_CACHE_MS,
        });
        return policy;
    }

    async #resolveActorSubscription(actor: Actor): Promise<SubscriptionPolicy> {
        const fallbackDefault = this.config.unlimitedMetering
            ? UNLIMITED_SUBSCRIPTION
            : actor.user?.email
              ? DEFAULT_FREE_SUBSCRIPTION
              : DEFAULT_TEMP_SUBSCRIPTION;

        const resolvedDefault =
            (await this.firstResolver(
                this.defaultSubscriptionResolvers,
                actor,
            )) || fallbackDefault;
        const resolvedUser =
            (await this.firstResolver(this.subscriptionResolvers, actor)) ||
            resolvedDefault;

        const availablePolicies: SubscriptionPolicy[] = [
            ...this.extraPolicies,
            ...SUB_POLICIES,
            // The policy, not the id: this list is searched by `id`, so putting
            // the bare string in it resolved nothing and left a deployment that
            // asked for unlimited metering with no policy at all.
            ...(this.config.unlimitedMetering ? [LOCAL_UNLIMITED_USER] : []),
        ] as SubscriptionPolicy[];
        // A resolver can name a policy nobody registered — an extension that
        // failed to load, a plan renamed on one side only. Falling through to
        // the built-in free policy keeps callers holding a real policy: the
        // alternative is `undefined` reaching every reader of `.id` and
        // `.monthUsageAllowance` as a 500 rather than a downgrade.
        const policy =
            availablePolicies.find((p) => p.id === resolvedUser) ??
            availablePolicies.find((p) => p.id === resolvedDefault) ??
            availablePolicies.find((p) => p.id === fallbackDefault);
        if (policy) return policy;
        console.warn(
            `[metering] no registered policy for '${resolvedUser}' or` +
                ` '${resolvedDefault}' — falling back to` +
                ` '${REGISTERED_USER_FREE.id}'`,
        );
        return REGISTERED_USER_FREE as SubscriptionPolicy;
    }

    async getActorAddons(actor: Actor): Promise<UsageAddons> {
        if (!actor.user?.uuid)
            throw new HttpError(
                403,
                'Actor must be a user to get policy addons',
                {
                    legacyCode: 'forbidden',
                },
            );
        const key = `${POLICY_PREFIX}:actor:${actor.user.uuid}:addons`;
        const { res } = await this.stores.kv.get({ key });
        return (res ?? {}) as UsageAddons;
    }

    async getActorAppUsage(actor: Actor, appId: string): Promise<UsageByType> {
        if (!actor.user?.uuid)
            throw new HttpError(403, 'Actor must be a user to get app usage', {
                legacyCode: 'forbidden',
            });
        if (actor.app?.uid && actor.app.uid !== appId) {
            throw new HttpError(
                403,
                'Actor can only get usage for their own app',
                { legacyCode: 'forbidden' },
            );
        }

        const currentMonth = this.monthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.user.uuid}:app:${appId}:${currentMonth}`;
        const { res } = await this.stores.meteringBuffer.get({ key });
        return (res ?? { total: 0 }) as UsageByType;
    }

    async getGlobalUsage(): Promise<UsageByType> {
        const currentMonth = this.monthYearString();
        const keyPrefix = `${METRICS_PREFIX}:puter:`;
        const keys: string[] = [];
        for (
            let shard = 0;
            shard < MeteringService.GLOBAL_SHARD_COUNT;
            shard++
        ) {
            keys.push(`${keyPrefix}${shard}:${currentMonth}`);
        }
        keys.push(`${keyPrefix}${currentMonth}`);

        const { res } = await this.stores.kv.get({ key: keys });
        const usages = (res ?? []) as UsageByType[];
        const aggregated: UsageByType = { total: 0 } as UsageByType;

        usages.filter(Boolean).forEach((entry = {} as UsageByType) => {
            const { total, ...rest } = entry;
            aggregated.total += total || 0;
            Object.entries(rest as Record<string, UsageRecord>).forEach(
                ([usageKind, record]) => {
                    if (!aggregated[usageKind]) {
                        aggregated[usageKind] = {
                            cost: 0,
                            units: 0,
                            count: 0,
                        } as UsageRecord;
                    }
                    const agg = aggregated[usageKind] as UsageRecord;
                    agg.cost += record.cost;
                    agg.count += record.count;
                    agg.units += record.units;
                },
            );
        });

        return aggregated;
    }

    async updateAddonCredit(
        userId: string,
        tokenAmount: number,
    ): Promise<void> {
        if (!userId) throw new Error('User needed to update extra credits');
        await this.stores.kv.incr({
            key: `${POLICY_PREFIX}:actor:${userId}:addons`,
            pathAndAmountMap: { purchasedCredits: tokenAmount },
        });
        // Credit that lands while the account is being turned away has to take
        // effect on the next request, not at the end of the cache window.
        this.invalidateActorCredits(userId);
    }

    // -- Internals ----------------------------------------------------

    private monthYearString(): string {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Randomized shard key to spread writes across the global consumption
     * bucket.
     */
    private globalUsageKey(
        userId: string,
        appId: string,
        currentMonth: string,
    ): string {
        const hash =
            murmurhash.v3(`${userId}:${appId}`) %
            MeteringService.GLOBAL_SHARD_COUNT;
        return `${METRICS_PREFIX}:puter:${hash}:${currentMonth}`;
    }

    private appUsageKey(
        appId: string,
        userId: string,
        currentMonth: string,
    ): string {
        const hash =
            murmurhash.v3(`${appId}${userId}`) %
            MeteringService.APP_SHARD_COUNT;
        return `${METRICS_PREFIX}:app:${appId}:${hash}:${currentMonth}`;
    }

    /**
     * Well under the allowance an approximate running total leads to the same
     * decisions as an exact one, so it isn't worth paying for precision. Close
     * to the limit it is — that's where the decisions below actually turn on
     * the number.
     */
    private async exactUsageNearAllowance(
        key: string,
        usage: { res: unknown; exact: boolean },
        monthUsageAllowance: number,
    ): Promise<UsageByType> {
        const approximate = usage.res as UsageByType;
        if (usage.exact || !(monthUsageAllowance > 0)) return approximate;
        if (
            (approximate.total || 0) <
            monthUsageAllowance * MeteringService.PRECISION_THRESHOLD
        )
            return approximate;

        const { res } = await this.stores.meteringBuffer.readExact({ key });
        return (res as UsageByType) ?? approximate;
    }

    private handleAuxPromise(label: string, promise: Promise<unknown>): void {
        promise.catch((e: Error) => {
            console.warn(
                `[metering] aux write failed (${label}): ${e.message}`,
            );
        });
    }

    private async firstResolver(
        resolvers: SubscriptionResolver[],
        actor: Actor,
    ): Promise<string | null> {
        for (const resolver of resolvers) {
            try {
                const result = await resolver(actor);
                if (result) return result;
            } catch (e) {
                console.warn('[metering] subscription resolver failed', e);
            }
        }
        return null;
    }

    // -- Internals: monthly charges -----------------------------------

    /**
     * Charges that recur monthly are applied the first time an actor touches
     * the month rather than swept for on a schedule: an actor who never comes
     * back is never looked at, and the work lands on the one request that was
     * already reading or writing that month's record anyway.
     *
     * `usage` is the record the caller has in hand. Once it carries the claim
     * this costs nothing at all, which is the case for every request but the
     * first. Returns the usage including the charges when this call is the one
     * that applied them, and null otherwise — including on failure, since a
     * charge that couldn't be applied shouldn't take the request down with it.
     */
    private async applyMonthlyCharges(
        actor: Actor,
        currentMonth: string,
        usage: UsageByType | null,
    ): Promise<UsageByType | null> {
        const userId = actor?.user?.uuid;
        if (!userId || isSystemActor(actor)) return null;
        if (!this.clients.event.hasListeners('metering.monthly.charges'))
            return null;

        // Scoped to the month as well as the actor: a claim in flight across
        // midnight says nothing about the month that just started.
        const claimId = `${userId}:${currentMonth}`;
        // Checked before anything that can be forgotten, and answered with
        // null rather than the running claim — a caller that awaited it could
        // be the claim itself, one frame down.
        if (this.claimsInFlight.has(claimId)) return null;

        if (usage?.[MONTHLY_CHARGE_CLAIM]) {
            this.rememberSettled(claimId, currentMonth);
            return null;
        }
        if (this.isSettled(claimId, currentMonth)) return null;

        // Nothing awaits between the check and the add, so two callers can't
        // both get past it.
        this.claimsInFlight.add(claimId);
        try {
            return await this.claimAndCharge(actor, userId, currentMonth);
        } finally {
            this.claimsInFlight.delete(claimId);
        }
    }

    /**
     * Take the month's claim, and if it was ours, ask what the user owes and
     * record it.
     *
     * The claim goes straight to the KV store rather than through the metering
     * buffer: the buffer answers from this deployment's own view, and the point
     * of this counter is to be the one value every deployment agrees on.
     * Exactly one caller anywhere sees it come back as 1.
     */
    private async claimAndCharge(
        actor: Actor,
        userId: string,
        currentMonth: string,
    ): Promise<UsageByType | null> {
        let claim: number;
        try {
            const { res } = await this.stores.kv.incr({
                key: `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`,
                pathAndAmountMap: { [MONTHLY_CHARGE_CLAIM]: 1 },
            });
            claim = Number(
                (res as Record<string, unknown>)?.[MONTHLY_CHARGE_CLAIM] ?? 0,
            );
        } catch (e) {
            // Unclaimed, so the next request retries. Charging late beats
            // charging never, and beats failing the request outright.
            console.warn(
                `[metering] monthly charge claim failed for ${userId}: ${(e as Error).message}`,
            );
            return null;
        }

        this.rememberSettled(`${userId}:${currentMonth}`, currentMonth);
        // Every attempt bumps the counter, so exactly one caller anywhere ever
        // reads 1 back. Everyone else lost the race and must not charge.
        if (claim !== 1) return null;

        // The account owes this, not whichever app happened to make the first
        // call of the month. Dropping the app bills it to the user's own
        // bucket instead of landing it in that app's usage — which its
        // developer reads — and hands listeners a subject they can price
        // against what the user owns.
        const userActor: Actor = { user: actor.user };

        const charges: UsageInput[] = [];
        await this.clients.event.emitAndWait(
            'metering.monthly.charges',
            { actor: userActor, month: currentMonth, charges },
            {},
        );

        const valid = charges.filter(
            (charge) =>
                charge?.usageType && Number.isFinite(charge.usageAmount),
        );
        if (valid.length === 0) return null;
        // One call, so every charge is folded into a single amount map and
        // settles as one write however many listeners contributed.
        return this.batchIncrementUsages(userActor, valid);
    }

    private rememberSettled(claimId: string, month: string): void {
        if (this.settledMonth !== month) {
            this.settledMonth = month;
            this.settledActors.clear();
        }
        if (
            this.settledActors.size >= MeteringService.MONTHLY_CHARGE_MEMO_LIMIT
        ) {
            this.settledActors.clear();
        }
        this.settledActors.add(claimId);
    }

    private isSettled(claimId: string, month: string): boolean {
        return this.settledMonth === month && this.settledActors.has(claimId);
    }

    /**
     * Split a settled increment between the two budget pools, allowance first:
     * whatever fits under the monthly allowance bumps the month record's
     * `allowanceUsed`, and only the part that doesn't fit draws down the
     * lifetime credit pool. Each spend lands in exactly one pool, which is what
     * lets `remainingFrom` sum them independently.
     *
     * A month record without `allowanceUsed` predates the split; its first
     * settled increment folds the fallback baseline into the write, so the
     * record answers directly from then on and no balance moves on the deploy
     * that introduced the field.
     *
     * Returns the month's allowance-charged spend as of after this settle —
     * `usageRecord` itself predates the write, so callers deciding on the
     * balance must use this rather than re-read the record they hold.
     */
    private async settleIncrementCharges(
        userId: string,
        actorUsageKey: string,
        usageRecord: UsageByType,
        monthUsageAllowance: number,
        addons: UsageAddons,
        incrementCost: number,
    ): Promise<number> {
        if (incrementCost <= 0) {
            return MeteringService.allowanceUsedFrom(
                usageRecord,
                monthUsageAllowance,
            );
        }

        const totalBefore = Math.max(
            0,
            (usageRecord.total || 0) - incrementCost,
        );
        // Same fallback as `allowanceUsedFrom`, measured before this
        // increment's own cost.
        const usedBefore =
            usageRecord.allowanceUsed ??
            Math.min(totalBefore, Math.max(0, monthUsageAllowance || 0));
        const baseline =
            usageRecord.allowanceUsed === undefined ? usedBefore : 0;

        const headroom = Math.max(0, monthUsageAllowance - usedBefore);
        const allowanceCharge = Math.min(incrementCost, headroom);
        const overage = incrementCost - allowanceCharge;

        const writes: Promise<unknown>[] = [];
        if (baseline + allowanceCharge > 0) {
            writes.push(
                this.stores.meteringBuffer.incr({
                    key: actorUsageKey,
                    pathAndAmountMap: {
                        allowanceUsed: baseline + allowanceCharge,
                    },
                }),
            );
        }

        const remainingCredits =
            (addons.purchasedCredits || 0) -
            (addons.consumedPurchaseCredits || 0);
        if (overage > 0 && remainingCredits > 0) {
            writes.push(
                this.stores.kv.incr({
                    key: `${POLICY_PREFIX}:actor:${userId}:addons`,
                    pathAndAmountMap: {
                        consumedPurchaseCredits: Math.min(
                            overage,
                            remainingCredits,
                        ),
                    },
                }),
            );
        }
        await Promise.all(writes);
        return usedBefore + allowanceCharge;
    }

    private maybeAlertOveruse(ctx: {
        actor: Actor;
        userId: string;
        actorUsages: UsageByType;
        actorSubscription: SubscriptionPolicy;
        actorAddons: UsageAddons;
        incrementCost: number;
        usageType?: string;
        usageAmount?: number;
        costOverride?: number;
        batchUsages?: UsageInput[];
    }): void {
        const {
            actor,
            userId,
            actorUsages,
            actorSubscription,
            actorAddons,
            incrementCost,
        } = ctx;

        const allowance = actorSubscription.monthUsageAllowance;
        // No metered allowance to exceed (e.g. unlimited policies) — nothing to flag.
        if (!(allowance > 0)) return;

        // Purchased credit extends the budget: the actor is only genuinely
        // "over" once they've burned through the monthly allowance AND every
        // purchased credit. Measure usage net of the purchased credit so the
        // allowance multiples below are counted from the point that whole budget
        // is exhausted rather than from zero — otherwise a user actively
        // spending down a large credit balance trips the alarm on every
        // allowance-sized expense the moment the credit runs dry. (Purchased
        // credit is a lifetime balance, so in the month it finally runs out this
        // also grants a small grace window before paging.)
        const purchasedCredits = actorAddons.purchasedCredits || 0;
        const consumedPurchaseCredits =
            actorAddons.consumedPurchaseCredits || 0;
        const netUsage = actorUsages.total - purchasedCredits;
        const previousNetUsage = netUsage - incrementCost;

        const currentMultiple = Math.floor(netUsage / allowance);
        const previousMultiple = Math.floor(previousNetUsage / allowance);

        // Only alarm if the actor was ALREADY past their full budget (allowance
        // + purchased credit) before this expense arrived. A single large
        // request that jumps past the limit in one shot (net usage still under
        // the allowance beforehand) is legitimate and shouldn't page.
        const wasAlreadyOverLimit = previousNetUsage >= allowance;
        // And only when this expense crosses into a new whole multiple of the
        // allowance beyond that budget. Being already over means the previous
        // multiple was at least 1, so the first multiple that fires is 2x — i.e.
        // usage has reached (purchased credit + 2 x the monthly allowance).
        const crossedMultiple = previousMultiple < currentMultiple;

        if (!(wasAlreadyOverLimit && crossedMultiple)) return;

        this.clients.alarm.create(
            `metering usage exceeded by user: ${actorLabel(actor)}`,
            `${actorLabel(actor)} (${userId}) has exceeded their usage allowance significantly`,
            {
                userId: actor.user?.uuid,
                username: actor.user?.username,
                email: actor.user?.email,
                appId: actor.app?.uid,
                usageType: ctx.usageType,
                usageAmount: ctx.usageAmount,
                costOverride: ctx.costOverride,
                batchUsages: ctx.batchUsages,
                totalUsage: actorUsages.total,
                monthUsageAllowance: actorSubscription.monthUsageAllowance,
                purchasedCredits,
                consumedPurchaseCredits,
            },
            // One account outspending its allowance is a thing to look at, not
            // an incident — a record in the alerts channel is enough.
            'info',
        );
    }

    private async checkRateOfChange(): Promise<void> {
        const now = Date.now();
        const lastChangeKey = `${METRICS_PREFIX}:lastGlobalUsageCheck`;
        const { res: lastChangeRaw } = await this.stores.kv.get({
            key: lastChangeKey,
        });
        const lastChange = lastChangeRaw as {
            total: number;
            timestamp: number;
        } | null;

        if (lastChange && now - lastChange.timestamp <= 14 * 60 * 1000) return;

        const globalUsage = await this.getGlobalUsage();
        const currTotal = globalUsage.total;

        const maxPerMinute = this.config.maxGlobalUsagePerMinute;

        if (lastChange && maxPerMinute && maxPerMinute > 0) {
            const timeDelta = now - lastChange.timestamp;
            const usageDelta = currTotal - lastChange.total;
            const usagePerMinute = usageDelta / (timeDelta / 60000);

            if (usagePerMinute > maxPerMinute) {
                this.clients.alarm.create(
                    'metering:excessiveGlobalUsageRate',
                    `Global usage rate is excessive: ${usagePerMinute} micro-cents per minute`,
                    {
                        usagePerMinute,
                        maxAllowedPerMinute: maxPerMinute,
                    },
                    // Fleet-wide spend running away — worth someone's attention
                    // the same day, but it isn't an outage.
                    'warning',
                );
            }
        }

        await this.stores.kv.set({
            key: lastChangeKey,
            value: { total: currTotal, timestamp: now },
        });
    }
}
