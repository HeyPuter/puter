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

import type { Actor } from '../../core/actor';
import type { MeteringService } from './MeteringService.js';
import type { UsageByType, UsageInput } from './types';

/** Anything past this is read as a mistake and the cost is left as-is. */
export const MAX_AI_COST_FACTOR = 10;

/**
 * The `<provider>:<model>` head of a usage type — usage types are written
 * `<provider>:<model>:<what>`, e.g. `xai:stt:second`.
 */
export const aiModelKey = (usageType: string): string =>
    usageType.split(':').slice(0, 2).join(':');

const scaleCost = (cost: number, factor: number): number =>
    Math.round(cost * factor);

/** One facade per service + driver, so call sites can ask for theirs freely. */
const facades = new WeakMap<MeteringService, Map<string, MeteringService>>();

/**
 * A view of `metering` whose recorded AI costs pass through the
 * `ai.cost.factor.<driver>.<model>` hook. Everything else is the service
 * itself, untouched.
 */
export function withAiCostFactor(
    metering: MeteringService,
    driver: string,
): MeteringService {
    const forService = facades.get(metering) ?? new Map();
    facades.set(metering, forService);
    const existing = forService.get(driver);
    if (existing) return existing;
    /** Whether a hook prices this model. Synchronous. */
    const hooked = (usage: UsageInput): boolean =>
        !!usage?.usageType &&
        Number.isFinite(usage.costOverride) &&
        metering.hasAiCostFactor(driver, aiModelKey(usage.usageType));

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
                factor = await metering.resolveAiCostFactor(
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
        if (!costsOverrides || !metering.hasAiCostFactor(driver, modelPrefix))
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

        return metering
            .resolveAiCostFactor(actor, driver, modelPrefix)
            .then((factor) =>
                metering.utilRecordUsageObject(
                    trackedUsageObject,
                    actor,
                    modelPrefix,
                    scaleOverrides(factor),
                ),
            );
    };

    const overrides: Record<string, unknown> = {
        incrementUsage,
        batchIncrementUsages,
        utilRecordUsageObject,
    };

    // A proxy, not a wrapper: providers use far more of the service than the
    // three recording methods.
    const facade = new Proxy(metering, {
        get(target, prop, receiver) {
            if (prop in overrides) return overrides[prop as string];
            // Already scoped — re-scoping would multiply twice.
            if (prop === 'withAiCostFactor') return () => receiver;
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    forService.set(driver, facade);
    return facade;
}
