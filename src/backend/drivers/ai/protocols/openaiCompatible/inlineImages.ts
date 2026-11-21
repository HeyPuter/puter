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

import { Context } from '../../../../core/context.js';
import { isHttpError } from '../../../../core/http/HttpError.js';
import { runWithConcurrencyLimit } from '../../../../util/concurrency.js';
import { fetchImageBytes } from '../../shared/imageInput.js';

// Matches the OpenAI Chat-Completions inline-upload cap.
export const MAX_IMAGE_BYTES = 5 * 1_000_000;
export const MAX_INLINE_IMAGES = 20;
export const MAX_VIDEO_BYTES = 20 * 1_000_000;
export const MAX_INLINE_VIDEOS = 4;
const FETCH_CONCURRENCY = 4;

type MediaField = 'image_url' | 'video_url';

interface MediaContentPart {
    type?: string;
    text?: string;
    image_url?: { url?: string };
    video_url?: { url?: string };
}

interface MessageWithContent {
    content?: unknown;
}

interface MediaKind {
    field: MediaField;
    noun: 'image' | 'video';
    maxBytes: number;
    maxCount: number;
}

const IMAGE: MediaKind = {
    field: 'image_url',
    noun: 'image',
    maxBytes: MAX_IMAGE_BYTES,
    maxCount: MAX_INLINE_IMAGES,
};

const VIDEO: MediaKind = {
    field: 'video_url',
    noun: 'video',
    maxBytes: MAX_VIDEO_BYTES,
    maxCount: MAX_INLINE_VIDEOS,
};

/** For a host that serves a video without a video content type. */
const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
};

// Moonshot's vision API rejects http(s) image URLs and only accepts base64
// data URIs or file-id refs, so any web URL must be fetched and inlined.
// Failures become inline text-error parts (same shape as
// openai/chat/fileUpload.ts).
export const inlineHttpImageUrls = (
    messages: MessageWithContent[],
): Promise<void> => inlineHttpMedia(messages, IMAGE);

/** The same for `video_url` parts, for a vendor that fetches no video URL. */
export const inlineHttpVideoUrls = (
    messages: MessageWithContent[],
): Promise<void> => inlineHttpMedia(messages, VIDEO);

async function inlineHttpMedia(
    messages: MessageWithContent[],
    kind: MediaKind,
): Promise<void> {
    const tasks: Array<{ part: MediaContentPart; url: string }> = [];
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as MediaContentPart[]) {
            const url = part?.[kind.field]?.url;
            if (typeof url !== 'string') continue;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                continue;
            }
            if (tasks.length >= kind.maxCount) {
                setTextError(
                    part,
                    `maximum of ${kind.maxCount} remote ${kind.noun}s per request`,
                );
                continue;
            }
            tasks.push({ part, url });
        }
    }
    await runWithConcurrencyLimit(tasks, FETCH_CONCURRENCY, ({ part, url }) =>
        inlineOne(part, url, kind),
    );
}

const videoMimeOf = (
    declared: string | undefined,
    url: string,
): string | undefined => {
    if (declared?.startsWith('video/')) return declared;
    let extension: string | undefined;
    try {
        extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    } catch {
        return undefined;
    }
    return VIDEO_MIME_BY_EXTENSION[extension ?? ''];
};

async function inlineOne(
    part: MediaContentPart,
    url: string,
    kind: MediaKind,
): Promise<void> {
    try {
        const { bytes, mime, declaredMime } = await fetchImageBytes(url, {
            maxBytes: kind.maxBytes,
            signal: Context.get('abortSignal'),
            requireImageMime: kind === IMAGE,
        });
        const mimeType = kind === IMAGE ? mime : videoMimeOf(declaredMime, url);
        if (!mimeType) {
            setTextError(
                part,
                `expected a video, got ${declaredMime || 'unknown MIME type'}`,
            );
            return;
        }
        part.type = kind.field;
        part[kind.field] = {
            url: `data:${mimeType};base64,${bytes.toString('base64')}`,
        };
    } catch (err) {
        if (isHttpError(err) && err.code === 'input_too_large') {
            setTextError(
                part,
                `${kind.noun} exceeds maximum of ${kind.maxBytes} bytes`,
            );
            return;
        }
        // fetchImageBytes' own errors are safe to show, but they name an
        // image; anything else (DNS, socket, SSRF guard) stays generic.
        const message =
            isHttpError(err) && kind === IMAGE
                ? err.message
                : `failed to fetch ${kind.noun}`;
        setTextError(part, message);
    }
}

function setTextError(part: MediaContentPart, reason: string): void {
    delete part.image_url;
    delete part.video_url;
    part.type = 'text';
    // Phrasing matches openai/chat/fileUpload.ts so the model reads it as a
    // system note, not user input.
    part.text = `{error: ${reason}; the user did not write this message}`;
}
