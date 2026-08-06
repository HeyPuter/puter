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

interface ImageUrlPart {
    type?: string;
    image_url?: string | { url?: string };
    source?: unknown;
    [key: string]: unknown;
}

type AnthropicImagePart = {
    type: 'image';
    source:
        | { type: 'url'; url: string }
        | { type: 'base64'; media_type: string; data: string };
};

const extractImageUrl = (part: ImageUrlPart): string | undefined => {
    const raw = part.image_url;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && typeof raw.url === 'string') {
        return raw.url;
    }
    return undefined;
};

const toAnthropicImagePart = (url: string): AnthropicImagePart => {
    const dataUriMatch = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (dataUriMatch) {
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: dataUriMatch[1]!,
                data: dataUriMatch[2]!,
            },
        };
    }
    return {
        type: 'image',
        source: { type: 'url', url },
    };
};

/**
 * Rewrite OpenAI-style `image_url` content parts into Anthropic `image`
 * blocks. The puter.js vision shorthand sends `{ image_url: { url } }`
 * without a `type`, which Anthropic rejects (`content.N.type: Field required`).
 */
export function coerceImageContentParts(
    messages: Array<{ content?: unknown }>,
): void {
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        message.content = (message.content as ImageUrlPart[]).map((part) => {
            if (!part || typeof part !== 'object') return part;
            if (part.type === 'image' && part.source) return part;
            const url = extractImageUrl(part);
            if (url === undefined) return part;
            return toAnthropicImagePart(url);
        });
    }
}
