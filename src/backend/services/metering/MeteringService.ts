/**
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
    PERIOD_ESCAPE,
    POLICY_PREFIX,
    UNLIMITED_SUBSCRIPTION,
} from './consts';
import type { AppTotals, UsageAddons, UsageByType, UsageRecord } from './types';
import { toMicroCents } from './utils';

import { SUB_POLICIES } from '../../data/subPolicies/index.js';

// ── Types ────────────────────────────────────────────────────────────

type SubscriptionPolicy = (typeof SUB_POLICIES)[number];

export type SubscriptionResolver = (
    actor: Actor,
) => Promise<string | null | undefined> | string | null | undefined;

interface UsageInput {
    usageType: string;
    usageAmount: number;
    costOverride?: number;
}

// ── MeteringService ──────────────────────────────────────────────────

/**
 * Tracks per-actor and global usage, and exposes subscription/addon lookup.
 * All metering data is persisted under the system namespace via
 * `stores.kv` (SystemKVStore)
 *
 * Callers (typically drivers or controllers) pass the user-scoped actor in; we fan that
 * out into several aggregated KV records.
 */
export class MeteringService extends PuterService {
    static GLOBAL_SHARD_COUNT = 10000;
    static APP_SHARD_COUNT = 10000;
    static MAX_GLOBAL_USAGE_PER_MINUTE = toMicroCents(0.2);

    private rateCheckTimer: ReturnType<typeof setInterval> | null = null;
    private extraPolicies: SubscriptionPolicy[] = [];
    private subscriptionResolvers: SubscriptionResolver[] = [];
    private defaultSubscriptionResolvers: SubscriptionResolver[] = [];

    // ── Lifecycle ────────────────────────────────────────────────────

    override onServerStart(): void {
        this.rateCheckTimer = setInterval(
            () => {
                this.checkRateOfChange().catch((e) => {
                    console.error('[metering] rate-of-change check failed', e);
                });
            },
            1000 * 60 * 25,
        );
        this.rateCheckTimer.unref?.();
    }

    override onServerShutdown(): void {
        if (this.rateCheckTimer) {
            clearInterval(this.rateCheckTimer);
            this.rateCheckTimer = null;
        }
    }

    // ── Extension hooks ──────────────────────────────────────────────

    /** Register a policy that should be available to actors. */
    registerPolicy(policy: SubscriptionPolicy): void {
        this.extraPolicies.push(policy);
    }

    /**
     * Register a resolver that maps an actor to a subscription id. The first
     * resolver that returns a non-empty id wins; later resolvers are skipped.
     */
    registerSubscriptionResolver(fn: SubscriptionResolver): void {
        this.subscriptionResolvers.push(fn);
    }

    /**
     * Register a resolver that maps an actor to a *default* subscription id,
     * used when no explicit subscription is set. First non-empty wins.
     */
    registerDefaultSubscriptionResolver(fn: SubscriptionResolver): void {
        this.defaultSubscriptionResolvers.push(fn);
    }

    // ── Public API: increment usage ──────────────────────────────────

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
                'negative cost abuse vector!',
                {
                    userId: actor.user?.uuid,
                    username: actor.user?.username,
                    email: actor.user?.email,
                    appId: actor.app?.uid,
                    usageType,
                    usageAmount,
                    costOverride,
                },
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
            const userId = actor.user.uuid;
            const pathAndAmountMap = {
                total: totalCost,
                [`${escapedUsageType}.units`]: usageAmount,
                [`${escapedUsageType}.cost`]: totalCost,
                [`${escapedUsageType}.count`]: 1,
            };

            const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
            const actorUsagesPromise = this.stores.kv
                .incr({
                    key: actorUsageKey,
                    pathAndAmountMap,
                })
                .then((r) => r.res as unknown as UsageByType);

            // Aux writes — fire and forget
            this.handleAuxPromise(
                `puterConsumption ${userId}/${appId}`,
                this.stores.kv.incr({
                    key: this.globalUsageKey(userId, appId, currentMonth),
                    pathAndAmountMap,
                }),
            );

            this.handleAuxPromise(
                `actorAppUsage ${userId}/${appId}`,
                this.stores.kv.incr({
                    key: `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`,
                    pathAndAmountMap,
                }),
            );

            if (appId !== GLOBAL_APP_KEY) {
                this.handleAuxPromise(
                    `appUsage ${appId}/${userId}`,
                    this.stores.kv.incr({
                        key: this.appUsageKey(appId, userId, currentMonth),
                        pathAndAmountMap,
                    }),
                );
            }

