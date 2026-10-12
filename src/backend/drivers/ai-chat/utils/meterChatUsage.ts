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
    /** Per-key µ¢ costs that win over the model's rates. */
    costOverrides?: Record<string, number>;
}

/**
 * Records one completion's usage under `meteringKey` and returns the usage to
 * report along with the µ¢ each key was recorded at, so the driver can quote
 * the same cost the ledger holds.
 */
export const meterChatUsage = (
    metering: Pick<MeteringService, 'utilRecordUsageObject'>,
    actor: Actor | undefined,
    meteringKey: string,
    model: IChatModel,
    usage: Record<string, number>,
    { authoritativeUsd, costOverrides }: MeterChatUsageOptions = {},
): { usage: Record<string, number>; costs: Record<string, number> } => {
    if (authoritativeUsd !== undefined) {
        const billed = { ...usage, billedUsage: 1 };
        const costs: Record<string, number> = Object.fromEntries(
            Object.keys(billed).map((key) => [key, 0]),
        );
        costs.billedUsage = authoritativeUsd * MICROCENTS_PER_USD;
        metering.utilRecordUsageObject(billed, actor!, meteringKey, costs);
        return {
            usage: { ...billed, usd_cents: authoritativeUsd * 100 },
            costs,
        };
    }
    const costs = { ...buildCostsOverride(usage, model), ...costOverrides };
    metering.utilRecordUsageObject(usage, actor!, meteringKey, costs);
    return { usage, costs };
};
