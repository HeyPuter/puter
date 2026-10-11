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

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Context } from '../../../core/context.js';
import { runWithConcurrencyLimit } from '../../../util/concurrency.js';
import { collectStream } from '../../util/fileInput.js';
import { secureFetch } from '../../../util/secureHttp.js';

// Matches the OpenAI Chat-Completions inline-upload cap.
export const MAX_IMAGE_BYTES = 5 * 1_000_000;
export const MAX_INLINE_IMAGES = 20;
const IMAGE_FETCH_CONCURRENCY = 4;

interface ImageContentPart {
    type?: string;
    text?: string;
    image_url?: { url?: string };
}

interface MessageWithContent {
    content?: unknown;
}

// Moonshot's vision API rejects http(s) image URLs and only accepts base64
// data URIs or file-id refs, so any web URL must be fetched and inlined.
// Failures become inline text-error parts (same shape as openai/fileUpload.ts).
export async function inlineHttpImageUrls(
    messages: MessageWithContent[],
): Promise<void> {
    const tasks: Array<{ part: ImageContentPart; url: string }> = [];
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as ImageContentPart[]) {
            const url = part?.image_url?.url;
            if (typeof url !== 'string') continue;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                continue;
            }
            if (tasks.length >= MAX_INLINE_IMAGES) {
                setTextError(
                    part,
                    `maximum of ${MAX_INLINE_IMAGES} remote images per request`,
                );
                continue;
            }
            tasks.push({ part, url });
        }
    }
    await runWithConcurrencyLimit(
        tasks,
        IMAGE_FETCH_CONCURRENCY,
        ({ part, url }) => inlineOne(part, url),
    );
}

async function inlineOne(part: ImageContentPart, url: string): Promise<void> {
    try {
        const requestSignal = Context.get('abortSignal');
        const timeoutSignal = AbortSignal.timeout(30_000);
        const signal = requestSignal
            ? AbortSignal.any([requestSignal, timeoutSignal])
            : timeoutSignal;
        const response = await secureFetch(url, { signal });
        if (!response.ok) {
            await response.body?.cancel();
            setTextError(
                part,
                `failed to fetch image (status ${response.status})`,
            );
            return;
        }
        const contentLength = Number(
            response.headers.get('content-length') ?? NaN,
        );
        if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
            await response.body?.cancel();
            setTextError(
                part,
                `image exceeds maximum of ${MAX_IMAGE_BYTES} bytes`,
            );
            return;
        }

        const mimeType = (response.headers.get('content-type') ?? '')
            .split(';')[0]
            ?.trim();
        if (!mimeType || !mimeType.startsWith('image/')) {
            await response.body?.cancel();
            setTextError(
                part,
                `expected an image, got ${mimeType || 'unknown MIME type'}`,
            );
            return;
        }

        const buffer = response.body
            ? await collectStream(
                  Readable.fromWeb(response.body as WebReadableStream),
                  MAX_IMAGE_BYTES,
              )
            : Buffer.alloc(0);
        const base64 = buffer.toString('base64');
        part.type = 'image_url';
        part.image_url = { url: `data:${mimeType};base64,${base64}` };
    } catch (err) {
        const message =
            (err as { legacyCode?: string })?.legacyCode === 'input_too_large'
                ? `image exceeds maximum of ${MAX_IMAGE_BYTES} bytes`
                : 'failed to fetch image';
        setTextError(part, message);
    }
}

function setTextError(part: ImageContentPart, reason: string): void {
    delete part.image_url;
    part.type = 'text';
    // Phrasing matches openai/fileUpload.ts so the model reads it as a
    // system note, not user input.
    part.text = `{error: ${reason}; the user did not write this message}`;
}