            this.handleAuxPromise(
                `actorAppTotals ${userId}`,
                this.stores.kv.incr({
                    key: `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalCost,
                        [`${appId}.count`]: 1,
                    },
                }),
            );

            this.handleAuxPromise(
                'lastUpdated',
                this.stores.kv.set({
                    key: `${METRICS_PREFIX}:actor:${userId}:lastUpdated`,
                    value: Date.now(),
                }),
            );

            const [actorUsages, actorSubscription, actorAddons] =
                await Promise.all([
                    actorUsagesPromise,
                    this.getActorSubscription(actor),
                    this.getActorAddons(actor),
                ]);

            await this.maybeConsumeAddonCredits(
                userId,
                actorUsages.total,
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

            return actorUsages;
        } catch (e) {
            console.error('[metering] incrementUsage failed', {
                actor,
                usageType,
                usageAmount,
                error: e,
            });
            this.clients.alarm.create(
                `metering service error for user: ${actor.user?.username} app: ${actor.app?.uid}`,
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
                        'negative cost abuse vector!',
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

            const appId = actor.app?.uid || GLOBAL_APP_KEY;
            const userId = actor.user.uuid;

            const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
            const actorUsagesPromise = this.stores.kv
                .incr({
                    key: actorUsageKey,
                    pathAndAmountMap: aggregated,
                })
                .then((r) => r.res as unknown as UsageByType);

            this.handleAuxPromise(
                `puterConsumption ${userId}/${appId}`,
                this.stores.kv.incr({
                    key: this.globalUsageKey(userId, appId, currentMonth),
                    pathAndAmountMap: aggregated,
                }),
            );
            this.handleAuxPromise(
                `actorAppUsage ${userId}/${appId}`,
                this.stores.kv.incr({
                    key: `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`,
                    pathAndAmountMap: aggregated,
                }),
            );
            this.handleAuxPromise(
                `appUsage ${appId}/${userId}`,
                this.stores.kv.incr({
                    key: this.appUsageKey(appId, userId, currentMonth),
                    pathAndAmountMap: aggregated,
                }),
            );
            this.handleAuxPromise(
                `actorAppTotals ${userId}`,
                this.stores.kv.incr({
                    key: `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalBatchCost,
                        [`${appId}.count`]: usages.length,
                    },
                }),
            );
            this.handleAuxPromise(
                'lastUpdated',
                this.stores.kv.set({
                    key: `${METRICS_PREFIX}:actor:${userId}:lastUpdated`,
                    value: Date.now(),
                }),
            );

            const [actorUsages, actorSubscription, actorAddons] =
                await Promise.all([
                    actorUsagesPromise,
                    this.getActorSubscription(actor),
                    this.getActorAddons(actor),
                ]);

            await this.maybeConsumeAddonCredits(
                userId,
                actorUsages.total,
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

            return actorUsages;
        } catch (e) {
            console.error('[metering] batchIncrementUsages failed', {
                actor,
                usages,
                error: e,
            });
            this.clients.alarm.create(
                `metering service error for user: ${actor.user?.username} app: ${actor.app?.uid}`,
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
            );
            return { total: 0 } as UsageByType;
        }
    }

    // ── Public API: read usage ───────────────────────────────────────

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

        const { res } = await this.stores.kv.get({ key: keys });
        const [usage, appTotals] = (res ?? []) as [
            UsageByType | null,
            Record<string, AppTotals> | null,
        ];

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
            return {
                usage: usage || ({ total: 0 } as UsageByType),
                appTotals: filtered,
            };
        }

        return {
            usage: usage || ({ total: 0 } as UsageByType),
            appTotals: appTotals || {},
        };
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

        const { res: current } = await this.stores.kv.get({
            key: actorUsageKey,
        });
        const currentTotal = (current as UsageByType | null)?.total ?? 0;
        const delta = normalizedTotal - currentTotal;

        if (delta === 0) {
            return (current as UsageByType) || ({ total: 0 } as UsageByType);
        }

        const pathAndAmountMap = {
            total: delta,
            'manual_adjustment.cost': delta,
            'manual_adjustment.units': delta,
            'manual_adjustment.count': 1,
        };

        const updated = (
            await this.stores.kv.incr({ key: actorUsageKey, pathAndAmountMap })
        ).res as unknown as UsageByType;

        this.handleAuxPromise(
            `puterConsumption ${userId}/${appId}`,
            this.stores.kv.incr({
                key: this.globalUsageKey(userId, appId, currentMonth),
                pathAndAmountMap,
            }),
        );
        this.handleAuxPromise(
            `actorAppUsage ${userId}/${appId}`,
            this.stores.kv.incr({
                key: `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`,
                pathAndAmountMap,
            }),
        );
        this.handleAuxPromise(
            `actorAppTotals ${userId}`,
            this.stores.kv.incr({
                key: `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`,
                pathAndAmountMap: {
                    [`${appId}.total`]: delta,
                    [`${appId}.count`]: 1,
                },
            }),
        );
        this.handleAuxPromise(
            'lastUpdated',
            this.stores.kv.set({
                key: `${METRICS_PREFIX}:actor:${userId}:lastUpdated`,
                value: Date.now(),
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
        const { res } = await this.stores.kv.get({ key });
        return (res as UsageByType) || ({ total: 0 } as UsageByType);
    }

    async getRemainingUsage(actor: Actor): Promise<number> {
        const { remaining } = await this.getAllowedUsage(actor);
        return remaining || 0;
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

        const remaining = Math.max(
            0,
            (userSubscription.monthUsageAllowance || 0) +
                (addons?.purchasedCredits || 0) -
                (currentMonthUsage.usage.total || 0) -
                (addons?.consumedPurchaseCredits || 0),
        );

        return {
            remaining,
            monthUsageAllowance: userSubscription.monthUsageAllowance,
            addons,
        };
    }

    async hasAnyUsage(actor: Actor): Promise<boolean> {
        return (await this.getRemainingUsage(actor)) > 0;
    }

    async hasEnoughCredits(actor: Actor, amount: number): Promise<boolean> {
        return (await this.getRemainingUsage(actor)) >= amount;
    }

    async getActorSubscription(actor: Actor): Promise<SubscriptionPolicy> {
        if (!actor.user?.uuid)
            throw new HttpError(403, 'Actor must be a user to get policy', {
                legacyCode: 'forbidden',
            });

        const fallbackDefault = this.config.unlimitedMetering
            ? UNLIMITED_SUBSCRIPTION
            : actor.user.email
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
            ...(this.config.unlimitedMetering ? [UNLIMITED_SUBSCRIPTION] : []),
        ] as SubscriptionPolicy[];
        return (
            availablePolicies.find((p) => p.id === resolvedUser) ??
            availablePolicies.find((p) => p.id === resolvedDefault)!
        );
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
        const { res } = await this.stores.kv.get({ key });
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
    }

    // ── Internals ────────────────────────────────────────────────────

    private monthYearString(): string {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Randomized shard key to spread writes across the global consumption bucket.
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

    private async maybeConsumeAddonCredits(
        userId: string,
        totalUsage: number,
        monthUsageAllowance: number,
        addons: UsageAddons,
        incrementCost: number,
    ): Promise<void> {
        if (totalUsage <= monthUsageAllowance) return;
        if (!addons.purchasedCredits) return;
        if (addons.purchasedCredits <= (addons.consumedPurchaseCredits || 0))
            return;

        const withinBoundsUsage = Math.max(
            0,
            monthUsageAllowance - totalUsage + incrementCost,
        );
        const overageUsage = incrementCost - withinBoundsUsage;
        if (overageUsage <= 0) return;

        const toConsume = Math.min(
            overageUsage,
            addons.purchasedCredits - (addons.consumedPurchaseCredits || 0),
        );
        await this.stores.kv.incr({
            key: `${POLICY_PREFIX}:actor:${userId}:addons`,
            pathAndAmountMap: { consumedPurchaseCredits: toConsume },
        });
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

        const allowedMultiple = Math.floor(
            actorUsages.total / actorSubscription.monthUsageAllowance,
        );
        const previousMultiple = Math.floor(
            (actorUsages.total - incrementCost) /
                actorSubscription.monthUsageAllowance,
        );
        const isOver2x = allowedMultiple >= 2;
        const crossedThreshold = previousMultiple < allowedMultiple;
        const hasNoAddonCredit =
            (actorAddons.purchasedCredits || 0) <=
            (actorAddons.consumedPurchaseCredits || 0);

        if (!(isOver2x && crossedThreshold && hasNoAddonCredit)) return;

        this.clients.alarm.create(
            `metering usage exceeded by user: ${actor.user?.username}`,
            `Actor ${userId} has exceeded their usage allowance significantly`,
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
            },
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

        if (lastChange) {
            const timeDelta = now - lastChange.timestamp;
            const usageDelta = currTotal - lastChange.total;
            const usagePerMinute = usageDelta / (timeDelta / 60000);

            if (usagePerMinute > MeteringService.MAX_GLOBAL_USAGE_PER_MINUTE) {
                this.clients.alarm.create(
                    'metering:excessiveGlobalUsageRate',
                    `Global usage rate is excessive: ${usagePerMinute} micro-cents per minute`,
                    {
                        usagePerMinute,
                        maxAllowedPerMinute:
                            MeteringService.MAX_GLOBAL_USAGE_PER_MINUTE,
                    },
                );
            }
        }

        await this.stores.kv.set({
            key: lastChangeKey,
            value: { total: currTotal, timestamp: now },
        });
    }
}
