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

import { catalogPrice } from '../../../ai-chat/utils/pricing.js';
import {
    CLOUDFLARE_IMAGE_GENERATION_MODELS,
    type CloudflareBillingScheme,
    type CloudflareImageModel,
} from './models.js';

const PER_PAGE = 100;
const MAX_PAGES = 10;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

/** Cloudflare's published `price` units and the cost keys they bill. */
const PRICE_UNIT_KEYS: Record<string, string> = {
    'per step': 'step',
    'per 512 by 512 tile': 'tile_512',
};

/** Schemes whose every cost key Cloudflare publishes; others stay curated. */
const REMOTE_PRICED_SCHEMES: Partial<
    Record<CloudflareBillingScheme, readonly string[]>
> = {
    'step-only': ['step'],
    'tile-plus-step': ['tile_512', 'step'],
};

export interface CloudflareCatalogConfig {
    apiToken: string;
    accountId: string;
    apiBaseUrl: string;
}

/**
 * Shifts the decimal exponent instead of multiplying, so 0.000132 is exactly
 * 13200.
 */
const usdToMicroCents = (usd: number) => {
    const [digits, exponent = '0'] = String(usd).split('e');
    return Number(`${digits}e${Number(exponent) + 8}`);
};

/**
 * The model with its cost keys repriced from a Cloudflare `price` property, or
 * undefined unless the property is USD, finite, non-negative, conflict-free,
 * and prices exactly the keys the model's billing scheme bills.
 */
export const priceCloudflareImageModel = (
    model: CloudflareImageModel,
    prices: unknown,
): CloudflareImageModel | undefined => {
    const keys = REMOTE_PRICED_SCHEMES[model.billingScheme];
    if (!keys || !Array.isArray(prices)) return undefined;
    const curatedKeys = Object.keys(model.costs);
    if (
        curatedKeys.length !== keys.length ||
        !keys.every((key) => curatedKeys.includes(key))
    )
        return undefined;
    const rates = new Map<string, number>();
    for (const entry of prices) {
        if (!entry || typeof entry !== 'object') return undefined;
        const { unit, price, currency } = entry as Record<string, unknown>;
        const key =
            typeof unit === 'string' ? PRICE_UNIT_KEYS[unit] : undefined;
        if (!key || !keys.includes(key) || currency !== 'USD') return undefined;
        const usd = typeof price === 'number' ? catalogPrice(price) : undefined;
        if (usd === undefined) return undefined;
        const microCents = usdToMicroCents(usd);
        if (!Number.isFinite(microCents)) return undefined;
        if (rates.has(key) && rates.get(key) !== microCents) return undefined;
        rates.set(key, microCents);
    }
    if (rates.size !== keys.length) return undefined;
    return {
        ...model,
        costs: { ...model.costs, ...Object.fromEntries(rates) },
    };
};

const readJson = async (response: Response): Promise<unknown> => {
    const tooLarge = () =>
        new Error('Cloudflare model search response is too large');
    if (Number(response.headers.get('content-length')) > MAX_PAGE_BYTES) {
        await response.body?.cancel();
        throw tooLarge();
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PAGE_BYTES) {
            await reader.cancel();
            throw tooLarge();
        }
        chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

/** `total_pages` when Cloudflare sends it; otherwise a short page is the last. */
const hasNextPage = (info: unknown, count: number, page: number) => {
    const { total_pages: totalPages, per_page: perPage } = (info ??
        {}) as Record<string, unknown>;
    if (Number.isSafeInteger(totalPages)) return page < (totalPages as number);
    const pageSize =
        Number.isSafeInteger(perPage) && (perPage as number) > 0
            ? (perPage as number)
            : PER_PAGE;
    return count >= pageSize;
};

/**
 * Reprices the curated models from `GET /accounts/{id}/ai/models/search`. A
 * model the response omits, leaves unpriced, lists twice, or prices unusably
 * keeps its previous entry; a failed or malformed page, or a listing longer
 * than MAX_PAGES, throws so the last good catalog stays.
 */
export const fetchCloudflareImageCatalog = async (
    { apiToken, accountId, apiBaseUrl }: CloudflareCatalogConfig,
    signal: AbortSignal,
    previous: CloudflareImageModel[] = CLOUDFLARE_IMAGE_GENERATION_MODELS,
): Promise<CloudflareImageModel[]> => {
    // Each listing of a model contributes the values of its `price` properties.
    const listings = new Map<string, unknown[][]>();
    let complete = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await fetch(
            `${apiBaseUrl}/accounts/${accountId}/ai/models/search?per_page=${PER_PAGE}&page=${page}`,
            { headers: { Authorization: `Bearer ${apiToken}` }, signal },
        );
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(
                `Cloudflare model search failed with status ${response.status}`,
            );
        }
        const payload = (await readJson(response)) as {
            success?: unknown;
            result?: unknown;
            result_info?: { page?: unknown };
        } | null;
        const result = payload?.result;
        const reportedPage = payload?.result_info?.page;
        if (
            payload?.success !== true ||
            !Array.isArray(result) ||
            (reportedPage !== undefined && reportedPage !== page)
        )
            throw new Error('Invalid Cloudflare model search response');
        for (const entry of result) {
            if (!entry || typeof entry !== 'object') continue;
            const { name, properties } = entry as {
                name?: unknown;
                properties?: unknown;
            };
            if (typeof name !== 'string') continue;
            const prices = (Array.isArray(properties) ? properties : [])
                .filter((property) => property?.property_id === 'price')
                .map((property) => property.value);
            listings.set(name, [...(listings.get(name) ?? []), prices]);
        }
        if (!hasNextPage(payload.result_info, result.length, page)) {
            complete = true;
            break;
        }
    }
    // Unread pages could hold a duplicate listing that should keep the
    // previous price, so a listing past the cap is not trusted.
    if (!complete)
        throw new Error(`Cloudflare model search exceeded ${MAX_PAGES} pages`);
    if (listings.size === 0)
        throw new Error('Empty Cloudflare model search response');
    return previous.map((model) => {
        const found = listings.get(model.id);
        if (found?.length !== 1 || found[0].length !== 1) return model;
        return priceCloudflareImageModel(model, found[0][0]) ?? model;
    });
};
