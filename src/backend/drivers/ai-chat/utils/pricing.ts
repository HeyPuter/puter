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

import type { IChatModel, ModelCost, UsageDetails } from '../types.js';

/**
 * Absent, negative and placeholder prices remain unpriced, including empty
 * strings.
 */
export const catalogPrice = (
    value: unknown,
    multiplier = 1,
): number | undefined => {
    if (typeof value !== 'number' && typeof value !== 'string')
        return undefined;
    if (
        typeof value === 'string' &&
        !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    )
        return undefined;
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) return undefined;
    const converted = price * multiplier;
    return Number.isFinite(converted) && !(price > 0 && converted === 0)
        ? converted
        : undefined;
};

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
 * Keys on a usage object that aren't usage: the cost table's scale and what the
 * request cost.
 */
const NOT_USAGE = new Set(['tokens', 'usd_cents', 'cost']);

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

/** Applies catalog conditions at the request instant; later matching rates win. */
export const costsForRequest = (
    model: IChatModel,
    inputTokens: number,
    now = new Date(),
): ModelCost => {
    const costs = { ...model.costs };
    const clock = now.getUTCHours() * 100 + now.getUTCMinutes();
    for (const override of model.pricingOverrides ?? []) {
        if (
            override.minPromptTokens !== undefined &&
            (override.minPromptTokensInclusive
                ? inputTokens < override.minPromptTokens
                : inputTokens <= override.minPromptTokens)
        )
            continue;
        if (override.utcDays && !override.utcDays.includes(now.getUTCDay()))
            continue;
        if (override.utcStart !== undefined && override.utcEnd !== undefined) {
            const inWindow =
                override.utcStart < override.utcEnd
                    ? clock >= override.utcStart && clock < override.utcEnd
                    : clock >= override.utcStart || clock < override.utcEnd;
            if (!inWindow) continue;
        }
        Object.assign(costs, override.costs);
    }
    return costs;
};

/**
 * Whether a usage key is priced at the output rate when the model has no rate
 * of its own for it.
 *
 * The `_output_tokens` suffix rule covers every prefixed output variant
 * (`fast_output_tokens`, `advisor_output_tokens`, …) without having to name
 * each one — a prefixed usage key always carries its own cost-table entry when
 * the model has one, so this only decides the fallback bucket.
 */
export const isOutputCostKey = (key: string, outputKey: string): boolean =>
    key === outputKey ||
    key === 'output_tokens' ||
    key === 'completion_tokens' ||
    key === 'thinking_tokens' ||
    key.endsWith('_output_tokens');

export const isPerCallCostKey = (key: string): boolean =>
    key === 'request' || key.endsWith('_requests') || key.endsWith('_calls');

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
        if (NOT_USAGE.has(key)) continue;
        // Per-call counts (`web_search_requests`, `web_search_calls`) and
        // advisor-iteration tokens are billed, but neither is part of the
        // executor prompt the funds cap and long-context threshold are
        // measured against.
        if (isPerCallCostKey(key) || key.startsWith('advisor_')) {
            continue;
        }
        if (isOutputCostKey(key, outputKey)) continue;
        if (typeof amount === 'number' && Number.isFinite(amount)) {
            total += amount;
        }
    }
    return total;
};

/**
 * The output tokens a tracked-usage object carries: every key billed at the
 * output rate, reasoning included — the same tokens a `max_tokens` cap counts.
 */
