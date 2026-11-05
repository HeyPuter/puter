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

import axios from 'axios';
import { catalogPrice } from '../../../ai-chat/utils/pricing.js';
import { XAI_IMAGE_GENERATION_MODELS, type XaiImageModel } from './models.js';

/** `pricing[].price_per_image` is documented in 1/100,000,000ths of a USD cent. */
const PRICE_UNITS_PER_CENT = 100_000_000;
const QUALITIES = new Set(['low', 'medium', 'high']);
const RESOLUTIONS = new Set(['1k', '1.5k', '2k']);
const TIERED_COST_KEY = /^output:([^:]+):([^:]+)$/;

/**
 * The model's (resolution, quality) tiers repriced from xAI's `pricing` matrix,
 * or undefined when the matrix is absent, malformed, conflicting, or misses a
 * tier we bill. `image_price` is never read: its documented unit disagrees with
 * the live values.
 */
export const priceXaiImageModel = (
    model: XaiImageModel,
    pricing: unknown,
): XaiImageModel | undefined => {
    if (!Array.isArray(pricing)) return undefined;
    const tiers = new Map<string, number>();
    for (const tier of pricing) {
        if (!tier || typeof tier !== 'object') return undefined;
        const { quality, resolution, price_per_image: raw } = tier;
        if (!QUALITIES.has(quality) || !RESOLUTIONS.has(resolution))
            return undefined;
        const cents = Number.isSafeInteger(raw)
            ? catalogPrice(raw / PRICE_UNITS_PER_CENT)
            : undefined;
        if (cents === undefined) return undefined;
        const key = `output:${resolution}:${quality}`;
        if (tiers.has(key) && tiers.get(key) !== cents) return undefined;
        tiers.set(key, cents);
    }
    const costs = { ...model.costs };
    let repriced = false;
    for (const key of Object.keys(costs)) {
        if (!TIERED_COST_KEY.test(key)) continue;
        const cents = tiers.get(key);
        if (cents === undefined) return undefined;
        costs[key] = cents;
        repriced = true;
    }
    return repriced ? { ...model, costs } : undefined;
};

/**
 * Reprices the curated models from `GET /v1/image-generation-models`. A model
 * the response omits or prices unusably keeps its previous entry; a response
 * that isn't a non-empty model list throws so the last good catalog stays.
 */
export const fetchXaiImageCatalog = async (
    apiKey: string,
    signal: AbortSignal,
    previous: XaiImageModel[] = XAI_IMAGE_GENERATION_MODELS,
): Promise<XaiImageModel[]> => {
    const response = await axios.get(
        'https://api.x.ai/v1/image-generation-models',
        {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
            maxContentLength: 1024 * 1024,
        },
    );
    const entries: unknown = response.data?.models;
    if (!Array.isArray(entries) || entries.length === 0)
        throw new Error('Invalid xAI image model list');
    const byId = new Map<string, unknown[]>();
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const { id, pricing } = entry as { id?: unknown; pricing?: unknown };
        if (typeof id !== 'string') continue;
        byId.set(id, [...(byId.get(id) ?? []), pricing]);
    }
    return previous.map((model) => {
        // Duplicate records for one id are ambiguous; keep what we had.
        const records = byId.get(model.id);
        if (records?.length !== 1) return model;
        return priceXaiImageModel(model, records[0]) ?? model;
    });
};
