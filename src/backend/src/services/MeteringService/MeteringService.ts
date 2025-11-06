import murmurhash from 'murmurhash';
import type { AlarmService } from '../../modules/core/AlarmService.js';
import { SystemActorType, type Actor } from '../auth/Actor.js';
import type { EventService } from '../EventService';
import type { DBKVStore } from '../repositories/DBKVStore/DBKVStore';
import type { SUService } from '../SUService.js';
import { DEFAULT_FREE_SUBSCRIPTION, DEFAULT_TEMP_SUBSCRIPTION, GLOBAL_APP_KEY, METRICS_PREFIX, PERIOD_ESCAPE, POLICY_PREFIX } from './consts.js';
import { COST_MAPS } from './costMaps/index.js';
import { SUB_POLICIES } from './subPolicies/index.js';
import { AppTotals, MeteringServiceDeps, UsageAddons, UsageByType, UsageRecord } from './types.js';
/**
 * Handles usage metering and supports stubbs for billing methods for current scoped actor
 */
export class MeteringService {

    static GLOBAL_SHARD_COUNT = 1000; // number of global usage shards to spread writes across
    static APP_SHARD_COUNT = 100; // number of app usage shards to spread writes across
    #kvStore: DBKVStore;
    #superUserService: SUService;
    #alarmService: AlarmService;
    #eventService: EventService;
    constructor ({ kvStore, superUserService, alarmService, eventService }: MeteringServiceDeps) {
        this.#superUserService = superUserService;
        this.#kvStore = kvStore;
        this.#alarmService = alarmService;
        this.#eventService = eventService;
    }

    utilRecordUsageObject<T extends Record<string, number>>(trackedUsageObject: T, actor: Actor, modelPrefix: string, costsOverrides?: Record<keyof T, number>) {
        this.batchIncrementUsages(actor, Object.entries(trackedUsageObject).map(([usageKind, amount]) => ({
            usageType: `${modelPrefix}:${usageKind}`,
            usageAmount: amount,
            costOverride: costsOverrides?.[usageKind as keyof T],
        })));
    }

