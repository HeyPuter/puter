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

import type { ModelCost, ModelPricingOverride } from '../../types.js';
import { catalogPrice } from '../../utils/pricing.js';

const PRICE_KEYS = new Set([
    'prompt',
    'completion',
    'request',
    'image',
    'audio',
    'web_search',
    'internal_reasoning',
    'input_cache_read',
    'input_cache_write',
    'input_cache_write_1h',
    'input_audio_cache',
]);
const CONDITION_KEYS = new Set([
    'min_prompt_tokens',
    'utc_start',
    'utc_end',
    'utc_days',
]);
const WEEKDAYS = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
];

const clockTime = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2359 &&
    value % 100 < 60;

const rates = (pricing: Record<string, unknown>): ModelCost =>
    Object.fromEntries(
        Object.entries(pricing).flatMap(([key, value]) => {
            const price = catalogPrice(value, 100_000_000);
            return PRICE_KEYS.has(key) && price !== undefined
                ? [[key, Number(price.toPrecision(15))]]
                : [];
        }),
    );

export const mapOpenRouterPricing = (
    pricing: Record<string, unknown>,
): {
    costs: ModelCost;
    overrides: ModelPricingOverride[];
} => {
    const overrides: ModelPricingOverride[] = [];
    for (const raw of Array.isArray(pricing.overrides)
        ? pricing.overrides
        : []) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        if (
            Object.keys(raw).some(
                (key) => !PRICE_KEYS.has(key) && !CONDITION_KEYS.has(key),
            )
        )
            continue;
        if (
            raw.min_prompt_tokens !== undefined &&
            (typeof raw.min_prompt_tokens !== 'number' ||
                !Number.isSafeInteger(raw.min_prompt_tokens) ||
                raw.min_prompt_tokens < 0)
        )
            continue;
        const hasWindow =
            raw.utc_start !== undefined || raw.utc_end !== undefined;
        if (hasWindow && (!clockTime(raw.utc_start) || !clockTime(raw.utc_end)))
            continue;
        if (
            raw.utc_days !== undefined &&
            (!Array.isArray(raw.utc_days) ||
                !raw.utc_days.length ||
                raw.utc_days.some(
                    (day: unknown) =>
                        typeof day !== 'string' || !WEEKDAYS.includes(day),
                ))
        )
            continue;
        if (!Object.keys(raw).some((key) => CONDITION_KEYS.has(key))) continue;
        if (
            Object.entries(raw).some(
                ([key, value]) =>
                    PRICE_KEYS.has(key) &&
                    catalogPrice(value, 100_000_000) === undefined,
            )
        ) {
            throw new Error('Invalid OpenRouter conditional price');
        }
        overrides.push({
            minPromptTokens: raw.min_prompt_tokens,
            utcStart: raw.utc_start,
            utcEnd: raw.utc_end,
            utcDays: raw.utc_days?.map((day: string) => WEEKDAYS.indexOf(day)),
            costs: rates(raw),
        });
    }
    return { costs: rates(pricing), overrides };
};
