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

export type DeepSeekModelId = 'deepseek-flash' | 'deepseek-v4-pro';
type Period = 'offPeak' | 'peak';
type TokenRates = { prompt: number; completion: number; cached: number };
type PriceSchedule = Record<DeepSeekModelId, Record<Period, TokenRates>>;

const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing/';
const REFRESH_MS = 60 * 60 * 1000;

// Last verified official rates, in USD per million tokens. Used until a valid
// refresh succeeds; the page remains the source of subsequent changes.
const FALLBACK_RATES: PriceSchedule = {
    'deepseek-flash': {
        offPeak: { prompt: 0.15, completion: 0.6, cached: 0.003 },
        peak: { prompt: 0.3, completion: 1.2, cached: 0.006 },
    },
    'deepseek-v4-pro': {
        offPeak: { prompt: 0.66, completion: 1.98, cached: 0.022 },
        peak: { prompt: 1.32, completion: 3.96, cached: 0.044 },
    },
};

// State Council's 2026 public holiday arrangement:
// https://en.bjhd.gov.cn/workinginhaidian/supportingservices/publicholidays/202512/t20251211_4797062.shtml
const HOLIDAYS_2026 = [
    ['2026-01-01', '2026-01-03'],
    ['2026-02-15', '2026-02-23'],
    ['2026-04-04', '2026-04-06'],
    ['2026-05-01', '2026-05-05'],
    ['2026-06-19', '2026-06-21'],
    ['2026-09-25', '2026-09-27'],
    ['2026-10-01', '2026-10-07'],
];

const isChinesePublicHoliday = (date: Date): boolean => {
    const day = date.toISOString().slice(0, 10);
    return HOLIDAYS_2026.some(([start, end]) => day >= start && day <= end);
};

export const isDeepSeekPeak = (date: Date): boolean => {
    // An unpublished year's holiday calendar must not cause peak overbilling.
    if (date.getUTCFullYear() !== 2026) return false;
    const weekday = date.getUTCDay();
    const hour = date.getUTCHours();
    return (
        weekday >= 1 &&
        weekday <= 5 &&
        !isChinesePublicHoliday(date) &&
        ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
    );
};

const plainText = (html: string): string =>
    html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const readDollars = (cell: string): number => {
    if (!/^\$\d+(?:\.\d+)?$/.test(cell))
        throw new Error('Invalid DeepSeek price');
    const value = Number(cell.slice(1));
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
        throw new Error('DeepSeek price outside expected range');
    }
    return value;
};

export const parseDeepSeekPrices = (html: string): PriceSchedule => {
    if (
        !plainText(html).includes(
            'Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.',
        )
    ) {
        throw new Error('DeepSeek peak schedule changed');
    }
    const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
        .map(([match]) => match)
        .find(
            (value) =>
                value.includes('deepseek-flash') && value.includes('PRICING'),
        );
    if (!table) throw new Error('DeepSeek pricing table missing');

    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
        ([, row]) =>
            [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) =>
                plainText(cell),
            ),
    );
    if (
        rows[0]?.at(-2) !== 'deepseek-flash (1)' ||
        rows[0]?.at(-1) !== 'deepseek-v4-pro'
    ) {
        throw new Error('DeepSeek model columns changed');
    }

    const rates = structuredClone(FALLBACK_RATES);
    const seen = new Set<string>();
    let category: keyof TokenRates | undefined;
    let pricingStarted = false;
    for (const cells of rows) {
        if (cells.some((cell) => cell.startsWith('PRICING')))
            pricingStarted = true;
        if (!pricingStarted) continue;
        const label = cells.join(' ');
        if (label.includes('CACHE HIT')) category = 'cached';
        else if (label.includes('CACHE MISS')) category = 'prompt';
        else if (label.includes('OUTPUT TOKENS')) category = 'completion';
        const periodCell = cells.at(-3);
        if (periodCell !== 'PEAK' && periodCell !== 'OFF-PEAK') continue;
        if (!category) throw new Error('DeepSeek price category missing');
        const period = periodCell === 'PEAK' ? 'peak' : 'offPeak';
        const key = `${period}:${category}`;
        if (seen.has(key)) throw new Error('Duplicate DeepSeek price');
        rates['deepseek-flash'][period][category] = readDollars(cells.at(-2)!);
        rates['deepseek-v4-pro'][period][category] = readDollars(cells.at(-1)!);
        seen.add(key);
    }
    if (seen.size !== 6) throw new Error('Incomplete DeepSeek prices');
    for (const model of Object.values(rates)) {
        for (const category of ['prompt', 'completion', 'cached'] as const) {
            if (model.peak[category] < model.offPeak[category]) {
                throw new Error('DeepSeek peak price below off-peak price');
            }
        }
        if (model.offPeak.cached > model.offPeak.prompt) {
            throw new Error('DeepSeek cache price above input price');
        }
    }
    return rates;
};

export class DeepSeekPricing {
    #rates: PriceSchedule = structuredClone(FALLBACK_RATES);
    #refreshPromise?: Promise<void>;
    #lastAttempt = 0;
    #timer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly fetchPage: typeof fetch = fetch,
        public onRefreshError: (error: unknown) => void = (error) =>
            console.warn('[deepseek] pricing refresh failed', error),
    ) {}

    costs(modelId: DeepSeekModelId, date = new Date()): TokenRates {
        const period = isDeepSeekPeak(date) ? 'peak' : 'offPeak';
        const rates = this.#rates[modelId][period];
        return {
            prompt: rates.prompt * 100,
            completion: rates.completion * 100,
            cached: rates.cached * 100,
        };
    }

    async refresh(): Promise<void> {
        if (this.#refreshPromise) return this.#refreshPromise;
        this.#lastAttempt = Date.now();
        this.#refreshPromise = (async () => {
            const response = await this.fetchPage(PRICING_URL, {
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok)
                throw new Error(`DeepSeek pricing HTTP ${response.status}`);
            this.#rates = parseDeepSeekPrices(await response.text());
        })();
        try {
            await this.#refreshPromise;
        } finally {
            this.#refreshPromise = undefined;
        }
    }

    async refreshIfStale(): Promise<void> {
        if (
            !this.#refreshPromise &&
            Date.now() - this.#lastAttempt < REFRESH_MS
        )
            return;
        try {
            await this.refresh();
        } catch (error) {
            try {
                this.onRefreshError(error);
            } catch {
                console.warn('[deepseek] pricing refresh failed', error);
            }
        }
    }

    start(): void {
        if (this.#timer) return;
        void this.refreshIfStale();
        this.#timer = setInterval(() => void this.refreshIfStale(), REFRESH_MS);
        this.#timer.unref();
    }
}

export const deepSeekPricing = new DeepSeekPricing();
