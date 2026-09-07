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

import type { IChatModel } from '../types.js';

/**
 * Media content parts, canonicalised once in the driver so providers only ever
 * translate from one shape (the OpenAI Chat Completions form, which most
 * upstreams speak natively):
 *
 * - Image: `{ type: 'image_url', image_url: { url, detail? } }`
 * - Video: `{ type: 'video_url', video_url: { url } }`
 *
 * Accepted inbound shapes: OpenAI Chat (typed or untyped, object or bare string
 * URL, `detail` inside or beside it), OpenAI Responses `input_image`, Anthropic
 * `image` blocks with `url`/`base64` sources, and Gemini `inline_data`.
 * `puter_path` parts are left alone; the driver resolves them per attempt.
 */

export type MediaModality = 'image' | 'video';

type Part = Record<string, unknown>;

const isObject = (value: unknown): value is Part =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const DATA_URI_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

/**
 * Split a `data:` URI into its MIME type, base64 flag and payload. Returns null
 * for anything that isn't a data URI.
 */
export const parseDataUri = (
    url: string,
): { mimeType: string; base64: boolean; data: string } | null => {
    const match = DATA_URI_PATTERN.exec(url);
    if (!match) return null;
    const params = (match[2] ?? '')
        .split(';')
        .filter(Boolean)
        .map((p) => p.toLowerCase());
    return {
        mimeType: (match[1] || 'text/plain').toLowerCase(),
        base64: params.includes('base64'),
        data: match[3] ?? '',
    };
};

/** The URL out of a bare string or an OpenAI-style `{ url }` object. */
export const mediaUrlOf = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (isObject(value) && typeof value.url === 'string') return value.url;
    return undefined;
};

const canonicalImagePart = (
    rest: Part,
    url: string,
    detail: unknown,
): Part => ({
    ...rest,
    type: 'image_url',
    image_url: {
        url,
        ...(detail !== undefined && detail !== null ? { detail } : {}),
    },
});

const canonicalVideoPart = (rest: Part, url: string): Part => ({
    ...rest,
    type: 'video_url',
    video_url: { url },
});

/**
 * Canonicalise one content part. Returns the same object when nothing had to
 * change, so callers can tell a rewrite from a passthrough by identity.
 */
export const normalizeMediaPart = (part: unknown): unknown => {
    if (!isObject(part)) return part;

    // OpenAI Responses API: `image_url` is a bare string, `detail` a sibling.
    if (part.type === 'input_image') {
        const { type: _type, image_url, detail, ...rest } = part;
        const url = mediaUrlOf(image_url);
        // A `file_id`-only part has nothing we can canonicalise around.
        if (url === undefined) return part;
        return canonicalImagePart(rest, url, detail);
    }

    // Anthropic: `{ type: 'image', source: { type: 'url' | 'base64' } }`.
    if (part.type === 'image' && isObject(part.source)) {
        const { type: _type, source, ...rest } = part;
        if (source.type === 'url' && typeof source.url === 'string') {
            return canonicalImagePart(rest, source.url, undefined);
        }
        if (source.type === 'base64' && typeof source.data === 'string') {
            const mediaType =
                typeof source.media_type === 'string'
                    ? source.media_type
                    : 'application/octet-stream';
            return canonicalImagePart(
                rest,
                `data:${mediaType};base64,${source.data}`,
                undefined,
            );
        }
        // Anthropic Files API references stay Anthropic-only.
        return part;
    }

    // Gemini: `{ inline_data: { mime_type, data } }` (snake or camel case).
    const inline = isObject(part.inline_data)
        ? part.inline_data
        : isObject(part.inlineData)
          ? part.inlineData
          : undefined;
    if (inline && typeof inline.data === 'string') {
        const mime =
            typeof inline.mime_type === 'string'
                ? inline.mime_type
                : typeof inline.mimeType === 'string'
                  ? inline.mimeType
                  : '';
        const {
            inline_data: _snake,
            inlineData: _camel,
            type: _type,
            ...rest
        } = part;
        const url = `data:${mime || 'application/octet-stream'};base64,${inline.data}`;
        if (mime.startsWith('image/')) {
            return canonicalImagePart(rest, url, undefined);
        }
        if (mime.startsWith('video/')) return canonicalVideoPart(rest, url);
        return part;
    }

    // OpenAI Chat Completions: possibly untyped, possibly a bare string URL,
    // possibly with `detail` beside the URL instead of inside it.
    if (
        part.image_url !== undefined &&
        (part.type === undefined || part.type === 'image_url')
    ) {
        const url = mediaUrlOf(part.image_url);
        if (url === undefined) return part;
        const { type: _type, image_url, detail, ...rest } = part;
        const innerDetail = isObject(image_url) ? image_url.detail : undefined;
        const alreadyCanonical =
            part.type === 'image_url' &&
            isObject(image_url) &&
            detail === undefined;
        if (alreadyCanonical) return part;
        return canonicalImagePart(rest, url, innerDetail ?? detail);
    }
    if (
        part.video_url !== undefined &&
        (part.type === undefined || part.type === 'video_url')
    ) {
        const url = mediaUrlOf(part.video_url);
        if (url === undefined) return part;
        if (part.type === 'video_url' && isObject(part.video_url)) return part;
        const { type: _type, video_url: _video, ...rest } = part;
        return canonicalVideoPart(rest, url);
    }

    return part;
};

