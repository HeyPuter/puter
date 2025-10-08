import { SystemActorType } from "../../auth/Actor.js";
// TODO DS: these should be loaded from config or db eventually
const USAGE_TYPE_MAPS = {
    // Map with unit to cost measurements in microcent
    'kv:read': 63,
    'kv:write': 125,
    // TODO DS: add more usage types as needed
};
// NOTE: create daily and hourly entry buckets that expire at given ranges 2 days for hours, 6 months for daily
// Store consumed microcents whenever a consumption event goes through
// keep timestamp of consumption last updated to limit burst usage
const POLICY_TYPES = {
    'free': {}, // TODO DS: define what needs to go here
};
const GLOBAL_APP_KEY = 'os-global'; // TODO DS: this should be loaded from config or db eventually
const METRICS_PREFIX = 'metering';
const POLICY_PREFIX = 'policy';
/**
 * Handles usage metering and supports stubbs for billing methods for current scoped actor
 */
export class MeteringAndBillingService {
    #kvClientWrapper;
    #superUserService;
    constructor(kvClientWrapper, superUserService) {
        this.#superUserService = superUserService;
        this.#kvClientWrapper = kvClientWrapper;
    }
    #getMonthYearString() {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    // TODO DS: track daily and hourly usage as well
    async incrementUsage(actor, usageType, usageAmount, costOverride) {
        if ( actor.type instanceof SystemActorType || actor.type?.user?.username === 'system' ) {
            // Don't track for now since it will trigger infinite noise;
            return { total: 0 };
        }
        const currentMonth = this.#getMonthYearString();
        return this.#superUserService.sudo(async () => {
            const totalCost = (costOverride ?? USAGE_TYPE_MAPS[usageType] * usageAmount) || 0; // TODO DS: apply our policy discounts here eventually
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
            const actorAppUsageKey = `${METRICS_PREFIX}:actor:${actorId}:app:${appId}:${currentMonth}`;
            this.#kvClientWrapper.incr({
                key: actorAppUsageKey,
                pathAndAmountMap,
            });
            const appUsageKey = `${METRICS_PREFIX}:app:${appId}:${currentMonth}`;
            this.#kvClientWrapper.incr({
                key: appUsageKey,
                pathAndAmountMap,
            });
            const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${actorId}:apps:${currentMonth}`;
            this.#kvClientWrapper.incr({
                key: actorAppTotalsKey,
                pathAndAmountMap: {
                    [`${appId}.total`]: totalCost,
                    [`${appId}.count`]: 1,
                },
            });
            const puterConsumptionKey = `${METRICS_PREFIX}:puter:${currentMonth}`; // global consumption across all users and apps
            this.#kvClientWrapper.incr({
                key: puterConsumptionKey,
                pathAndAmountMap: {
                    'total': totalCost,
                    [`${usageType}.units`]: usageAmount,
                    [`${usageType}.cost`]: totalCost,
                    [`${usageType}.count`]: 1,
                },
            });
            return (await Promise.all([lastUpdatedPromise, actorUsagesPromise]))[1];
        });
        // TODO DS: this should increment the cost for the given type of operation, and the total cost for daily, weekly and monthly usage
    }
    async getActorCurrentMonthUsageDetails(actor) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:${currentMonth}`,
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:apps:${currentMonth}`,
        ];
        return this.#superUserService.sudo(async () => {
            const [usage, appTotals] = await this.#kvClientWrapper.get({ key: keys });
            return {
                usage: usage || { total: 0 },
                appTotals: appTotals || {},
            };
        });
    }
    async getActorCurrentMonthAppUsageDetails(actor, appId) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`;
        return this.#superUserService.sudo(async () => {
            const usage = await this.#kvClientWrapper.get({ key });
            return usage || { total: 0 };
        });
    }
    async getCurrentMonthsConsumedCredit(actor) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get consumed credits');
        }
        const currentMonth = this.#getMonthYearString();
        // batch get actor usage for the month, and actor policy, and actor policy addons to then compute cost
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:${currentMonth}`,
            `${POLICY_PREFIX}:actor:${actor.type.user.uuid}:addons`,
        ];
        return this.#superUserService.sudo(async () => {
            const [usage, addons] = await this.#kvClientWrapper.get({ key: keys });
            let totalCost = 0;
            if ( usage ) {
                for ( const [usageType, usageData] of Object.entries(usage.thisMonth) ) {
                    if ( USAGE_TYPE_MAPS[usageType] ) {
                        totalCost += (USAGE_TYPE_MAPS[usageType] * (usageData.total || 0));
                    }
                }
            }
            return totalCost;
        });
    }
    async getActorPolicy(actor) {
        if ( !actor.type?.user.uuid ) {
            throw new Error('Actor must be a user to get policy');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user.uuid}`;
        return this.#superUserService.sudo(async () => {
            const policy = await this.#kvClientWrapper.get({ key });
            policy;
            return (policy || 'free');
        });
    }
    async getActorPolicyAddons(actor) {
        if ( !actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get policy addons');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            const policyAddOns = await this.#kvClientWrapper.get({ key });
            return (policyAddOns ?? {});
        });
    }
    async #updateAddonCredit(actor, tokenAmount) {
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
    handlePolicyPurchase(actor, policyType) {
        // TODO DS: this should leverage extensions to call billing implementations
    }
    handleTokenPurchase(actor, tokenAmount) {
        // TODO DS: this should leverage extensions to call billing implementations
    }
}
