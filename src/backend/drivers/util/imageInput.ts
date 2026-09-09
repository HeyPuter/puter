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
 * Image inputs as drivers receive them: a public URL, a data-URI, or raw base64
 * — always a string. Providers whose upstream needs inline bytes normalize URLs
 * server-side through the SSRF-guarded `secureFetch`; providers that accept
 * URLs natively pass them through untouched.
 */

import { HttpError } from '../../core/http/HttpError.js';
import { secureFetch } from '../../util/secureHttp.js';

export function isHttpUrl(s: unknown): boolean {
    return (
        typeof s === 'string' &&
        (s.startsWith('http://') || s.startsWith('https://'))
    );
}

/**
 * An input image is a URL, a data-URI or raw base64 — always a string. The
 * field comes straight off the driver call, so the type has to be checked
 * before anything reaches for `.startsWith`.
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
