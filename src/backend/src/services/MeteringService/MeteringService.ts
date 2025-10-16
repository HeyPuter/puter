import type { AlarmService } from '../../modules/core/AlarmService.js';
import { SystemActorType, type Actor } from '../auth/Actor.js';
import type { EventService } from '../EventService'; // Type-only import for TS safety
import type { DBKVStore } from '../repositories/DBKVStore/DBKVStore';
import type { SUService } from '../SUService.js';
import { DEFAULT_FREE_SUBSCRIPTION, DEFAULT_TEMP_SUBSCRIPTION, GLOBAL_APP_KEY, METRICS_PREFIX, PERIOD_ESCAPE, POLICY_PREFIX } from './consts.js';
import { COST_MAPS } from './costMaps/index.js';
import { SUB_POLICIES } from './subPolicies/index.js';

interface PolicyAddOns {
    purchasedCredits: number
    purchasedStorage: number
    rateDiscounts: {
        [usageType: string]: number | string // TODO DS: string to support graduated discounts eventually
    }
}
interface UsageByType {
    total: number
    [serviceName: string]: number
}

interface MeteringAndBillingServiceDeps {
    kvClientWrapper: DBKVStore,
    superUserService: SUService,
    alarmService: AlarmService
    eventService: EventService
}
/**
 * Handles usage metering and supports stubbs for billing methods for current scoped actor
 */
export class MeteringAndBillingService {

    #kvClientWrapper: DBKVStore;
    #superUserService: SUService;
    #alarmService: AlarmService;
    #eventService: EventService;
    constructor({ kvClientWrapper, superUserService, alarmService, eventService }: MeteringAndBillingServiceDeps) {
        this.#superUserService = superUserService;
        this.#kvClientWrapper = kvClientWrapper;
        this.#alarmService = alarmService;
        this.#eventService = eventService;
    }

    utilRecordUsageObject<T extends Record<string, number>>(trackedUsageObject: T, actor: Actor, modelPrefix: string, costsOverrides?: Record<keyof T, number>) {
        Object.entries(trackedUsageObject).forEach(([usageKind, amount]) => {
            this.incrementUsage(actor, `${modelPrefix}:${usageKind}`, amount, costsOverrides?.[usageKind as keyof T]);
        });
    }