    #getMonthYearString () {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Adds some randomized number from 0-999 to the usage key to help spread writes
     * @param userId
     * @param appId
     * @returns
     */
    #generateGloabalUsageKey (userId: string, appId: string, currentMonth: string) {
        const hashOfUserAndApp = murmurhash.v3(`${userId}:${appId}`) % MeteringService.GLOBAL_SHARD_COUNT;
        const key = `${METRICS_PREFIX}:puter:${hashOfUserAndApp}:${currentMonth}`;
        return key;
    }

    /**
     * adds some randomized number from 0-99 to the usage key to help spread writes
     * @param appId
     * @param currentMonth
     * @returns
     */
    #generateAppUsageKey (appId: string, currentMonth: string) {
        const hashOfApp = murmurhash.v3(`${appId}`) % MeteringService.APP_SHARD_COUNT;
        const key = `${METRICS_PREFIX}:app:${appId}:${hashOfApp}:${currentMonth}`;
        return key;
    }

    // TODO DS: track daily and hourly usage as well
    async incrementUsage (actor: Actor, usageType: (keyof typeof COST_MAPS) | (string & {}), usageAmount: number, costOverride?: number) {
        try {
            if ( !usageAmount || !usageType || !actor ) {
                // silent fail for now;
                return { total: 0 } as UsageByType;
            }

            if ( actor.type instanceof SystemActorType || actor.type?.user?.username === 'system' ) {
                // Don't track for now since it will trigger infinite noise;
                return { total: 0 } as UsageByType;
            }

            const currentMonth = this.#getMonthYearString();

            return this.#superUserService.sudo(async () => {
                const totalCost = (costOverride ?? (COST_MAPS[usageType as keyof typeof COST_MAPS] || 0) * usageAmount) || 0; // TODO DS: apply our policy discounts here eventually

                if ( COST_MAPS[usageType as keyof typeof COST_MAPS] !== 0 && totalCost === 0 && costOverride === undefined ) {
                    // could be something is off, there are some models that cost nothing from openrouter, but then our overrides should not be undefined, so will flag
                    this.#alarmService.create('metering-service-0-cost-warning', 'potential abuse vector', {
                        actor,
                        usageType,
                        usageAmount,
                        costOverride,
                    });
                }

                usageType = usageType.replace(/\./g, PERIOD_ESCAPE) as keyof typeof COST_MAPS; // replace dots with underscores for kvstore paths, TODO DS: map this back when reading
                const appId = actor.type?.app?.uid || GLOBAL_APP_KEY;
                const userId = actor.type?.user.uuid;
                const pathAndAmountMap = {
                    'total': totalCost,
                    [`${usageType}.units`]: usageAmount,
                    [`${usageType}.cost`]: totalCost,
                    [`${usageType}.count`]: 1,
                };

                const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
                const actorUsagesPromise = this.#kvStore.incr({
                    key: actorUsageKey,
                    pathAndAmountMap,
                }) as Promise<UsageByType>;

                const puterConsumptionKey = this.#generateGloabalUsageKey(userId, appId, currentMonth); // global consumption across all users and apps
                this.#kvStore.incr({
                    key: puterConsumptionKey,
                    pathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'puterConsumptionKey\' with error: ', e);
                });

                const actorAppUsageKey = `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppUsageKey,
                    pathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'actorAppUsageKey\' with error: ', e);
                });

                const appUsageKey = this.#generateAppUsageKey(appId, currentMonth);
                this.#kvStore.incr({
                    key: appUsageKey,
                    pathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'appUsageKey\' with error: ', e);
                });

                const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppTotalsKey,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalCost,
                        [`${appId}.count`]: 1,
                    },
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'actorAppTotalsKey\' with error: ', e);
                });

                const lastUpdatedKey = `${METRICS_PREFIX}:actor:${userId}:lastUpdated`;
                this.#kvStore.set({
                    key: lastUpdatedKey,
                    value: Date.now(),
                }).catch((e: Error) => {
                    console.warn('Failed to set lastUpdatedKey with error: ', e);
                });

                // update addon usage if we are over the allowance
                const actorSubscriptionPromise = this.getActorSubscription(actor);
                const actorAddonsPromise = this.getActorAddons(actor);
                const [actorUsages, actorSubscription, actorAddons] =  (await Promise.all([actorUsagesPromise, actorSubscriptionPromise, actorAddonsPromise]));
                if ( actorUsages.total > actorSubscription.monthUsageAllowance && actorAddons.purchasedCredits && actorAddons.purchasedCredits > (actorAddons.consumedPurchaseCredits || 0) ) {
                    // if we are now over the allowance, start consuming purchased credits
                    const withinBoundsUsage = Math.max(0, actorSubscription.monthUsageAllowance - actorUsages.total + totalCost);
                    const overageUsage = totalCost - withinBoundsUsage;

                    if ( overageUsage > 0 ) {
                        await this.#kvStore.incr({
                            key: `${POLICY_PREFIX}:actor:${userId}:addons`,
                            pathAndAmountMap: {
                                consumedPurchaseCredits: Math.min(overageUsage, actorAddons.purchasedCredits - (actorAddons.consumedPurchaseCredits || 0)), // don't go over the purchased credits, technically a race condition here, but optimistically rare
                            },
                        });
                    }
                }
                // alert if significantly over allowance and no purchased credits left
                const allowedUsageMultiple = Math.floor(actorUsages.total / actorSubscription.monthUsageAllowance);
                const previousAllowedUsageMultiple = Math.floor((actorUsages.total - totalCost) / actorSubscription.monthUsageAllowance);
                const isOver2x = allowedUsageMultiple >= 2;
                const isChangeOverPastOverage = previousAllowedUsageMultiple < allowedUsageMultiple;
                const hasNoAddonCredit = (actorAddons.purchasedCredits || 0) <= (actorAddons.consumedPurchaseCredits || 0);
                if ( isOver2x && isChangeOverPastOverage && hasNoAddonCredit ) {
                    this.#alarmService.create('metering-service-usage-limit-exceeded', `Actor ${userId} has exceeded their usage allowance significantly`, {
                        actor,
                        usageType,
                        usageAmount,
                        costOverride,
                        totalUsage: actorUsages.total,
                        monthUsageAllowance: actorSubscription.monthUsageAllowance,
                    });
                }
                return actorUsages;
            });
        } catch ( e ) {
            console.error('Metering: Failed to increment usage for actor', actor, 'usageType', usageType, 'usageAmount', usageAmount, e);
            this.#alarmService.create('metering-service-error', (e as Error).message, {
                error: e,
                actor,
                usageType,
                usageAmount,
                costOverride,
            });
            return { total: 0 } as UsageByType;
        }
    }

    async batchIncrementUsages (actor: Actor, usages: { usageType: (keyof typeof COST_MAPS) | (string & {}), usageAmount: number, costOverride?: number }[]) {
        try {
            if ( !usages || usages.length === 0 || !actor ) {
                // silent fail for now;
                return { total: 0 } as UsageByType;
            }

            if ( actor.type instanceof SystemActorType || actor.type?.user?.username === 'system' ) {
                // Don't track for now since it will trigger infinite noise;
                return { total: 0 } as UsageByType;
            }

            const currentMonth = this.#getMonthYearString();

            return this.#superUserService.sudo(async () => {
                // Aggregate all pathAndAmountMap entries for all usages
                const aggregatedPathAndAmountMap: Record<string, number> = {};
                let totalBatchCost = 0;
                let hasZeroCostWarning = false;

                // Process each usage and aggregate the pathAndAmountMap
                for ( const usage of usages ) {
                    const { usageType, usageAmount, costOverride } = usage;

                    if ( !usageAmount || !usageType ) {
                        continue; // skip invalid entries
                    }

                    const totalCost = (costOverride ?? (COST_MAPS[usageType as keyof typeof COST_MAPS] || 0) * usageAmount) || 0;
                    totalBatchCost += totalCost;

                    // Check for zero cost warning (only flag once per batch)
                    if ( !hasZeroCostWarning && COST_MAPS[usageType as keyof typeof COST_MAPS] !== 0 && totalCost === 0 && costOverride === undefined ) {
                        hasZeroCostWarning = true;
                        this.#alarmService.create('metering-service-0-cost-warning', 'potential abuse vector', {
                            actor,
                            usageType,
                            usageAmount,
                            costOverride,
                        });
                    }

                    const escapedUsageType = usageType.replace(/\./g, PERIOD_ESCAPE) as keyof typeof COST_MAPS;

                    // Aggregate into the pathAndAmountMap
                    aggregatedPathAndAmountMap['total'] = (aggregatedPathAndAmountMap['total'] || 0) + totalCost;
                    aggregatedPathAndAmountMap[`${escapedUsageType}.units`] = (aggregatedPathAndAmountMap[`${escapedUsageType}.units`] || 0) + usageAmount;
                    aggregatedPathAndAmountMap[`${escapedUsageType}.cost`] = (aggregatedPathAndAmountMap[`${escapedUsageType}.cost`] || 0) + totalCost;
                    aggregatedPathAndAmountMap[`${escapedUsageType}.count`] = (aggregatedPathAndAmountMap[`${escapedUsageType}.count`] || 0) + 1;
                }

                const appId = actor.type?.app?.uid || GLOBAL_APP_KEY;
                const userId = actor.type?.user.uuid;

                const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
                const actorUsagesPromise = this.#kvStore.incr({
                    key: actorUsageKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }) as Promise<UsageByType>;

                const puterConsumptionKey = this.#generateGloabalUsageKey(userId, appId, currentMonth);
                this.#kvStore.incr({
                    key: puterConsumptionKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'puterConsumptionKey\' with error: ', e);
                });

                const actorAppUsageKey = `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppUsageKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'actorAppUsageKey\' with error: ', e);
                });

                const appUsageKey = this.#generateAppUsageKey(appId, currentMonth);
                this.#kvStore.incr({
                    key: appUsageKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'appUsageKey\' with error: ', e);
                });

                const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppTotalsKey,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalBatchCost,
                        [`${appId}.count`]: usages.length,
                    },
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'actorAppTotalsKey\' with error: ', e);
                });

                const lastUpdatedKey = `${METRICS_PREFIX}:actor:${userId}:lastUpdated`;
                this.#kvStore.set({
                    key: lastUpdatedKey,
                    value: Date.now(),
                }).catch((e: Error) => {
                    console.warn('Failed to set lastUpdatedKey with error: ', e);
                });

                // update addon usage if we are over the allowance
                const actorSubscriptionPromise = this.getActorSubscription(actor);
                const actorAddonsPromise = this.getActorAddons(actor);
                const [actorUsages, actorSubscription, actorAddons] = (await Promise.all([actorUsagesPromise, actorSubscriptionPromise, actorAddonsPromise]));

                if ( actorUsages.total > actorSubscription.monthUsageAllowance && actorAddons.purchasedCredits && actorAddons.purchasedCredits > (actorAddons.consumedPurchaseCredits || 0) ) {
                    // if we are now over the allowance, start consuming purchased credits
                    const withinBoundsUsage = Math.max(0, actorSubscription.monthUsageAllowance - actorUsages.total + totalBatchCost);
                    const overageUsage = totalBatchCost - withinBoundsUsage;

                    if ( overageUsage > 0 ) {
                        await this.#kvStore.incr({
                            key: `${POLICY_PREFIX}:actor:${userId}:addons`,
                            pathAndAmountMap: {
                                consumedPurchaseCredits: Math.min(overageUsage, actorAddons.purchasedCredits - (actorAddons.consumedPurchaseCredits || 0)),
                            },
                        });
                    }
                }

                // alert if significantly over allowance and no purchased credits left
                const allowedUsageMultiple = Math.floor(actorUsages.total / actorSubscription.monthUsageAllowance);
                const previousAllowedUsageMultiple = Math.floor((actorUsages.total - totalBatchCost) / actorSubscription.monthUsageAllowance);
                const isOver2x = allowedUsageMultiple >= 2;
                const isChangeOverPastOverage = previousAllowedUsageMultiple < allowedUsageMultiple;
                const hasNoAddonCredit = (actorAddons.purchasedCredits || 0) <= (actorAddons.consumedPurchaseCredits || 0);

                if ( isOver2x && isChangeOverPastOverage && hasNoAddonCredit ) {
                    this.#alarmService.create('metering-service-usage-limit-exceeded', `Actor ${userId} has exceeded their usage allowance significantly`, {
                        actor,
                        batchUsages: usages,
                        totalBatchCost,
                        totalUsage: actorUsages.total,
                        monthUsageAllowance: actorSubscription.monthUsageAllowance,
                    });
                }

                return actorUsages;
            });
        } catch (e) {
            console.error('Metering: Failed to batch increment usage for actor', actor, 'usages', usages, e);
            this.#alarmService.create('metering-service-error', (e as Error).message, {
                error: e,
                actor,
                batchUsages: usages,
            });
            return { total: 0 } as UsageByType;
        }
    }

    async getActorCurrentMonthUsageDetails (actor: Actor) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:${currentMonth}`,
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:apps:${currentMonth}`,
        ];

        return await this.#superUserService.sudo(async () => {
            const [usage, appTotals] = await this.#kvStore.get({ key: keys }) as [UsageByType | null, Record<string, AppTotals> | null];
            // only show details of app based on actor, aggregate all as others, except if app is global one or null, then show all
            const appId = actor.type?.app?.uid;
            if ( appTotals && appId ) {
                const filteredAppTotals: Record<string, AppTotals> = {};
                let othersTotal: AppTotals = {} as AppTotals;
                Object.entries(appTotals).forEach(([appKey, appUsage]) => {
                    if ( appKey === appId ) {
                        filteredAppTotals[appKey] = appUsage;
                    } else {
                        Object.entries(appUsage).forEach(([usageKind, amount]) => {
                            if ( !othersTotal[usageKind as keyof AppTotals] ) {
                                othersTotal[usageKind as keyof AppTotals] = 0;
                            }
                            othersTotal[usageKind as keyof AppTotals] += amount;
                        });
                    }
                });
                if ( othersTotal ) {
                    filteredAppTotals['others'] = othersTotal;
                }
                return {
                    usage: usage || { total: 0 },
                    appTotals: filteredAppTotals,
                };
            }
            return {
                usage: usage || { total: 0 },
                appTotals: appTotals || {},
            };
        });
    }

    async getActorCurrentMonthAppUsageDetails (actor: Actor, appId?: string) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        appId = appId || actor.type?.app?.uid || GLOBAL_APP_KEY;
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`;

        return await this.#superUserService.sudo(async () => {
            const usage = await this.#kvStore.get({ key }) as UsageByType | null;
            // only show usage if actor app is the same or if global app ( null appId )
            const actorAppId = actor.type?.app?.uid;
            if ( actorAppId && actorAppId !== appId && appId !== GLOBAL_APP_KEY ) {
                throw new Error('Actor can only get usage details for their own app or global app');
            }
            return usage || { total: 0 };
        });
    }

    async getRemainingUsage (actor: Actor) {
        const allowedUsage = await this.getAllowedUsage(actor);
        return allowedUsage.remaining || 0;

    }

    async getAllowedUsage (actor: Actor) {
        const userSubscriptionPromise = this.getActorSubscription(actor);
        const userAddonsPromise = this.getActorAddons(actor);
        const currentUsagePromise = this.getActorCurrentMonthUsageDetails(actor);

        const [userSubscription, addons, currentMonthUsage] = await Promise.all([userSubscriptionPromise, userAddonsPromise, currentUsagePromise]);
        return {
            remaining: Math.max(0, (userSubscription.monthUsageAllowance || 0) + (addons?.purchasedCredits || 0) - (currentMonthUsage.usage.total || 0) - (addons?.consumedPurchaseCredits || 0)),
            monthUsageAllowance: userSubscription.monthUsageAllowance,
            addons,
        };
    }

    async hasAnyUsage (actor: Actor) {
        return (await this.getRemainingUsage(actor)) > 0;
    }

    async hasEnoughCreditsFor (actor: Actor, usageType: keyof typeof COST_MAPS, usageAmount: number) {
        const remainingUsage = await this.getRemainingUsage(actor);
        const cost = (COST_MAPS[usageType] || 0) * usageAmount;
        return remainingUsage >= cost;
    }

    async hasEnoughCredits (actor: Actor, amount: number) {
        const remainingUsage = await this.getRemainingUsage(actor);
        return remainingUsage >= amount;
    }

    async getActorSubscription (actor: Actor): Promise<(typeof SUB_POLICIES)[number]> {
        // TODO DS: maybe allow non-user actors to have subscriptions eventually
        if ( !actor.type?.user.uuid ) {
            throw new Error('Actor must be a user to get policy');
        }

        const defaultUserSubscriptionId = (actor.type.user.email ? DEFAULT_FREE_SUBSCRIPTION : DEFAULT_TEMP_SUBSCRIPTION);
        const defaultSubscriptionEvent = { actor, defaultSubscriptionId: '' };
        const availablePoliciesEvent = { actor, availablePolicies: [] as (typeof SUB_POLICIES)[number][] };
        const userSubscriptionEvent = { actor, userSubscriptionId: '' };

        await Promise.allSettled([
            this.#eventService.emit('metering:overrideDefaultSubscription', defaultSubscriptionEvent), // can override default subscription based on actor properties
            this.#eventService.emit('metering:registerAvailablePolicies', availablePoliciesEvent), // will add or modify available policies
            this.#eventService.emit('metering:getUserSubscription', userSubscriptionEvent), // will set userSubscription property on event
        ]);

        const defaultSubscriptionId = defaultSubscriptionEvent.defaultSubscriptionId as unknown as (typeof SUB_POLICIES)[number]['id'] || defaultUserSubscriptionId;
        const availablePolicies = [ ...availablePoliciesEvent.availablePolicies, ...SUB_POLICIES ];
        const userSubscriptionId = userSubscriptionEvent.userSubscriptionId as unknown as typeof SUB_POLICIES[number]['id'] || defaultSubscriptionId;

        return availablePolicies.find(({ id }) => id === userSubscriptionId) || availablePolicies.find(({ id }) => id === defaultSubscriptionId)!;
    }

    async getActorAddons (actor: Actor) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get policy addons');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            const addons = await this.#kvStore.get({ key });
            return (addons ?? {}) as UsageAddons;
        });
    }

    async getActorAppUsage (actor: Actor, appId: string) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get app usage');
        }

        // only allow actor to get their own app usage
        if ( actor.type?.app?.uid && actor.type?.app?.uid !== appId ) {
            throw new Error('Actor can only get usage for their own app');
        }

        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`;
        return this.#superUserService.sudo(async () => {
            const usage = await this.#kvStore.get({ key });
            return (usage ?? { total: 0 }) as UsageByType;
        });
    }

    async getGlobalUsage () {

        // TODO DS: add validation here?

        const currentMonth = this.#getMonthYearString();
        const keyPrefix = `${METRICS_PREFIX}:puter:`;
        return this.#superUserService.sudo(async () => {
            const keys = [];
            for ( let shard = 0; shard < MeteringService.GLOBAL_SHARD_COUNT; shard++ ) {
                keys.push(`${keyPrefix}${shard}:${currentMonth}`);
            }
            keys.push(`${keyPrefix}${currentMonth}`); // for initial unsharded data
            const usages = await this.#kvStore.get({ key: keys }) as UsageByType[];
            const aggregatedUsage: UsageByType = { total: 0 };
            usages.filter(Boolean).forEach(({ total, ...usage } = {} as UsageByType) => {
                aggregatedUsage.total += total || 0;

                Object.entries((usage || {}) as Record<string, UsageRecord>).forEach(([usageKind, record]) => {
                    if ( !aggregatedUsage[usageKind] ) {
                        aggregatedUsage[usageKind] = { cost: 0, units: 0, count: 0 } as UsageRecord;
                    }
                    const aggregatedRecord = aggregatedUsage[usageKind] as UsageRecord;
                    aggregatedRecord.cost += record.cost;
                    aggregatedRecord.count += record.count;
                    aggregatedRecord.units += record.units;
                });
            });
            return aggregatedUsage;
        });
    }

    async updateAddonCredit (userId:string, tokenAmount: number) {
        if ( !userId ) {
            throw new Error('User needed to update extra credits');
        }
        const key = `${POLICY_PREFIX}:actor:${userId}:addons`;
        return this.#superUserService.sudo(async () => {
            await this.#kvStore.incr({
                key,
                pathAndAmountMap: {
                    purchasedCredits: tokenAmount,
                },
            });
        });
    }
}