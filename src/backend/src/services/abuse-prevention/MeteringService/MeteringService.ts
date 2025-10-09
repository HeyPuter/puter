// @ts-ignore
import type KVStoreInterface from "../../../modules/kvstore/KVStoreInterfaceService.js";
// @ts-ignore
import { SystemActorType, type Actor } from "../../auth/Actor.js";
// @ts-ignore
import type { AlarmService } from "../../../modules/core/AlarmService.js";
// @ts-ignore
import type { SUService } from "../../SUService.js";
import { COST_MAPS } from "./costMaps/index.js";
interface ActorWithType extends Actor {
    type: {
        app: { uid: string }
        user: { uuid: string, username: string }
    }
}

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


// NOTE: create daily and hourly entry buckets that expire at given ranges 2 days for hours, 6 months for daily
// Store consumed microcents whenever a consumption event goes through
// keep timestamp of consumption last updated to limit burst usage

const POLICY_TYPES = {
    'free': {} // TODO DS: define what needs to go here
}
const GLOBAL_APP_KEY = 'os-global'; // TODO DS: this should be loaded from config or db eventually
const METRICS_PREFIX = 'metering';
const POLICY_PREFIX = 'policy';
const PERIOD_ESCAPE = '_dot_'; // to replace dots in usage types for kvstore paths

type AllPrefixes<T extends string, P extends string = ''> =
    T extends `${infer C}${infer R}`
    ? `${P}${C}` | AllPrefixes<R, `${P}${C}`>
    : P;
/**
 * Handles usage metering and supports stubbs for billing methods for current scoped actor
 */
export class MeteringAndBillingService {

    #kvClientWrapper: KVStoreInterface
    #superUserService: SUService
    #alarmService: AlarmService
    constructor({ kvClientWrapper, superUserService, alarmService }: { kvClientWrapper: KVStoreInterface, superUserService: SUService, alarmService: AlarmService }) {
        this.#superUserService = superUserService;
        this.#kvClientWrapper = kvClientWrapper;
        this.#alarmService = alarmService;
    }

    utilRecordUsageObject(trackedUsageObject: Record<string, number>, actor: Actor, modelPrefix: string) {
        Object.entries(trackedUsageObject).forEach(([usageKind, amount]) => {
            this.incrementUsage(actor, `${modelPrefix}:${usageKind}`, amount);
        });
    }

    #getMonthYearString() {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }


    // TODO DS: track daily and hourly usage as well
    async incrementUsage(actor: ActorWithType, usageType: (keyof typeof COST_MAPS) | (string & {}), usageAmount: number, costOverride?: number) {
        try {
            if (!usageAmount || !usageType || !actor) {
                // silent fail for now;
                console.warn("Invalid usage increment parameters", { actor, usageType, usageAmount, costOverride });
                return { total: 0 } as UsageByType;
            }

            if (actor.type instanceof SystemActorType || actor.type?.user?.username === 'system') {
                // Don't track for now since it will trigger infinite noise;
                return { total: 0 } as UsageByType;
            }

            const currentMonth = this.#getMonthYearString();

            return this.#superUserService.sudo(async () => {
                const totalCost = (costOverride ?? (COST_MAPS[usageType as keyof typeof COST_MAPS] || 0) * usageAmount) || 0; // TODO DS: apply our policy discounts here eventually
                usageType = usageType.replace(/\./g, PERIOD_ESCAPE) as keyof typeof COST_MAPS; // replace dots with underscores for kvstore paths, TODO DS: map this back when reading
                const appId = actor.type?.app?.uid || GLOBAL_APP_KEY
                const actorId = actor.type?.user.uuid
                const pathAndAmountMap = {
                    'total': totalCost,
                    [`${usageType}.units`]: usageAmount,
                    [`${usageType}.cost`]: totalCost,
                    [`${usageType}.count`]: 1,
                }

                const lastUpdatedKey = `${METRICS_PREFIX}:actor:${actorId}:lastUpdated`;
                const lastUpdatedPromise = this.#kvClientWrapper.set({
                    key: lastUpdatedKey,
                    value: Date.now(),
                })

