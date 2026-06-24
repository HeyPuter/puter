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

/**
 * Shared helpers for `input_images` (image-to-image) handling across image
 * providers. `input_images` is the canonical, cross-provider field; an entry
 * may be a public URL, a data-URI, or raw base64. Providers whose upstream
 * API needs base64 use these helpers to normalize URLs server-side (via the
 * SSRF-guarded `secureFetch`); providers that accept URLs natively (Replicate,
 * xAI) pass them through untouched.
 */

import { HttpError } from '../../core/http/HttpError.js';
import { secureFetch } from '../../util/secureHttp.js';
import type { IGenerateParams } from './types.js';

export function isHttpUrl(s: string): boolean {
    return s.startsWith('http://') || s.startsWith('https://');
}

/**
 * Resolve the single input image for providers that only support one.
 * Throws 400 if `input_images` carries more than one entry. Returns the
 * chosen image string (URL / data-URI / raw base64) or undefined.
 */
export function resolveSingleInputImage(
    params: Pick<IGenerateParams, 'input_image' | 'input_images'>,
    providerLabel: string,
): string | undefined {
    const imgs = params.input_images;
    if (imgs && imgs.length > 1) {
        throw new HttpError(
            400,
            `${providerLabel} supports only a single input image; pass one image via input_image or a single-element input_images.`,
            { legacyCode: 'bad_request' },
        );
    }
    return params.input_image ?? imgs?.[0];
}

const DATA_URI_PATTERN = /^data:([^;,]+)?(?:;base64)?,(.*)$/s;

/** Parse a `data:<mime>;base64,<payload>` URI into raw base64 + mime. */
export function parseDataUri(
    s: string,
): { base64: string; mime: string } | null {
    const m = DATA_URI_PATTERN.exec(s);
    if (!m) return null;
    return { base64: m[2] ?? '', mime: m[1] ?? 'image/png' };
}

/** Fetch an http(s) image and return raw base64 + mime (SSRF-guarded). */
export async function fetchImageAsBase64(
    url: string,
): Promise<{ base64: string; mime: string }> {
    const res = await secureFetch(url);
    if (!res.ok) {
        throw new HttpError(
            400,
            `Failed to fetch input image (status ${res.status})`,
            { legacyCode: 'bad_request' },
        );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime =
        res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return { base64: buffer.toString('base64'), mime };
}

/**
 * Normalize any input-image string to a base64 data-URI:
 *   • http(s) URL  → fetched via secureFetch
 *   • data-URI     → returned as-is
 *   • raw base64   → wrapped with `mimeHint` (default image/png)
 */
export async function toBase64DataUri(
    img: string,
    mimeHint?: string,
): Promise<string> {
    if (img.startsWith('data:')) return img;
    if (isHttpUrl(img)) {
        const { base64, mime } = await fetchImageAsBase64(img);
        return `data:${mime};base64,${base64}`;
    }
    return `data:${mimeHint ?? 'image/png'};base64,${img}`;
}
