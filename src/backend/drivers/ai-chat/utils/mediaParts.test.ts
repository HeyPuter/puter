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

import { describe, expect, it } from 'vitest';

import {
    messagesHaveImageContent,
    messagesHavePuterPaths,
    modelSupportsModality,
    modelSupportsVision,
    normalizeMediaPart,
    normalizeMediaParts,
    parseDataUri,
    requiredInputModalities,
    unsupportedMediaTextPart,
} from './mediaParts.js';

const PNG_URL = 'https://cdn.test/a.png';
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('parseDataUri', () => {
    it('splits mime type, base64 flag and payload', () => {
        expect(parseDataUri(DATA_URL)).toEqual({
            mimeType: 'image/png',
            base64: true,
            data: 'iVBORw0KGgo=',
        });
    });

    it('treats a missing mime type as text/plain and no base64 flag as false', () => {
        expect(parseDataUri('data:,hello')).toEqual({
            mimeType: 'text/plain',
            base64: false,
            data: 'hello',
        });
    });

    it('returns null for anything that is not a data URI', () => {
        expect(parseDataUri(PNG_URL)).toBeNull();
        expect(parseDataUri('')).toBeNull();
    });
});

describe('normalizeMediaPart', () => {
    it('types the puter.js shorthand `{ image_url: { url } }`', () => {
        expect(normalizeMediaPart({ image_url: { url: PNG_URL } })).toEqual({
            type: 'image_url',
            image_url: { url: PNG_URL },
        });
    });

    it('wraps a bare string image_url in { url }', () => {
        expect(normalizeMediaPart({ image_url: PNG_URL })).toEqual({
            type: 'image_url',
            image_url: { url: PNG_URL },
        });
        expect(
            normalizeMediaPart({ type: 'image_url', image_url: PNG_URL }),
        ).toEqual({ type: 'image_url', image_url: { url: PNG_URL } });
    });

    it('moves a sibling `detail` inside image_url', () => {
        expect(
            normalizeMediaPart({
                type: 'image_url',
                detail: 'low',
                image_url: { url: PNG_URL },
            }),
        ).toEqual({
            type: 'image_url',
            image_url: { url: PNG_URL, detail: 'low' },
        });
    });

    it('returns an already-canonical image part by identity', () => {
        const part = {
            type: 'image_url',
            image_url: { url: PNG_URL, detail: 'high' },
        };
        expect(normalizeMediaPart(part)).toBe(part);
    });

    it('maps a Responses `input_image` item', () => {
        expect(
            normalizeMediaPart({
                type: 'input_image',
                image_url: PNG_URL,
                detail: 'high',
            }),
        ).toEqual({
            type: 'image_url',
            image_url: { url: PNG_URL, detail: 'high' },
        });
    });

    it('leaves a file_id-only `input_image` alone', () => {
        const part = { type: 'input_image', file_id: 'file_123' };
        expect(normalizeMediaPart(part)).toBe(part);
    });

    it('maps an Anthropic url-source image block', () => {
        expect(
            normalizeMediaPart({
                type: 'image',
                source: { type: 'url', url: PNG_URL },
                cache_control: { type: 'ephemeral' },
            }),
        ).toEqual({
            type: 'image_url',
            image_url: { url: PNG_URL },
            cache_control: { type: 'ephemeral' },
        });
    });

    it('maps an Anthropic base64-source image block to a data URL', () => {
        expect(
            normalizeMediaPart({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo=',
                },
            }),
        ).toEqual({ type: 'image_url', image_url: { url: DATA_URL } });
    });

    it('leaves an Anthropic Files API image block alone', () => {
        const part = {
            type: 'image',
            source: { type: 'file', file_id: 'file_abc' },
        };
        expect(normalizeMediaPart(part)).toBe(part);
    });

    it('maps Gemini inline_data (snake and camel case) by mime type', () => {
        expect(
            normalizeMediaPart({
                inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' },
            }),
        ).toEqual({ type: 'image_url', image_url: { url: DATA_URL } });
        expect(
            normalizeMediaPart({
                inlineData: { mimeType: 'video/mp4', data: 'AAAA' },
            }),
        ).toEqual({
            type: 'video_url',
            video_url: { url: 'data:video/mp4;base64,AAAA' },
        });
        // Audio has no canonical part yet; passthrough by identity.
        const audio = {
            inline_data: { mime_type: 'audio/mpeg', data: 'AAAA' },
        };
        expect(normalizeMediaPart(audio)).toBe(audio);
    });

    it('types and wraps video_url parts', () => {
        expect(
            normalizeMediaPart({ video_url: 'https://cdn.test/a.mp4' }),
        ).toEqual({
            type: 'video_url',
            video_url: { url: 'https://cdn.test/a.mp4' },
        });
        const canonical = {
            type: 'video_url',
            video_url: { url: 'https://cdn.test/a.mp4' },
        };
        expect(normalizeMediaPart(canonical)).toBe(canonical);
    });

    it('returns text, tool and puter_path parts and non-objects by identity', () => {
        for (const part of [
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'f', input: {} },
            { puter_path: '/u/Documents/a.png' },
            'plain string',
            null,
            42,
        ]) {
            expect(normalizeMediaPart(part)).toBe(part);
        }
    });

    it('does not mutate the part it was given', () => {
        const part = Object.freeze({
            image_url: Object.freeze({ url: PNG_URL }),
        });
        const out = normalizeMediaPart(part) as Record<string, unknown>;
        expect(out).not.toBe(part);
        expect(out.type).toBe('image_url');
        expect(part).toEqual({ image_url: { url: PNG_URL } });
    });
});

