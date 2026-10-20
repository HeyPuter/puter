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
 * Kling AI's REST API, shared by the video, image and TTS providers. One API
 * key authenticates every endpoint as a Bearer token.
 * https://kling.ai/document-api/api/get-started/authentication
 */

import { HttpError } from '../../core/http/HttpError.js';
import { readBoundedBody } from './fileInput.js';
import { sanitizeUpstreamMessage } from './upstreamErrors.js';

export const KLING_API_BASE = 'https://api-singapore.klingai.com';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Kling's envelope: `code` 0 is success, anything else names the failure. */
export interface KlingEnvelope<T> {
    code?: number;
    message?: string;
    request_id?: string;
    data?: T;
}

/**
 * The HTTP status a Kling business code means for us. Exhausted resource packs
 * and arrears arrive as 429 but are the deployment's billing problem, not a
 * rate limit; they map to 402 so the driver boundary reports them as credit
 * exhaustion. https://kling.ai/document-api/api/get-started/error-codes
 */
const statusForCode = (code: number, httpStatus: number): number => {
    if (code >= 1000 && code <= 1004) return 401;
    if (code === 1101 || code === 1102) return 402;
    if (code === 1100 || code === 1103 || code === 1304) return 403;
    if (code === 1302 || code === 1303) return 429;
    if (code >= 1200 && code <= 1300) return 400;
    if (code >= 5000) return httpStatus >= 500 ? httpStatus : 502;
    return httpStatus >= 400 ? httpStatus : 502;
};

/** A request Kling refused, shaped for `translateProviderError`. */
const klingError = (
    code: number | undefined,
    message: string,
    status: number,
) => {
    // 1202 and 1203 name a method or model Kling doesn't serve. Puter picks
    // both, so the catalog has drifted from Kling's: our fault, not the
    // caller's, and worth someone's attention.
    if (code === 1202 || code === 1203) {
        return new HttpError(
            502,
            'Kling does not support the model Puter requested',
            {
                legacyCode: 'upstream_failed',
                alarmSeverity: 'warning',
                fields: {
                    provider: 'kling',
                    upstreamCode: String(code),
                    upstreamMessage: sanitizeUpstreamMessage(message),
                },
            },
        );
    }
    // 1301 is Kling's content-safety block at submit time.
    if (code === 1301) {
        return new HttpError(
            400,
            sanitizeUpstreamMessage(message) ||
                'Kling rejected the request under its content policy',
            {
                legacyCode: 'bad_request',
                code: 'moderation_flagged',
                fields: { provider: 'kling', upstreamCode: String(code) },
            },
        );
    }
    return Object.assign(new Error(message), {
        status:
            code === undefined
                ? status >= 400
                    ? status
                    : 502
                : statusForCode(code, status),
        code: code === undefined ? undefined : String(code),
        provider: 'kling',
    });
};

/**
 * Calls a Kling endpoint and returns the envelope's `data`. A non-zero `code`
 * or a non-2xx status throws with the upstream status the driver boundary maps;
 * a timeout rejects with `TimeoutError`.
 */
export async function klingRequest<T>(
    apiKey: string,
    method: 'GET' | 'POST',
    path: string,
    {
        body,
        baseUrl = KLING_API_BASE,
        timeoutMs = REQUEST_TIMEOUT_MS,
    }: { body?: object; baseUrl?: string; timeoutMs?: number } = {},
): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await readBoundedBody(response, MAX_RESPONSE_BYTES, () =>
        klingError(undefined, 'Kling response too large', 502),
    );
    let envelope: KlingEnvelope<T> = {};
    try {
        const parsed: unknown = JSON.parse(raw.toString('utf8'));
        if (parsed && typeof parsed === 'object') {
            envelope = parsed as KlingEnvelope<T>;
        }
    } catch {
        // Not JSON; the status alone decides.
    }
    const code = typeof envelope.code === 'number' ? envelope.code : undefined;
    if (!response.ok || (code !== undefined && code !== 0)) {
        throw klingError(
            code,
            envelope.message ||
                `Kling request failed (status ${response.status})`,
            response.status,
        );
    }
    if (envelope.data === undefined) {
        throw klingError(undefined, 'Kling response had no data', 502);
    }
    return envelope.data;
}

/**
 * An image input as Kling takes it: a web URL as given, or raw base64 without
 * the `data:` prefix Kling rejects.
 */
export const klingImageInput = (image: string): string => {
    if (!image.startsWith('data:')) return image;
    const comma = image.indexOf(',');
    return comma === -1 ? image : image.slice(comma + 1);
};
