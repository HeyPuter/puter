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

import type { Actor } from '../../../core/actor.js';
import type { MeteringService } from '../../../services/metering/MeteringService.js';
import type { IChatModel } from '../types.js';
import { buildCostsOverride } from './pricing.js';

/** Microcents per US dollar. */
const MICROCENTS_PER_USD = 100_000_000;

export interface MeterChatUsageOptions {
    /**
     * What the upstream says it billed, in USD. Recorded as one `billedUsage`
     * line instead of pricing the tokens, which are still recorded at zero.
     */
    authoritativeUsd?: number;
    pricingTime?: Date;
    /** Per-key µ¢ costs that win over the model's rates. */
    costOverrides?: Record<string, number>;
}

/**
 * Splits `total` whole µ¢ across the keys in proportion to their weights,
 * summing exactly to `total`. Null when nothing carries weight.
 */
const apportion = (
    total: number,
    weights: Record<string, number>,
): Record<string, number> | null => {
    const weighted = Object.entries(weights).filter(([, w]) => w > 0);
    const sum = weighted.reduce((acc, [, w]) => acc + w, 0);
    if (!(sum > 0)) return null;
    const exact = weighted.map(([key, w]) => [key, (total * w) / sum] as const);
    const shares: Record<string, number> = Object.fromEntries(
        exact.map(([key, share]) => [key, Math.floor(share)]),
    );
    let left = total - Object.values(shares).reduce((a, b) => a + b, 0);
    // Largest remainder: the µ¢ lost to flooring go to the keys that lost most.
    for (const [key] of [...exact].sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
        if (left <= 0) break;
        shares[key] += 1;
        left -= 1;
    }
    return shares;
};

/**
 * Records one completion's usage under `meteringKey` and returns the usage to
 * report along with the µ¢ each key costs, so the driver quotes the same total
 * the ledger holds. An authoritative bill is recorded as one `billedUsage` line
 * and reported spread over the usage keys at the model's relative rates.
 */
export const meterChatUsage = (
    metering: Pick<MeteringService, 'utilRecordUsageObject'>,
    actor: Actor | undefined,
    meteringKey: string,
    model: IChatModel,
    usage: Record<string, number>,
    {
        authoritativeUsd,
        costOverrides,
        pricingTime,
    }: MeterChatUsageOptions = {},
): { usage: Record<string, number>; costs: Record<string, number> } => {
    const priced = {
        ...buildCostsOverride(usage, model, pricingTime),
        ...costOverrides,
    };
    if (authoritativeUsd !== undefined) {
        const billed = { ...usage, billedUsage: 1 };
        const recorded: Record<string, number> = Object.fromEntries(
            Object.keys(billed).map((key) => [key, 0]),
        );
        recorded.billedUsage = authoritativeUsd * MICROCENTS_PER_USD;
        metering.utilRecordUsageObject(billed, actor!, meteringKey, recorded);
        const split =
            recorded.billedUsage > 0
                ? apportion(Math.round(recorded.billedUsage), priced)
                : null;
        return {
            usage: { ...billed, usd_cents: authoritativeUsd * 100 },
            costs: split ? { ...recorded, ...split, billedUsage: 0 } : recorded,
        };
    }
    metering.utilRecordUsageObject(usage, actor!, meteringKey, priced);
    return { usage, costs: priced };
};
