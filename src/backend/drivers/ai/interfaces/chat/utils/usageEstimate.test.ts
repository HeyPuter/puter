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
    estimateOutputTokens,
    estimatePromptTokens,
    estimateTextTokens,
    estimateToolTokens,
} from './usageEstimate.js';

// A ~150KB base64 payload — the shape a client sends video frames in.
const base64Image = (bytes: number) =>
    `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / (3 / 4)))}`;

describe('estimateTextTokens', () => {
    it('is zero for empty text', () => {
        expect(estimateTextTokens('')).toBe(0);
    });

    it('scales with length', () => {
        const short = estimateTextTokens('hello world');
        const long = estimateTextTokens('hello world '.repeat(100));
        expect(long).toBeGreaterThan(short);
    });

    it('counts words the way splitting on \\s+ does', () => {
        const splitEstimate = (text: string) =>
            Math.floor(
                (text.length / 4 + text.split(/\s+/).length * (4 / 3)) / 2,
            );
        for (const text of [
            'a',
            ' a',
            'a ',
            '  a  b\t\nc  ',
            'x y z w     　﻿v',
            'é ü 日本語 テキスト',
            '\r\n\v\f',
        ]) {
            expect(estimateTextTokens(text), JSON.stringify(text)).toBe(
                splitEstimate(text),
            );
        }
    });

    it('gives text past the scan budget the word density scanned so far', () => {
        const text = 'ab cd '.repeat(1000);
        const budget = { chars: 12, scannedChars: 0, scannedRuns: 0 };
        // Uniform text extrapolates to the full count.
        expect(estimateTextTokens(text, budget)).toBe(estimateTextTokens(text));
        expect(budget.chars).toBe(0);
        // A later part with no budget left takes the same density.
        expect(estimateTextTokens(text, budget)).toBe(estimateTextTokens(text));
    });
});