export const trackedOutputTokens = (
    trackedUsage: Record<string, unknown>,
    model: IChatModel,
): number => {
    const { outputKey } = costKeys(model);
    let total = 0;
    for (const [key, amount] of Object.entries(trackedUsage)) {
        if (isPerCallCostKey(key) || key.startsWith('advisor_')) {
            continue;
        }
        if (!isOutputCostKey(key, outputKey)) continue;
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
    const { inputKey, outputKey } = costKeys(model);
    if (
        catalogPrice(
            model.costs?.[inputKey] ?? model.costs?.['input-tokens'],
        ) === undefined ||
        catalogPrice(
            model.costs?.[outputKey] ?? model.costs?.['output-tokens'],
        ) === undefined
    )
        return false;
    return (
        rates.length > 0 &&
        rates.every(([, rate]) => catalogPrice(rate) === 0) &&
        (model.pricingOverrides ?? []).every((override) =>
            Object.values(override.costs).every((rate) => rate === 0),
        )
    );
};

/**
 * A fallback [[UsageDetails]] for providers that haven't been taught to report
 * their own (every non-Claude provider, for now). `inputTokens` and
 * `outputTokens` reuse the same tracked-token accounting the credit gate and
 * `usageCost` already agree on, so a provider with no detail of its own still
 * gets a usable breakdown.
 */
export const usageDetailsFromUsage = (
    usage: Record<string, unknown>,
    model: IChatModel,
): UsageDetails => ({
    inputTokens: trackedInputTokens(usage, model),
    outputTokens: trackedOutputTokens(usage, model),
});

/** A usage key/amount pair that carries a price, rather than a scale or a label. */
const isBillable = (key: string, amount: unknown): amount is number =>
    !NOT_USAGE.has(key) && isRate(amount);

/**
 * The µ¢ each usage key costs at the model's rates. A key the model doesn't
 * price falls back to the output rate when it is output-denominated and the
 * input rate otherwise; a key neither covers is left out.
 */
const priceUsage = (
    trackedUsage: Record<string, unknown>,
    model: IChatModel,
    now?: Date,
): Record<string, number> => {
    const { inputKey, outputKey } = costKeys(model);

    const costs = costsForRequest(
        model,
        trackedInputTokens(trackedUsage, model),
        now,
    );
    const inputRate = isRate(costs[inputKey]) ? costs[inputKey] : undefined;
    const outputRate = isRate(costs[outputKey]) ? costs[outputKey] : undefined;

    const multipliers = longContextMultipliers(
        model,
        trackedInputTokens(trackedUsage, model),
    );

    const priced: Record<string, number> = {};
    for (const [key, amount] of Object.entries(trackedUsage)) {
        if (!isBillable(key, amount)) continue;

        if (key === 'request' && !isRate(costs.request)) continue;
        const isOutput = isOutputCostKey(key, outputKey);
        const rate = isRate(costs[key])
            ? costs[key]
            : isOutput
              ? outputRate
              : inputRate;
        if (rate === undefined) continue;

        const multiplier = isPerCallCostKey(key)
            ? 1
            : isOutput
              ? multipliers.output
              : multipliers.input;
        priced[key] = amount * rate * multiplier;
    }
    return priced;
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
    now?: Date,
): Record<string, number> => {
    const priced = priceUsage(trackedUsage, model, now);
    const overrides: Record<string, number> = {};
    for (const key of Object.keys(trackedUsage)) {
        // `tokens` is a scale descriptor ("costs expressed per N tokens"),
        // not a per-unit rate.
        if (key === 'tokens') continue;
        if (priced[key] !== undefined) overrides[key] = priced[key];
        else if (trackedUsage[key] === 0) overrides[key] = 0;
    }
    return overrides;
};

/**
 * What a usage object costs in µ¢, split into its input and output sides.
 * `recordedCosts` are the per-key costs a provider already metered with and win
 * over the model's rates, so the figure matches the ledger. Null when nothing
 * in the usage could be priced.
 */
export const usageCost = (
    usage: Record<string, unknown>,
    model: IChatModel,
    recordedCosts?: Record<string, number>,
): { inputMicroCents: number; outputMicroCents: number } | null => {
    const { outputKey } = costKeys(model);
    const priced = priceUsage(usage, model);
    let input = 0;
    let output = 0;
    let sawAnyCost = false;
    for (const [key, amount] of Object.entries(usage)) {
        if (!isBillable(key, amount)) continue;
        const recorded = recordedCosts?.[key];
        // Advisor usage is priced at the advisor model's own rates, so only a
        // recorded cost can price it here.
        const cost = isRate(recorded)
            ? recorded
            : key.startsWith('advisor_')
              ? undefined
              : priced[key];
        if (cost === undefined) continue;
        sawAnyCost = true;
        if (isOutputCostKey(key, outputKey)) output += cost;
        else input += cost;
    }
    if (!sawAnyCost) return null;
    return {
        inputMicroCents: Math.max(0, Math.round(input)),
        outputMicroCents: Math.max(0, Math.round(output)),
    };
};
