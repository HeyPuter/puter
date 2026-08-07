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
import { coerceImageContentParts } from './imageHandling.js';

describe('coerceImageContentParts', () => {
    it('converts puter.js vision shorthand `{ image_url: { url } }` blocks', () => {
        const messages = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What do you see?' },
                    {
                        image_url: {
                            url: 'https://assets.puter.site/doge.jpeg',
                        },
                    },
                ],
            },
        ];

        coerceImageContentParts(messages);

        expect(messages[0]!.content).toEqual([
            { type: 'text', text: 'What do you see?' },
            {
                type: 'image',
                source: {
                    type: 'url',
                    url: 'https://assets.puter.site/doge.jpeg',
                },
            },
        ]);
    });

    it('converts typed OpenAI `image_url` parts with nested url objects', () => {
        const messages = [
            {
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: 'https://example.com/a.png' },
                    },
                ],
            },
        ];

        coerceImageContentParts(messages);

        expect(messages[0]!.content[0]).toEqual({
            type: 'image',
            source: { type: 'url', url: 'https://example.com/a.png' },
        });
    });

    it('converts flat-string `image_url` parts', () => {
        const messages = [
            {
                content: [
                    {
                        type: 'image_url',
                        image_url: 'https://example.com/flat.png',
                    },
                ],
            },
        ];

        coerceImageContentParts(messages);

        expect(messages[0]!.content[0]).toEqual({
            type: 'image',
            source: { type: 'url', url: 'https://example.com/flat.png' },
        });
    });

    it('parses data URIs into base64 image sources', () => {
        const messages = [
            {
                content: [
                    {
                        image_url: {
                            url: 'data:image/png;base64,QUJD',
                        },
                    },
                ],
            },
        ];

        coerceImageContentParts(messages);

        expect(messages[0]!.content[0]).toEqual({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'QUJD',
            },
        });
    });

    it('leaves native Anthropic image blocks unchanged', () => {
        const native = {
            type: 'image',
            source: { type: 'file', file_id: 'file_1' },
        };
        const messages = [{ content: [native] }];

        coerceImageContentParts(messages);

        expect(messages[0]!.content[0]).toBe(native);
    });

    it('leaves non-image content parts unchanged', () => {
        const messages = [
            {
                content: [
                    { type: 'text', text: 'hello' },
                    { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
                ],
            },
        ];

        coerceImageContentParts(messages);

        expect(messages[0]!.content).toEqual([
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
        ]);
    });
});
