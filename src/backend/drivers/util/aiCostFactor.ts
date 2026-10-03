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

import type { EventClient } from '../../clients/event/EventClient.js';
import type { Actor } from '../../core/actor';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import type {
    CreditHold,
    UsageByType,
    UsageInput,
} from '../../services/metering/types';

/** Anything past this is read as a mistake and the cost is left as-is. */
export const MAX_AI_COST_FACTOR = 10;

/**
 * The `<provider>:<model>` head of a usage type — usage types are written
 * `<provider>:<model>:<what>`, e.g. `xai:stt:second`.
 */
export const aiModelKey = (usageType: string): string =>
    usageType.split(':').slice(0, 2).join(':');

/**
 * Metering as an AI driver uses it: recorded costs pass through the
 * `ai.cost.factor.<driver>.<model>` hook first, and credit gates can price at
 * the same factored cost.
 */
export type AiMeteringService = MeteringService & {
    /** `model`'s cost factor. 1 when unhooked or the answer is unusable. */
    costFactor(actor: Actor, model: string): Promise<number>;
    /**
     * Check that `amount`, scaled by the factor of the model `usageType` is
     * recorded under, is affordable and hold it while the operation runs. Null
     * when the actor can't afford it.
     */
    reserveAiCredits(
        actor: Actor,
        usageType: string,
        amount: number,
    ): Promise<CreditHold | null>;
};

/**
 * Whether anything prices this model. Synchronous so an unhooked deployment
 * records in the caller's own tick, not after the request ends.
 */
const hasAiCostFactor = (
    events: EventClient,
    driver: string,
    model: string,
): boolean => events.hasListeners(`ai.cost.factor.${driver}.${model}`);

/** One model's cost factor. 1 when unhooked or the answer is unusable. */
const resolveAiCostFactor = async (
    events: EventClient,
    actor: Actor,
    driver: string,
    model: string,
): Promise<number> => {
    const key = `ai.cost.factor.${driver}.${model}` as const;
    try {
        if (!hasAiCostFactor(events, driver, model)) return 1;
        const event = { driver, model, actor, factor: 1 };
        await events.emitAndWait(key, event, {});
        const factor = Number(event.factor);
        if (
            !Number.isFinite(factor) ||
            factor <= 0 ||
            factor > MAX_AI_COST_FACTOR
        ) {
            if (factor !== 1) {
                console.warn(
                    `[metering] ignoring AI cost factor ${event.factor} for ${key}`,
                );
            }
            return 1;
        }
        return factor;
    } catch (e) {
        console.warn(
            `[metering] AI cost factor lookup failed for ${key}: ${(e as Error).message}`,
        );
        return 1;
    }
};

const scaleCost = (cost: number, factor: number): number =>
    Math.round(cost * factor);

/** One facade per service + driver, so call sites can ask for theirs freely. */
const facades = new WeakMap<MeteringService, Map<string, AiMeteringService>>();
/** Every facade handed out, so one is never scoped a second time. */
const scopedViews = new WeakSet<MeteringService>();

/**
 * A view of `metering` whose recorded AI costs pass through the
 * `ai.cost.factor.<driver>.<model>` hook. Everything else is the service
 * itself, untouched.
 */
