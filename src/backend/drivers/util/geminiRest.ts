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
import { readBoundedBody } from './fileInput.js';
import { upstreamFetch } from './upstreamErrors.js';

export const GEMINI_API_BASE =
    'https://generativelanguage.googleapis.com/v1beta';

export const usesGoogleGeminiEndpoint = (apiBaseUrl: unknown): boolean =>
    apiBaseUrl === undefined ||
    (typeof apiBaseUrl === 'string' &&
        apiBaseUrl.replace(/\/*$/, '/') === `${GEMINI_API_BASE}/openai/`);

/** A Gemini reply that can't be used, as the caller sees it. */
export const geminiUpstreamFailure = (message: string): HttpError =>
    new HttpError(502, message, {
        legacyCode: 'upstream_failed',
        fields: { provider: 'gemini' },
    });

/**
 * POSTs `body` to a Gemini REST `path` and parses the JSON object it answers
 * with. `timeoutMs` covers the body read, and a reply over `maxBytes` fails as
 * an upstream error unless `tooLarge` supplies another. `T` is the documented reply shape; callers check every
 * field before use.
 */
export async function postGeminiJson<T extends object>(
    apiKey: string,
    path: string,
    body: object,
    {
        label,
        maxBytes,
        timeoutMs,
        signal,
        tooLarge = (max) =>
            geminiUpstreamFailure(`${label} response exceeds ${max} bytes`),
    }: {
        label: string;
        maxBytes: number;
        timeoutMs: number;
        signal?: AbortSignal;
        tooLarge?: (maxBytes: number) => Error;
    },
): Promise<T> {
    // Non-2xx answers and timeouts are classified at the driver boundary.
    const response = await upstreamFetch(
        'gemini',
        `${GEMINI_API_BASE}/${path}`,
        {
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
        },
        { providerLabel: 'Gemini', timeoutMs },
    );
    const raw = await readBoundedBody(response, maxBytes, tooLarge);
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch {
        // Handled with the non-object case below.
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw geminiUpstreamFailure(`${label} returned an unreadable response`);
    }
    return parsed as T;
}

export const geminiTokenCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
