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

import type { IChatModel, ModelCost } from '../types.js';

const CENTS_PER_USD = 100;
const MTOK = 1_000_000;

/**
 * Builds a `costs` block (currency `usd-cents`, per million tokens) from
 * per-million-token USD prices. Providers list pricing in USD/MTok, so this
 * keeps the source numbers readable while emitting the cents-based shape the
 * driver expects.
 */
export const usdPerMToken = (
    inputUsd: number,
    outputUsd: number,
    cachedReadUsd = 0,
): ModelCost => ({
    tokens: MTOK,
    prompt_tokens: inputUsd * CENTS_PER_USD,
    completion_tokens: outputUsd * CENTS_PER_USD,
    cached_tokens: cachedReadUsd * CENTS_PER_USD,
});

const isRate = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * The usage keys a model's input and output are priced under. Most models use
 * the defaults; a model whose provider reports usage under other names carries
 * them in `input_cost_key`/`output_cost_key`.
 */
export const costKeys = (
    model: IChatModel,
): { inputKey: string; outputKey: string } => ({
    inputKey: (model.input_cost_key as string | undefined) ?? 'input_tokens',
    outputKey: (model.output_cost_key as string | undefined) ?? 'output_tokens',
});

/**
 * Whether a usage key is priced at the output rate when the model has no rate
 * of its own for it.
 */
export const isOutputCostKey = (key: string, outputKey: string): boolean =>
    key === outputKey ||
    key === 'output_tokens' ||
    key === 'completion_tokens' ||
    key === 'thinking_tokens';

/**
 * The rate multipliers a request pays given how many input tokens it sent —
 * cached reads and cache writes included. `1`/`1` unless the model has
 * long-context pricing and the request is past its threshold.
 */
export const longContextMultipliers = (
    model: IChatModel,
    inputTokens: number,
): { input: number; output: number } => {
    const pricing = model.long_context_pricing;
    if (!pricing || !(inputTokens > pricing.threshold)) {
        return { input: 1, output: 1 };
    }
    return {
        input: pricing.input_multiplier,
        output: pricing.output_multiplier,
    };
};

/**
 * The input tokens a tracked-usage object carries: every key that isn't
 * output-side. Providers split one prompt into uncached, cached-read and
 * cache-write keys; the long-context threshold is measured on their sum.
 */
export const trackedInputTokens = (
    trackedUsage: Record<string, unknown>,
    model: IChatModel,
): number => {
    const { outputKey } = costKeys(model);
    let total = 0;
    for (const [key, amount] of Object.entries(trackedUsage)) {
        if (key === 'tokens' || key === 'usd_cents') continue;
        if (isOutputCostKey(key, outputKey)) continue;
        if (typeof amount === 'number' && Number.isFinite(amount)) {
            total += amount;
        }
    }
    return total;
};

/**
 * Whether a model costs the user nothing to run.
 *
 * Every rate in the cost table has to be zero — a model priced on one axis and
 * free on another is a paid model. `tokens` is skipped: it's the scale the
 * other numbers are expressed in, not a rate. A model with no cost table at all
 * is _unknown_, not free, so it doesn't qualify.
 */
export const isFreeModel = (model: IChatModel): boolean => {
    const rates = Object.entries(model.costs ?? {}).filter(
        ([key]) => key !== 'tokens',
    );
    return rates.length > 0 && rates.every(([, rate]) => Number(rate) === 0);
};

/**
 * Prices a tracked-usage object against a model's cost table.
 *
 * A usage key the model doesn't price falls back to the model's output rate
 * when it is output-denominated and its input rate otherwise — never to zero.
 * Pricing an unpriced key at zero gives the unit away, and a provider that
 * subtracts cached tokens out of the prompt count has already removed them from
 * the key that would otherwise have caught them. The fallback mirrors the rate
 * resolution behind the reported `usd_cents`, so the ledger and the figure
 * quoted to the caller agree.
 */
export const buildCostsOverride = (
    trackedUsage: Record<string, number>,
    model: IChatModel,
): Record<string, number> => {
    const { inputKey, outputKey } = costKeys(model);

    const costs = model.costs ?? {};
    const inputRate = isRate(costs[inputKey]) ? costs[inputKey] : undefined;
    const outputRate = isRate(costs[outputKey]) ? costs[outputKey] : undefined;

    const multipliers = longContextMultipliers(
        model,
        trackedInputTokens(trackedUsage, model),
    );

    const overrides: Record<string, number> = {};
    for (const [key, amount] of Object.entries(trackedUsage)) {
        // `tokens` is a scale descriptor ("costs expressed per N tokens"),
        // not a per-unit rate.
        if (key === 'tokens') continue;

        const isOutput = isOutputCostKey(key, outputKey);
        const rate = isRate(costs[key])
            ? costs[key]
            : ((isOutput ? outputRate : inputRate) ?? 0);

        overrides[key] =
            amount * rate * (isOutput ? multipliers.output : multipliers.input);
    }

    return overrides;
};