describe('estimatePromptTokens', () => {
    it('scans a bounded amount of text per prompt', () => {
        // Many parts, each under the budget alone, past it together; the
        // unscanned ones are extrapolated, which is exact for uniform text.
        const part = 'lorem ipsum dolor '.repeat(30_000);
        const parts = Array.from({ length: 8 }, () => ({ text: part }));
        expect(estimatePromptTokens([{ role: 'user', content: parts }])).toBe(
            8 * estimateTextTokens(part),
        );
    });

    it('counts plain string content', () => {
        const tokens = estimatePromptTokens([
            { role: 'user', content: 'a fairly ordinary sentence to price' },
        ]);
        expect(tokens).toBeGreaterThan(0);
    });

    it('counts normalized text parts', () => {
        const tokens = estimatePromptTokens([
            {
                role: 'user',
                content: [{ type: 'text', text: 'describe this frame' }],
            },
        ]);
        expect(tokens).toBeGreaterThan(0);
    });

    // The leak this estimator exists for: a prompt made almost entirely of
    // image data used to price as an empty one, so an account with nothing
    // left could still send it.
    it('prices an inline image on its payload size, not as free', () => {
        const tokens = estimatePromptTokens([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'what is happening here?' },
                    {
                        type: 'image_url',
                        image_url: { url: base64Image(150_000) },
                    },
                ],
            },
        ]);
        expect(tokens).toBeGreaterThan(900);
    });

    it('scales with the number of frames attached', () => {
        const frame = {
            type: 'image_url',
            image_url: { url: base64Image(150_000) },
        };
        const one = estimatePromptTokens([
            { role: 'user', content: [frame] },
        ]);
        const ten = estimatePromptTokens([
            { role: 'user', content: Array.from({ length: 10 }, () => frame) },
        ]);
        expect(ten).toBeGreaterThan(one * 9);
    });

    it('prices Anthropic-style base64 sources', () => {
        const tokens = estimatePromptTokens([
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: 'A'.repeat(200_000),
                        },
                    },
                ],
            },
        ]);
        expect(tokens).toBeGreaterThan(900);
    });

    it('charges a flat estimate for attachments it cannot measure', () => {
        const remote = estimatePromptTokens([
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: 'https://example.com/cat.png' },
                    },
                ],
            },
        ]);
        const fsRef = estimatePromptTokens([
            {
                role: 'user',
                content: [{ puter_path: '/user/Desktop/scan.pdf' }],
            },
        ]);
        expect(remote).toBeGreaterThan(0);
        expect(fsRef).toBeGreaterThan(0);
    });

    it('counts tool traffic as the text it serializes to', () => {
        const tokens = estimatePromptTokens([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 't1',
                        name: 'search',
                        input: { query: 'a'.repeat(4000) },
                    },
                ],
            },
        ]);
        expect(tokens).toBeGreaterThan(100);
    });

    describe('tool results', () => {
        const base64 = 'A'.repeat(2_000_000);
        const image = {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64 },
        };
        const toolResult = (content: unknown) => [
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 't1', content }],
            },
        ];
        const topLevel = (part: unknown) =>
            estimatePromptTokens([{ role: 'user', content: [part] }]);

        it('prices an image inside a tool result like a top-level image, not as its base64 text', () => {
            const nested = estimatePromptTokens(toolResult([image]));
            expect(nested).toBe(topLevel(image));
            // 1.5 MB of image at 150 bytes a token.
            expect(nested).toBe(10_000);
        });

        it('keeps nine screenshots in a tool result near what the images cost', () => {
            const tokens = estimatePromptTokens(
                toolResult(Array.from({ length: 9 }, () => image)),
            );
            expect(tokens).toBe(90_000);
        });

        it('prices an OpenAI-style image part inside a tool result as an attachment', () => {
            const part = {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${base64}` },
            };
            expect(estimatePromptTokens(toolResult([part]))).toBe(topLevel(part));
        });

        it('adds the text blocks around an image to its estimate', () => {
            const text = { type: 'text', text: 'word '.repeat(2000) };
            const textOnly = estimatePromptTokens(toolResult([text]));
            expect(textOnly).toBeGreaterThan(1000);
            expect(estimatePromptTokens(toolResult([text, image]))).toBe(
                textOnly + 10_000,
            );
        });

        it('still counts text, strings and other blocks as the text they serialize to', () => {
            const sentence = 'tool output '.repeat(500);
            const asString = estimatePromptTokens(toolResult(sentence));
            expect(asString).toBeGreaterThan(500);
            expect(estimatePromptTokens(toolResult([sentence]))).toBe(asString);
            expect(
                estimatePromptTokens(
                    toolResult([{ type: 'search_result', title: sentence }]),
                ),
            ).toBeGreaterThanOrEqual(asString);
            expect(estimatePromptTokens(toolResult(undefined))).toBe(0);
        });
    });

    // Model-output shapes come back around as history in multi-turn
    // conversations. They are text; falling through to the attachment
    // default would price a few sentences of reasoning like a full frame
    // and 402 accounts that could easily afford their prompt.
    it('prices replayed thinking/reasoning/refusal blocks as their text', () => {
        const sentence = 'a short run of replayed reasoning text';
        const asText = estimatePromptTokens([
            { role: 'assistant', content: [{ type: 'text', text: sentence }] },
        ]);
        for (const part of [
            { type: 'thinking', thinking: sentence },
            { type: 'reasoning', reasoning: sentence },
            { type: 'refusal', refusal: sentence },
        ]) {
            expect(
                estimatePromptTokens([{ role: 'assistant', content: [part] }]),
            ).toBe(asText);
        }
    });

    it('counts a replayed fallback marker as no tokens', () => {
        expect(
            estimatePromptTokens([
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'fallback',
                            from: { model: 'claude-opus-5-5' },
                            to: { model: 'claude-opus-4-8' },
                        },
                    ],
                },
            ]),
        ).toBe(0);
    });

    it('is zero for nothing at all', () => {
        expect(estimatePromptTokens([])).toBe(0);
        expect(estimatePromptTokens(undefined)).toBe(0);
    });
});

describe('estimatePromptTokens compaction blocks', () => {
    const withCompaction = (encrypted_content: unknown) => [
        { role: 'assistant', content: [{ type: 'compaction', encrypted_content }] },
    ];

    it('counts the encrypted content as text', () => {
        expect(estimatePromptTokens(withCompaction('a'.repeat(400)))).toBe(
            estimateTextTokens('a'.repeat(400)),
        );
    });

    it('counts content that is not a string by its JSON', () => {
        expect(
            estimatePromptTokens(withCompaction({ toString: null, blob: 'abcdefgh' })),
        ).toBe(estimateTextTokens('{"toString":null,"blob":"abcdefgh"}'));
    });
});

describe('estimateToolTokens', () => {
    it('is zero for no tools', () => {
        expect(estimateToolTokens(undefined)).toBe(0);
        expect(estimateToolTokens([])).toBe(0);
    });

    it('estimates from the serialized JSON', () => {
        const tools = [
            { name: 'lookup', input_schema: { type: 'object' } },
            { name: 'search', input_schema: { type: 'object' } },
        ];
        expect(estimateToolTokens(tools)).toBe(
            estimateTextTokens(JSON.stringify(tools)),
        );
    });
});

describe('estimateOutputTokens', () => {
    it('is zero when nothing was emitted', () => {
        expect(estimateOutputTokens(0)).toBe(0);
        expect(estimateOutputTokens(Number.NaN)).toBe(0);
    });

    it('converts characters to tokens', () => {
        expect(estimateOutputTokens(400)).toBe(100);
    });
});