                const actorUsageKey = `${METRICS_PREFIX}:actor:${actorId}:${currentMonth}`;
                const actorUsagesPromise = this.#kvClientWrapper.incr({
                    key: actorUsageKey,
                    pathAndAmountMap,
                })

                const puterConsumptionKey = `${METRICS_PREFIX}:puter:${currentMonth}`; // global consumption across all users and apps
                this.#kvClientWrapper.incr({
                    key: puterConsumptionKey,
                    pathAndAmountMap
                }).catch((e: Error) => { console.warn(`Failed to increment aux usage data 'puterConsumptionKey' with error: `, e) });

                const actorAppUsageKey = `${METRICS_PREFIX}:actor:${actorId}:app:${appId}:${currentMonth}`;
                this.#kvClientWrapper.incr({
                    key: actorAppUsageKey,
                    pathAndAmountMap,
                }).catch((e: Error) => { console.warn(`Failed to increment aux usage data 'actorAppUsageKey' with error: `, e) });

                const appUsageKey = `${METRICS_PREFIX}:app:${appId}:${currentMonth}`;
                this.#kvClientWrapper.incr({
                    key: appUsageKey,
                    pathAndAmountMap,
                }).catch((e: Error) => { console.warn(`Failed to increment aux usage data 'appUsageKey' with error: `, e) });

                const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${actorId}:apps:${currentMonth}`;
                this.#kvClientWrapper.incr({
                    key: actorAppTotalsKey,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalCost,
                        [`${appId}.count`]: 1,
                    },
                }).catch((e: Error) => { console.warn(`Failed to increment aux usage data 'actorAppTotalsKey' with error: `, e) });


                return (await Promise.all([lastUpdatedPromise, actorUsagesPromise]))[1] as UsageByType;
            })
        } catch (e) {
            console.error('Metering: Failed to increment usage for actor', actor, 'usageType', usageType, 'usageAmount', usageAmount, e);
            this.#alarmService.create('metering-service-error', (e as Error).message, {
                error: e,
                actor,
                usageType,
                usageAmount,
                costOverride
            });
            return { total: 0 } as UsageByType;
        }
        // TODO DS: this should increment the cost for the given type of operation, and the total cost for daily, weekly and monthly usage
    }

    async getActorCurrentMonthUsageDetails(actor: ActorWithType) {
        if (!actor.type?.user?.uuid) {
            throw new Error('Actor must be a user to get usage details');
        }
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:${currentMonth}`,
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:apps:${currentMonth}`
        ]
        return this.#superUserService.sudo(async () => {
            const [usage, appTotals] = await this.#kvClientWrapper.get({ key: keys }) as [UsageByType | null, Record<string, UsageByType> | null];
            return {
                usage: usage || { total: 0 },
                appTotals: appTotals || {},
            }
        })
    }

    async getActorCurrentMonthAppUsageDetails(actor: ActorWithType, appId: string) {
        if (!actor.type?.user?.uuid) {
            throw new Error('Actor must be a user to get usage details');
        }
        // batch get actor usage, per app usage, and actor app totals for the month
        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`

        return this.#superUserService.sudo(async () => {
            const usage = await this.#kvClientWrapper.get({ key }) as UsageByType | null;
            return usage || { total: 0 };
        })
    }

    async getCurrentMonthsConsumedCredit(actor: ActorWithType) {
        if (!actor.type?.user?.uuid) {
            throw new Error('Actor must be a user to get consumed credits');
        }
        const currentMonth = this.#getMonthYearString();
        // batch get actor usage for the month, and actor policy, and actor policy addons to then compute cost
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:${currentMonth}`,
            `${POLICY_PREFIX}:actor:${actor.type.user.uuid}:addons`,
        ]
        return this.#superUserService.sudo(async () => {
            const [usage, addons] = await this.#kvClientWrapper.get({ key: keys }) as [UsageByType | null, PolicyAddOns | null];
            return usage?.total || 0;
        })
    }

    async getActorPolicy(actor: ActorWithType) {
        if (!actor.type?.user.uuid) {
            throw new Error('Actor must be a user to get policy');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user.uuid}`;
        return this.#superUserService.sudo(async () => {
            const policy = await this.#kvClientWrapper.get({ key });
            policy
            return (policy || 'free') as keyof typeof POLICY_TYPES;
        })
    }

    async getActorPolicyAddons(actor: ActorWithType) {
        if (!actor.type?.user?.uuid) {
            throw new Error('Actor must be a user to get policy addons');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            const policyAddOns = await this.#kvClientWrapper.get({ key });
            return (policyAddOns ?? {}) as PolicyAddOns;
        })
    }

    async #updateAddonCredit(actor: ActorWithType, tokenAmount: number) {
        if (!actor.type?.user?.uuid) {
            throw new Error('Actor must be a user to update extra credits');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            await this.#kvClientWrapper.incr({
                key,
                pathAndAmountMap: {
                    purchasedCredits: tokenAmount,
                },
            })
        })

    }
    handlePolicyPurchase(actor: ActorWithType, policyType: keyof typeof POLICY_TYPES) {


        // TODO DS: this should leverage extensions to call billing implementations
    }
    handleTokenPurchase(actor: ActorWithType, tokenAmount: number) {
        // TODO DS: this should leverage extensions to call billing implementations
    }

}