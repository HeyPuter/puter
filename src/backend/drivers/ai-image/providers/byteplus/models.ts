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

import type { IImageModel } from '../../types.js';

// Ark's `size` "method 1" tiers and the pixel dimensions each (tier, aspect
// ratio) pair resolves to, from the image generation API reference:
// https://docs.byteplus.com/en/docs/ModelArk/1541523
// The table is identical for dola-seedream-5-0-pro, seedream-5-0-lite,
// seedream-4-5 and seedream-4-0.
export const SEEDREAM_RESOLUTION_MAP: Record<
    string,
    Record<string, { w: number; h: number }>
> = {
    '1:1': {
        '1k': { w: 1024, h: 1024 },
        '1.5k': { w: 1536, h: 1536 },
        '2k': { w: 2048, h: 2048 },
    },
    '4:3': {
        '1k': { w: 1152, h: 864 },
        '1.5k': { w: 1792, h: 1344 },
        '2k': { w: 2368, h: 1776 },
    },
    '3:4': {
        '1k': { w: 864, h: 1152 },
        '1.5k': { w: 1344, h: 1792 },
        '2k': { w: 1776, h: 2368 },
    },
    '16:9': {
        '1k': { w: 1424, h: 800 },
        '1.5k': { w: 2048, h: 1152 },
        '2k': { w: 2816, h: 1584 },
    },
    '9:16': {
        '1k': { w: 800, h: 1424 },
        '1.5k': { w: 1152, h: 2048 },
        '2k': { w: 1584, h: 2816 },
    },
    '3:2': {
        '1k': { w: 1248, h: 832 },
        '1.5k': { w: 1872, h: 1248 },
        '2k': { w: 2496, h: 1664 },
    },
    '2:3': {
        '1k': { w: 832, h: 1248 },
        '1.5k': { w: 1248, h: 1872 },
        '2k': { w: 1664, h: 2496 },
    },
    '21:9': {
        '1k': { w: 1568, h: 672 },
        '1.5k': { w: 2352, h: 1008 },
        '2k': { w: 3136, h: 1344 },
    },
};

const SEEDREAM_QUALITY_LEVELS = ['1k', '1.5k', '2k'];

// seedream-4-5 and the 5.0 series enforce a minimum output of 3,686,400
// pixels, which every 1K and 1.5K entry in the table above falls under —
// they only accept the 2K tier.
const SEEDREAM_2K_ONLY = ['2k'];

// Costs are in usd-cents per image, hardcoded from
// https://docs.byteplus.com/en/docs/ModelArk/1544106 (pricing) and
// https://docs.byteplus.com/en/docs/ModelArk/1330310 (catalog).
//
// dola-seedream-5-0-pro bills by output pixel count — ≤ 2.61MP ("1.5K or
// lower") vs above — plus a per-input-image rate from the second reference
// image onward (the first is free). Every other model is a flat per-image
// rate with free image input.
export const BYTEPLUS_IMAGE_GENERATION_MODELS: IImageModel[] = [
    {
        puterId: 'byteplus:byteplus/dola-seedream-5-0-pro-260628',
        id: 'dola-seedream-5-0-pro-260628',
        aliases: [
            'byteplus/dola-seedream-5-0-pro-260628',
            'dola-seedream-5-0-pro',
            'byteplus/dola-seedream-5-0-pro',
            'seedream-5-0-pro',
        ],
        name: 'Dola Seedream 5.0 Pro',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-tier',
        index_cost_key: 'output:1k',
        costs: {
            'output:1k': 4.5, // $0.045 per image ≤ 2.61MP
            'output:1.5k': 4.5, // same price as 1K, better quality
            'output:2k': 9, // $0.09 per image > 2.61MP
            input_image: 0.3, // $0.003 per input image from the 2nd on
        },
        allowedQualityLevels: SEEDREAM_QUALITY_LEVELS,
        resolution_map: SEEDREAM_RESOLUTION_MAP,
    },
    {
        // The catalog lists `seedream-5-0-260128` as the same service
        // ("also supports: seedream-5-0-lite-260128"); billing is published
        // under the -lite id, so that's the primary id here.
        puterId: 'byteplus:byteplus/seedream-5-0-lite-260128',
        id: 'seedream-5-0-lite-260128',
        aliases: [
            'byteplus/seedream-5-0-lite-260128',
            'seedream-5-0-lite',
            'byteplus/seedream-5-0-lite',
            'seedream-5-0-260128',
            'seedream-5-0',
        ],
        name: 'Seedream 5.0 Lite',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-image',
        index_cost_key: 'per-image',
        costs: { 'per-image': 3.5 },
        allowedQualityLevels: SEEDREAM_2K_ONLY,
        resolution_map: SEEDREAM_RESOLUTION_MAP,
    },
    {
        puterId: 'byteplus:byteplus/seedream-4-5-251128',
        id: 'seedream-4-5-251128',
        aliases: [
            'byteplus/seedream-4-5-251128',
            'seedream-4-5',
            'byteplus/seedream-4-5',
        ],
        name: 'Seedream 4.5',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-image',
        index_cost_key: 'per-image',
        costs: { 'per-image': 4 },
        allowedQualityLevels: SEEDREAM_2K_ONLY,
        resolution_map: SEEDREAM_RESOLUTION_MAP,
    },
    {
        puterId: 'byteplus:byteplus/seedream-4-0-250828',
        id: 'seedream-4-0-250828',
        aliases: [
            'byteplus/seedream-4-0-250828',
            'seedream-4-0',
            'byteplus/seedream-4-0',
        ],
        name: 'Seedream 4.0',
        costs_currency: 'usd-cents',
        pricing_unit: 'per-image',
        index_cost_key: 'per-image',
        costs: { 'per-image': 3 },
        allowedQualityLevels: SEEDREAM_QUALITY_LEVELS,
        resolution_map: SEEDREAM_RESOLUTION_MAP,
    },
];