    #getMonthYearString() {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // TODO DS: track daily and hourly usage as well
    async incrementUsage(actor: Actor, usageType: (keyof typeof COST_MAPS) | (string & {}), usageAmount: number, costOverride?: number) {
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

                if ( totalCost === 0 && costOverride === undefined ) {
                    // could be something is off, there are some models that cost nothing from openrouter, but then our overrides should not be undefined, so will flag
                    this.#alarmService.create('metering-service-warning', "potential abuse vector", {
                        actor,
                        usageType,
                        usageAmount,
                        costOverride,
                    });
                }

                usageType = usageType.replace(/\./g, PERIOD_ESCAPE) as keyof typeof COST_MAPS; // replace dots with underscores for kvstore paths, TODO DS: map this back when reading
                const appId = actor.type?.app?.uid || GLOBAL_APP_KEY;
                const actorId = actor.type?.user.uuid;
                const pathAndAmountMap = {
                    'total': totalCost,
                    [`${usageType}.units`]: usageAmount,
                    [`${usageType}.cost`]: totalCost,
                    [`${usageType}.count`]: 1,
                };

                const lastUpdatedKey = `${METRICS_PREFIX}:actor:${actorId}:lastUpdated`;
                const lastUpdatedPromise = this.#kvClientWrapper.set({
                    key: lastUpdatedKey,
                    value: Date.now(),
                });

                const actorUsageKey = `${METRICS_PREFIX}:actor:${actorId}:${currentMonth}`;
                const actorUsagesPromise = this.#kvClientWrapper.incr({
                    key: actorUsageKey,
                    pathAndAmountMap,
                });

                const puterConsumptionKey = `${METRICS_PREFIX}:puter:${currentMonth}`; // global consumption across all users and apps
                this.#kvClientWrapper.incr({
                    key: puterConsumptionKey,
                    pathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'puterConsumptionKey\' with error: ', e);
                });

                const actorAppUsageKey = `${METRICS_PREFIX}:actor:${actorId}:app:${appId}:${currentMonth}`;
                this.#kvClientWrapper.incr({
                    key: actorAppUsageKey,
                    pathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'actorAppUsageKey\' with error: ', e);
                });

                const appUsageKey = `${METRICS_PREFIX}:app:${appId}:${currentMonth}`;
                this.#kvClientWrapper.incr({
                    key: appUsageKey,
                    pathAndAmountMap,
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'appUsageKey\' with error: ', e);
                });

                const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${actorId}:apps:${currentMonth}`;
                this.#kvClientWrapper.incr({
                    key: actorAppTotalsKey,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalCost,
                        [`${appId}.count`]: 1,
                    },
                }).catch((e: Error) => {
                    console.warn('Failed to increment aux usage data \'actorAppTotalsKey\' with error: ', e);
                });

                return (await Promise.all([lastUpdatedPromise, actorUsagesPromise]))[1] as UsageByType;
            });
        } catch (e) {
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

    async getActorCurrentMonthUsageDetails(actor: Actor) {
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
            const [usage, appTotals] = await this.#kvClientWrapper.get({ key: keys }) as [UsageByType | null, Record<string, UsageByType> | null];
            // only show details of app based on actor, aggregate all as others, except if app is global one or null, then show all
            const appId = actor.type?.app?.uid;
            if ( appTotals && appId ) {
                const filteredAppTotals: Record<string, UsageByType> = {};
                let othersTotal: UsageByType = {} as UsageByType;
                Object.entries(appTotals).forEach(([appKey, appUsage]) => {
                    if ( appKey === appId ) {
                        filteredAppTotals[appKey] = appUsage;
                    } else {
                        Object.entries(appUsage).forEach(([usageKind, amount]) => {
                            if ( !othersTotal[usageKind] ) {
                                othersTotal[usageKind] = 0;
                            }
                            othersTotal[usageKind] += amount;
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

    async getActorCurrentMonthAppUsageDetails(actor: Actor, appId?: string) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        appId = appId || actor.type?.app?.uid || GLOBAL_APP_KEY;
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`;

        return await this.#superUserService.sudo(async () => {
            const usage = await this.#kvClientWrapper.get({ key }) as UsageByType | null;
            // only show usage if actor app is the same or if global app ( null appId )
            const actorAppId = actor.type?.app?.uid;
            if ( actorAppId && actorAppId !== appId && appId !== GLOBAL_APP_KEY ) {
                throw new Error('Actor can only get usage details for their own app or global app');
            }
            return usage || { total: 0 };
        });
    }

    async getRemainingUsage(actor: Actor) {
        const allowedUsage = await this.getAllowedUsage(actor);
        return allowedUsage.remaining || 0;

    }

    async getAllowedUsage(actor: Actor) {
        const userSubscriptionPromise = this.getActorSubscription(actor);
        const userPolicyAddonsPromise = this.getActorPolicyAddons(actor);
        const currentUsagePromise = this.getActorCurrentMonthUsageDetails(actor);

        const [userSubscription, userPolicyAddons, currentMonthUsage] = await Promise.all([userSubscriptionPromise, userPolicyAddonsPromise, currentUsagePromise]);
        return {
            remaining: Math.max(0, (userSubscription.monthUsageAllowance || 0) + (userPolicyAddons?.purchasedCredits || 0) - (currentMonthUsage.usage.total || 0)),
            monthUsageAllowance: userSubscription.monthUsageAllowance,
            userPolicyAddons,
        };
    }

    async hasAnyUsage(actor: Actor) {
        return (await this.getRemainingUsage(actor)) > 0;
    }

    async hasEnoughCreditsFor(actor: Actor, usageType: keyof typeof COST_MAPS, usageAmount: number) {
        const remainingUsage = await this.getRemainingUsage(actor);
        const cost = (COST_MAPS[usageType] || 0) * usageAmount;
        return remainingUsage >= cost;
    }

    async hasEnoughCredits(actor: Actor, amount: number) {
        const remainingUsage = await this.getRemainingUsage(actor);
        return remainingUsage >= amount;
    }

    async getActorSubscription(actor: Actor): Promise<(typeof SUB_POLICIES)[number]> {
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

    async getActorPolicyAddons(actor: Actor) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get policy addons');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            const policyAddOns = await this.#kvClientWrapper.get({ key });
            return (policyAddOns ?? {}) as PolicyAddOns;
        });
    }

    // eslint-disable-next-line
    async #updateAddonCredit(actor: Actor, tokenAmount: number) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to update extra credits');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            await this.#kvClientWrapper.incr({
                key,
                pathAndAmountMap: {
                    purchasedCredits: tokenAmount,
                },
            });
        });
    }

    handlePolicyPurchase(_actor: Actor, _policyType: keyof typeof SUB_POLICIES) {

        // TODO DS: this should leverage extensions to call billing implementations
    }
    handleTokenPurchase(_actor: Actor, _tokenAmount: number) {
        // TODO DS: this should leverage extensions to call billing implementations
    }

}