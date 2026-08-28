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
 * may be a public URL, a data-URI, or raw base64. Providers whose upstream API
 * needs base64 use these helpers to normalize URLs server-side (via the
 * SSRF-guarded `secureFetch`); providers that accept URLs natively (Replicate,
 * xAI) pass them through untouched.
 */

import { HttpError } from '../../core/http/HttpError.js';
import { secureFetch } from '../../util/secureHttp.js';
import type { IGenerateParams } from './types.js';

export function isHttpUrl(s: unknown): boolean {
    return (
        typeof s === 'string' &&
        (s.startsWith('http://') || s.startsWith('https://'))
    );
}

/**
 * Normalize an input-image string for providers that accept URLs natively:
 * http(s) URLs and data-URIs pass through untouched, raw base64 is wrapped with
 * `mimeHint` (default image/png).
 */
export function toUrlOrDataUri(img: string, mimeHint?: string): string {
    assertInputImageString(img, 'input image');
    return isHttpUrl(img) || img.startsWith('data:')
        ? img
        : `data:${mimeHint ?? 'image/png'};base64,${img}`;
}

/**
 * An input image is a URL, a data-URI or raw base64 — always a string. The
 * field comes straight off the driver call, so the type has to be checked
 * before the helpers below reach for `.startsWith`.
 */
export function assertInputImageString(img: unknown, label: string): string {
    if (typeof img !== 'string') {
        throw new HttpError(
            400,
            `${label}: each input image must be a URL, data-URI, or base64 string.`,
            { legacyCode: 'bad_request' },
        );
    }
    return img;
}

/**
 * Validate `input_image` / `input_images` once, where the driver call arrives.
 * Providers reach for `.startsWith` on these, and several do it without going
 * through the helpers here, so the shape has to be settled before any of them
 * runs.
 */
export function assertInputImagesShape(
    params: Pick<IGenerateParams, 'input_image' | 'input_images'>,
    label: string,
): void {
    if (params.input_image !== undefined && params.input_image !== null) {
        assertInputImageString(params.input_image, label);
    }
    const imgs = params.input_images;
    if (imgs === undefined || imgs === null) return;
    if (!Array.isArray(imgs)) {
        throw new HttpError(400, `${label}: input_images must be an array.`, {
            legacyCode: 'bad_request',
        });
    }
    for (const img of imgs) assertInputImageString(img, label);
}

/**
 * Resolve the single input image for providers that only support one. Throws
 * 400 if `input_images` carries more than one entry. Returns the chosen image
 * string (URL / data-URI / raw base64) or undefined.
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
    const chosen = params.input_image ?? imgs?.[0];
    return chosen === undefined
        ? undefined
        : assertInputImageString(chosen, providerLabel);
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
 * Normalize any input-image string to a base64 data-URI: • http(s) URL →
 * fetched via secureFetch • data-URI → returned as-is • raw base64 → wrapped
 * with `mimeHint` (default image/png)
 */
export async function toBase64DataUri(
    img: string,
    mimeHint?: string,
): Promise<string> {
    assertInputImageString(img, 'input image');
    if (img.startsWith('data:')) return img;
    if (isHttpUrl(img)) {
        const { base64, mime } = await fetchImageAsBase64(img);
        return `data:${mime};base64,${base64}`;
    }
    return `data:${mimeHint ?? 'image/png'};base64,${img}`;
}