/**
 * Canonicalise every media part in place. Replaces array elements (as the
 * message normaliser already does) without mutating the original part objects.
 */
export const normalizeMediaParts = <T extends { content?: unknown }>(
    messages: T[],
): T[] => {
    for (const message of messages) {
        if (!message || !Array.isArray(message.content)) continue;
        const content = message.content as unknown[];
        for (let i = 0; i < content.length; i++) {
            const normalized = normalizeMediaPart(content[i]);
            if (normalized !== content[i]) content[i] = normalized;
        }
    }
    return messages;
};

/**
 * Input modalities the messages need beyond text. `puter_path` parts are not
 * counted: what they point at is unknown until an attempt resolves them.
 */
export const requiredInputModalities = (
    messages: ReadonlyArray<{ content?: unknown }> | undefined,
): MediaModality[] => {
    const found = new Set<MediaModality>();
    for (const message of messages ?? []) {
        if (!message || !Array.isArray(message.content)) continue;
        for (const part of message.content as unknown[]) {
            if (!isObject(part)) continue;
            if (part.type === 'image_url' || part.image_url !== undefined) {
                found.add('image');
            } else if (
                part.type === 'video_url' ||
                part.video_url !== undefined
            ) {
                found.add('video');
            }
        }
    }
    return [...found];
};

/** True when the catalog entry advertises the given input modality. */
export const modelSupportsModality = (
    model: Pick<IChatModel, 'modalities'>,
    modality: string,
): boolean =>
    Array.isArray(model.modalities?.input) &&
    model.modalities.input.includes(modality);

/** True when the Puter model catalog entry advertises image input. */
export const modelSupportsVision = (
    model: Pick<IChatModel, 'modalities'>,
): boolean => modelSupportsModality(model, 'image');

/**
 * Detect image / puter_path parts so a provider can prefer a vision-capable
 * model from its catalog (or reject a text-only pick).
 */
export const messagesHaveImageContent = (
    messages: ReadonlyArray<{ content?: unknown }>,
): boolean => {
    for (const message of messages) {
        if (!message || !Array.isArray(message.content)) continue;
        for (const part of message.content as unknown[]) {
            if (!isObject(part)) continue;
            if (part.type === 'image_url' || part.image_url !== undefined) {
                return true;
            }
            if (typeof part.puter_path === 'string' && part.puter_path) {
                return true;
            }
        }
    }
    return false;
};

/** True when any part still carries an unresolved `puter_path`. */
export const messagesHavePuterPaths = (
    messages: ReadonlyArray<{ content?: unknown }> | undefined,
): boolean => {
    for (const message of messages ?? []) {
        if (!message || !Array.isArray(message.content)) continue;
        for (const part of message.content as unknown[]) {
            if (
                isObject(part) &&
                typeof part.puter_path === 'string' &&
                part.puter_path
            ) {
                return true;
            }
        }
    }
    return false;
};

/**
 * The inline note substituted for an attachment a provider cannot carry; same
 * wording as the `puter_path` resolvers and the image inliner.
 */
export const unsupportedMediaTextPart = (
    reason: string,
): { type: 'text'; text: string } => ({
    type: 'text',
    text: `{error: ${reason}; the user did not write this message}`,
});