describe('normalizeMediaParts', () => {
    it('rewrites media parts inside every message and returns the same array', () => {
        const messages = [
            { role: 'user', content: 'plain string content' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'look' },
                    { image_url: { url: PNG_URL } },
                    { type: 'input_image', image_url: DATA_URL },
                ],
            },
        ];
        const out = normalizeMediaParts(messages);
        expect(out).toBe(messages);
        expect(messages[0]).toEqual({
            role: 'user',
            content: 'plain string content',
        });
        expect(messages[1]!.content).toEqual([
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: PNG_URL } },
            { type: 'image_url', image_url: { url: DATA_URL } },
        ]);
    });
});

describe('requiredInputModalities', () => {
    it('reports image and video parts, counting each modality once', () => {
        expect(
            requiredInputModalities([
                {
                    content: [
                        { type: 'text', text: 'a' },
                        { type: 'image_url', image_url: { url: PNG_URL } },
                        { image_url: { url: PNG_URL } },
                    ],
                },
                { content: [{ video_url: { url: 'https://cdn.test/a.mp4' } }] },
            ]),
        ).toEqual(['image', 'video']);
    });

    it('ignores puter_path parts, string content and missing messages', () => {
        expect(
            requiredInputModalities([
                { content: 'hi' },
                { content: [{ puter_path: '/u/Documents/a.png' }] },
            ]),
        ).toEqual([]);
        expect(requiredInputModalities(undefined)).toEqual([]);
    });
});

describe('model modality helpers', () => {
    it('reads modalities.input', () => {
        const vision = {
            modalities: { input: ['text', 'image'], output: ['text'] },
        };
        const textOnly = { modalities: { input: ['text'], output: ['text'] } };
        expect(modelSupportsVision(vision)).toBe(true);
        expect(modelSupportsVision(textOnly)).toBe(false);
        expect(modelSupportsModality(vision, 'video')).toBe(false);
        // Undeclared modalities are simply "not advertised".
        expect(modelSupportsVision({})).toBe(false);
    });
});

describe('message scanners', () => {
    it('messagesHaveImageContent counts image parts and puter_path parts', () => {
        expect(messagesHaveImageContent([{ content: 'hi' }])).toBe(false);
        expect(
            messagesHaveImageContent([
                { content: [{ image_url: { url: PNG_URL } }] },
            ]),
        ).toBe(true);
        expect(
            messagesHaveImageContent([
                { content: [{ puter_path: '/u/a.png' }] },
            ]),
        ).toBe(true);
    });

    it('messagesHavePuterPaths only counts unresolved puter_path parts', () => {
        expect(
            messagesHavePuterPaths([{ content: [{ puter_path: '/u/a.png' }] }]),
        ).toBe(true);
        expect(
            messagesHavePuterPaths([
                {
                    content: [
                        { type: 'image_url', image_url: { url: PNG_URL } },
                    ],
                },
            ]),
        ).toBe(false);
        expect(messagesHavePuterPaths(undefined)).toBe(false);
    });
});

describe('unsupportedMediaTextPart', () => {
    it('produces the shared inline system-note shape', () => {
        expect(
            unsupportedMediaTextPart('video input is not supported'),
        ).toEqual({
            type: 'text',
            text: '{error: video input is not supported; the user did not write this message}',
        });
    });
});
