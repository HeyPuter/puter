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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchImageAsBase64,
    fetchImageBytes,
    parseDataUri,
} from './imageInput.js';

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));
vi.mock('../../util/secureHttp.js', () => ({ secureFetch: secureFetchMock }));
beforeEach(() => secureFetchMock.mockReset());

describe('image downloads', () => {
    it('keeps binary bytes for multipart consumers', async () => {
        secureFetchMock.mockResolvedValueOnce(
            new Response(new Uint8Array([1, 2, 3]), {
                headers: { 'content-type': 'image/webp; charset=binary' },
            }),
        );
        const result = await fetchImageBytes('https://example.com/image');
        expect(result).toEqual({
            bytes: Buffer.from([1, 2, 3]),
            mime: 'image/webp',
            declaredMime: 'image/webp',
        });
        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://example.com/image',
            { signal: expect.any(AbortSignal) },
        );
    });
    it('retains base64 output for existing callers and the default MIME', async () => {
        secureFetchMock.mockResolvedValueOnce(
            new Response(new Uint8Array([1, 2, 3])),
        );
        expect(await fetchImageAsBase64('https://example.com/image')).toEqual({
            base64: 'AQID',
            mime: 'image/png',
        });
    });
    it('rejects an unsuccessful download', async () => {
        secureFetchMock.mockResolvedValueOnce(
            new Response(null, { status: 404 }),
        );
        await expect(
            fetchImageBytes('https://example.com/image'),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses a declared length over the cap without reading the body', async () => {
        let pulled = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled += 1;
                controller.enqueue(new Uint8Array(8));
            },
        });
        secureFetchMock.mockResolvedValueOnce(
            new Response(body, { headers: { 'content-length': '101' } }),
        );
        await expect(
            fetchImageBytes('https://example.com/image', { maxBytes: 100 }),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: 'input_too_large',
        });
        // The stream primes one pull on construction; none after that.
        expect(pulled).toBeLessThanOrEqual(1);
    });
    it('stops reading an undeclared body at the cap', async () => {
        let pulled = 0;
        const endless = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled += 1;
                controller.enqueue(new Uint8Array(64));
            },
        });
        secureFetchMock.mockResolvedValueOnce(new Response(endless));
        await expect(
            fetchImageBytes('https://example.com/image', { maxBytes: 100 }),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: 'input_too_large',
        });
        expect(pulled).toBeLessThanOrEqual(4);
    });
    it('gives up on a slow host with a 400 rather than waiting it out', async () => {
        secureFetchMock.mockImplementationOnce(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () =>
                        reject(init.signal.reason),
                    );
                }),
        );
        await expect(
            fetchImageBytes('https://example.com/image', { timeoutMs: 20 }),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message: expect.stringMatching(/timed out/i),
        });
    });
});

describe('parseDataUri (input images)', () => {
    it('returns the base64 payload and declared mime', () => {
        expect(parseDataUri('data:image/webp;base64,AQID')).toEqual({
            base64: 'AQID',
            mime: 'image/webp',
        });
    });
    it('defaults the mime to image/png', () => {
        expect(parseDataUri('data:;base64,AQID')).toEqual({
            base64: 'AQID',
            mime: 'image/png',
        });
    });
    it('reads a base64 flag that follows other parameters', () => {
        expect(
            parseDataUri('data:image/png;charset=binary;base64,AQID'),
        ).toEqual({ base64: 'AQID', mime: 'image/png' });
    });
    it('returns null for anything that is not a data URI', () => {
        expect(parseDataUri('https://example.com/a.png')).toBeNull();
        expect(parseDataUri('AQID')).toBeNull();
    });
});
