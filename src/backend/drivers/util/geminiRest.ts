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
        media,
        tooLarge = (max) =>
            geminiUpstreamFailure(`${label} response exceeds ${max} bytes`),
    }: {
        label: string;
        maxBytes: number;
        timeoutMs: number;
        signal?: AbortSignal;
        /** Streams into `body` in place of its placeholder string. */
        media?: StreamedBase64;
        tooLarge?: (maxBytes: number) => Error;
    },
): Promise<T> {
    const streamed = media ? jsonWithStreamedBase64(body, media) : undefined;
    // Non-2xx answers and timeouts are classified at the driver boundary.
    const response = await upstreamFetch(
        'gemini',
        `${GEMINI_API_BASE}/${path}`,
        {
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'Content-Type': 'application/json',
                ...(streamed
                    ? { 'Content-Length': String(streamed.byteLength) }
                    : {}),
            },
            body: streamed?.stream ?? JSON.stringify(body),
            ...(streamed ? { duplex: 'half' } : {}),
            signal,
        } as RequestInit,
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

/** Bytes sent as the base64 value of one string in a JSON request body. */
export interface StreamedBase64 {
    /** The string in the body the bytes replace; it must appear once. */
    placeholder: string;
    chunks: AsyncIterable<Buffer> | Iterable<Buffer>;
    /** Exact byte count `chunks` yields. */
    byteLength: number;
}

/**
 * `body` as JSON with `media.placeholder` replaced by the base64 of
 * `media.chunks`, encoded as the chunks arrive so the file is never held whole,
 * and the exact length of the result.
 */
export function jsonWithStreamedBase64(
    body: object,
    media: StreamedBase64,
): { stream: ReadableStream<Uint8Array>; byteLength: number } {
    const json = JSON.stringify(body);
    const quoted = JSON.stringify(media.placeholder);
    const at = json.indexOf(quoted);
    if (at === -1 || json.indexOf(quoted, at + 1) !== -1) {
        throw new Error('The media placeholder must appear once in the body');
    }
    // The placeholder's quotes stay around the base64.
    const prefix = Buffer.from(json.slice(0, at + 1));
    const suffix = Buffer.from(json.slice(at + quoted.length - 1));

    async function* parts(): AsyncGenerator<Uint8Array> {
        yield prefix;
        // Base64 encodes whole 3-byte groups; a partial group waits for the next chunk.
        let carry: Buffer = Buffer.alloc(0);
        for await (const chunk of media.chunks) {
            const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
            const whole = bytes.length - (bytes.length % 3);
            if (whole)
                yield Buffer.from(bytes.subarray(0, whole).toString('base64'));
            carry = bytes.subarray(whole);
        }
        if (carry.length) yield Buffer.from(carry.toString('base64'));
        yield suffix;
    }

    const iterator = parts();
    return {
        stream: new ReadableStream<Uint8Array>({
            async pull(controller) {
                const next = await iterator.next();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            },
            async cancel() {
                await iterator.return(undefined);
            },
        }),
        byteLength:
            prefix.length + Math.ceil(media.byteLength / 3) * 4 + suffix.length,
    };
}

export const geminiTokenCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
