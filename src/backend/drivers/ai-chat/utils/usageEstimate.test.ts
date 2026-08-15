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
});

describe('estimatePromptTokens', () => {
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

    it('is zero for nothing at all', () => {
        expect(estimatePromptTokens([])).toBe(0);
        expect(estimatePromptTokens(undefined)).toBe(0);
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
