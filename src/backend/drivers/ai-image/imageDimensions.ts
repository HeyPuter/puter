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

import { HttpError } from '../../core/http/HttpError.js';
import type {
    IGenerateParams,
    IImageModel,
    ImageDimensions,
    ImageSize,
} from './types.js';

// Decimal-only, so `'0x10'`, `'1e3'` and similar number-literal coercions
// don't sneak into what is meant to be a plain image dimension.
const DECIMAL_RE = /^\d+(\.\d+)?$/;

function dimension(value: unknown): number {
    const number =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && DECIMAL_RE.test(value.trim())
              ? Number(value)
              : NaN;
    if (
        !Number.isFinite(number) ||
        number <= 0 ||
        number > Number.MAX_SAFE_INTEGER
    ) {
        throw new HttpError(
            400,
            'Image dimensions must be positive, finite numbers',
            { legacyCode: 'bad_request' },
        );
    }
    return number;
}

/**
 * Null and blank strings mean "not set": form state and spread option objects
 * carry them, and JSON preserves them.
 */
function present<T>(value: T): value is NonNullable<T> {
    return value != null && (typeof value !== 'string' || value.trim() !== '');
}

export function isAspectRatio(ratio: ImageDimensions): boolean {
    return ratio.w > 0 && ratio.h > 0 && Math.max(ratio.w, ratio.h) <= 32;
}

/** Preserve dimension-source information before adapting to a model's sizes. */
export function resolveImageSize(
    params: IGenerateParams,
    model?: Pick<IImageModel, 'pixelSizeThreshold'>,
): ImageSize | undefined {
    let pair: { w?: unknown; h?: unknown };
    let explicitAspect = false;
    if (present(params.ratio)) {
        if (typeof params.ratio !== 'object' || Array.isArray(params.ratio)) {
            throw new HttpError(400, 'ratio must contain w and h', {
                legacyCode: 'bad_request',
            });
        }
        pair = params.ratio;
    } else if (present(params.width) || present(params.height)) {
        if (!present(params.width) || !present(params.height)) {
            throw new HttpError(400, 'width and height must be set together', {
                legacyCode: 'bad_request',
            });
        }
        pair = { w: params.width, h: params.height };
    } else if (present(params.aspect_ratio)) {
        if (
            typeof params.aspect_ratio !== 'string' ||
            params.aspect_ratio.split(':').length !== 2
        ) {
            throw new HttpError(400, 'aspect_ratio must use w:h format', {
                legacyCode: 'bad_request',
            });
        }
        const [w, h] = params.aspect_ratio.split(':');
        pair = { w, h };
        explicitAspect = true;
    } else return undefined;
    const ratio = { w: dimension(pair.w), h: dimension(pair.h) };
    const quotient = ratio.w / ratio.h;
    if (!Number.isFinite(quotient) || quotient <= 0) {
        throw new HttpError(
            400,
            'Image aspect ratio is outside the supported numeric range',
            { legacyCode: 'bad_request' },
        );
    }
    const aspect =
        explicitAspect ||
        (model?.pixelSizeThreshold
            ? ratio.w * ratio.h < model.pixelSizeThreshold
            : isAspectRatio(ratio));
    return { ...ratio, kind: aspect ? 'aspect' : 'pixels' };
}

export function closestAspectRatio<T extends ImageDimensions>(
    ratio: ImageDimensions,
    candidates: T[],
): T {
    const target = ratio.w / ratio.h;
    return candidates.reduce((best, candidate) =>
        Math.abs(Math.log(candidate.w / candidate.h / target)) <
        Math.abs(Math.log(best.w / best.h / target))
            ? candidate
            : best,
    );
}

const isWhole = (value: number) => Math.abs(value - Math.round(value)) < 1e-6;

export function formatAspectRatio(ratio?: ImageDimensions): string | undefined {
    if (
        !ratio ||
        !Number.isFinite(ratio.w) ||
        !Number.isFinite(ratio.h) ||
        ratio.w <= 0 ||
        ratio.h <= 0
    )
        return undefined;
    // Euclid needs integers: `%` on doubles turns 1.1:1 into sixteen-digit
    // terms, so scale decimal pairs up first (16.5:9.5 → 165:95).
    let scale = 1;
    while (
        scale < 1e6 &&
        !(isWhole(ratio.w * scale) && isWhole(ratio.h * scale))
    )
        scale *= 10;
    const w = Math.round(ratio.w * scale);
    const h = Math.round(ratio.h * scale);
    if (!w || !h) return undefined;
    let a = w;
    let b = h;
    while (b !== 0) [a, b] = [b, a % b];
    return `${w / a}:${h / a}`;
}

/** Expand a shape without multiplying tiny dimension pairs first. */
export function expandAspectRatio(
    ratio: ImageDimensions,
    pixels = 1024 * 1024,
): ImageDimensions {
    const side = Math.sqrt(pixels);
    const aspect = Math.sqrt(ratio.w / ratio.h);
    return { w: side * aspect, h: side / aspect };
}
