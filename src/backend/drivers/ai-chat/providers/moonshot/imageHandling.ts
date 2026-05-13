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

import { secureFetch } from '../../../../util/secureHttp.js';

// Matches the OpenAI Chat-Completions inline-upload cap.
export const MAX_IMAGE_BYTES = 5 * 1_000_000;

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
    const tasks: Array<Promise<void>> = [];
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as ImageContentPart[]) {
            const url = part?.image_url?.url;
            if (!url) continue;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                continue;
            }
            tasks.push(inlineOne(part, url));
        }
    }
    await Promise.all(tasks);
}

async function inlineOne(part: ImageContentPart, url: string): Promise<void> {
    try {
        const response = await secureFetch(url);
        if (!response.ok) {
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
            setTextError(
                part,
                `image exceeds maximum of ${MAX_IMAGE_BYTES} bytes`,
            );
            return;
        }

        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > MAX_IMAGE_BYTES) {
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
            setTextError(
                part,
                `expected an image, got ${mimeType || 'unknown MIME type'}`,
            );
            return;
        }

        const base64 = Buffer.from(arrayBuf).toString('base64');
        part.type = 'image_url';
        part.image_url = { url: `data:${mimeType};base64,${base64}` };
    } catch (err) {
        const message = (err as Error)?.message || 'failed to fetch image';
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
