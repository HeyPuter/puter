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
import { jsonWithStreamedBase64 } from './geminiRest.js';

const PLACEHOLDER = '\u0000media-placeholder';

const split = (bytes: Buffer, sizes: number[]): Buffer[] => {
    const chunks: Buffer[] = [];
    let at = 0;
    for (const size of sizes) {
        chunks.push(bytes.subarray(at, at + size));
        at += size;
    }
    if (at < bytes.length) chunks.push(bytes.subarray(at));
    return chunks;
};

const render = async (body: object, chunks: Buffer[]) => {
    const byteLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const streamed = jsonWithStreamedBase64(body, {
        placeholder: PLACEHOLDER,
        chunks,
        byteLength,
    });
    const sent = Buffer.from(await new Response(streamed.stream).arrayBuffer());
    return { sent, byteLength: streamed.byteLength };
};

describe('jsonWithStreamedBase64', () => {
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    // Non-ASCII text checks the length is counted in bytes, not characters.
    const body = (data: string) => ({
        input: [
            { type: 'video', mime_type: 'video/mp4', data },
            { type: 'text', text: 'Make the dog a dinosaur 🦖, über schnell' },
        ],
    });

    it.each([
        ['one chunk', []],
        ['byte-sized chunks', Array.from({ length: 1000 }, () => 1)],
        ['chunks that split 3-byte groups', [1, 2, 4, 5, 7, 11, 13, 500]],
        ['empty chunks', [0, 3, 0, 0, 2]],
    ])('matches the buffered JSON exactly with %s', async (_label, sizes) => {
        const expected = Buffer.from(
            JSON.stringify(body(bytes.toString('base64'))),
        );
        const { sent, byteLength } = await render(
            body(PLACEHOLDER),
            split(bytes, sizes as number[]),
        );
        expect(sent.equals(expected)).toBe(true);
        expect(byteLength).toBe(expected.length);
    });

    it.each([0, 1, 2, 3, 4])('pads a %s-byte payload', async (length) => {
        const payload = bytes.subarray(0, length);
        const { sent, byteLength } = await render(body(PLACEHOLDER), [payload]);
        const expected = JSON.stringify(body(payload.toString('base64')));
        expect(sent.toString()).toBe(expected);
        expect(byteLength).toBe(Buffer.byteLength(expected));
    });

    it('refuses a body without the placeholder or with it twice', () => {
        const media = { placeholder: PLACEHOLDER, chunks: [], byteLength: 0 };
        expect(() => jsonWithStreamedBase64({ a: 'b' }, media)).toThrow();
        expect(() =>
            jsonWithStreamedBase64({ a: PLACEHOLDER, b: PLACEHOLDER }, media),
        ).toThrow();
    });
});