export function withAiCostFactor(
    metering: MeteringService,
    events: EventClient,
    driver: string,
): AiMeteringService {
    // Already scoped — re-scoping would multiply twice.
    if (scopedViews.has(metering)) return metering as AiMeteringService;
    const forService = facades.get(metering) ?? new Map();
    facades.set(metering, forService);
    const existing = forService.get(driver);
    if (existing) return existing;
    /** Whether a hook prices this model. Synchronous. */
    const hooked = (usage: UsageInput): boolean =>
        !!usage?.usageType &&
        Number.isFinite(usage.costOverride) &&
        hasAiCostFactor(events, driver, aiModelKey(usage.usageType));

    /** Factors for one recorded batch, resolved once per model. */
    const scaleUsages = async (
        actor: Actor,
        usages: UsageInput[],
    ): Promise<UsageInput[]> => {
        const byModel = new Map<string, number>();
        const scaled: UsageInput[] = [];
        for (const usage of usages) {
            if (!hooked(usage)) {
                scaled.push(usage);
                continue;
            }
            const model = aiModelKey(usage.usageType);
            let factor = byModel.get(model);
            if (factor === undefined) {
                factor = await resolveAiCostFactor(
                    events,
                    actor,
                    driver,
                    model,
                );
                byModel.set(model, factor);
            }
            scaled.push(
                factor === 1
                    ? usage
                    : {
                          ...usage,
                          costOverride: scaleCost(
                              usage.costOverride as number,
                              factor,
                          ),
                      },
            );
        }
        return scaled;
    };

    // Unhooked calls pass straight through, unawaited: callers fire metering
    // off, and an await here would outlive the request.

    const incrementUsage = (
        actor: Actor,
        usageType: string,
        usageAmount: number,
        costOverride?: number,
    ): Promise<UsageByType> => {
        const usage = { usageType, usageAmount, costOverride };
        if (!hooked(usage))
            return metering.incrementUsage(
                actor,
                usageType,
                usageAmount,
                costOverride,
            );
        return scaleUsages(actor, [usage]).then(([scaled]) =>
            metering.incrementUsage(
                actor,
                usageType,
                usageAmount,
                scaled?.costOverride,
            ),
        );
    };

    const batchIncrementUsages = (
        actor: Actor,
        usages: UsageInput[],
    ): Promise<UsageByType> => {
        if (!usages?.some(hooked))
            return metering.batchIncrementUsages(actor, usages);
        return scaleUsages(actor, usages).then((scaled) =>
            metering.batchIncrementUsages(actor, scaled),
        );
    };

    const utilRecordUsageObject = <T extends Record<string, number>>(
        trackedUsageObject: T,
        actor: Actor,
        modelPrefix: string,
        costsOverrides?: Partial<Record<keyof T, number>>,
    ): Promise<UsageByType> => {
        // The prefix is the model here, so one lookup covers every entry.
        if (!costsOverrides || !hasAiCostFactor(events, driver, modelPrefix))
            return metering.utilRecordUsageObject(
                trackedUsageObject,
                actor,
                modelPrefix,
                costsOverrides,
            );
        const scaleOverrides = (factor: number) =>
            factor === 1
                ? costsOverrides
                : (Object.fromEntries(
                      Object.entries(costsOverrides).map(([key, cost]) => [
                          key,
                          Number.isFinite(cost)
                              ? scaleCost(cost as number, factor)
                              : cost,
                      ]),
                  ) as Partial<Record<keyof T, number>>);

        return resolveAiCostFactor(events, actor, driver, modelPrefix).then(
            (factor) =>
                metering.utilRecordUsageObject(
                    trackedUsageObject,
                    actor,
                    modelPrefix,
                    scaleOverrides(factor),
                ),
        );
    };

    const costFactor = (actor: Actor, model: string): Promise<number> =>
        resolveAiCostFactor(events, actor, driver, model);

    const reserveAiCredits = async (
        actor: Actor,
        usageType: string,
        amount: number,
    ): Promise<CreditHold | null> => {
        const factor = Number.isFinite(amount)
            ? await costFactor(actor, aiModelKey(usageType))
            : 1;
        const cost = factor === 1 ? amount : scaleCost(amount, factor);
        if (!(await metering.hasEnoughCredits(actor, cost))) return null;
        return metering.reserveCredits(actor, cost);
    };

    const overrides: Record<string, unknown> = {
        incrementUsage,
        batchIncrementUsages,
        utilRecordUsageObject,
        costFactor,
        reserveAiCredits,
    };

    // A proxy, not a wrapper: providers use far more of the service than the
    // methods that price.
    const facade = new Proxy(metering, {
        get(target, prop) {
            if (prop in overrides) return overrides[prop as string];
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as AiMeteringService;
    scopedViews.add(facade);
    forService.set(driver, facade);
    return facade;
}
