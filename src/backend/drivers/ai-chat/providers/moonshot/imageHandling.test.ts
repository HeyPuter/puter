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

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../util/secureHttp.js', () => ({
    secureFetch: vi.fn(),
}));

import { secureFetch } from '../../../../util/secureHttp.js';
import { inlineHttpImageUrls, MAX_IMAGE_BYTES } from './imageHandling.js';

const mockedSecureFetch = vi.mocked(secureFetch);

const buildResponse = (
    body: Buffer | ArrayBuffer,
    {
        status = 200,
        contentType = 'image/png',
        contentLength,
    }: {
        status?: number;
        contentType?: string | null;
        contentLength?: string;
    } = {},
): Response => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const headers = new Headers();
    if (contentType) headers.set('content-type', contentType);
    if (contentLength) headers.set('content-length', contentLength);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        arrayBuffer: async () =>
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response;
};

describe('inlineHttpImageUrls', () => {
    afterEach(() => {
        mockedSecureFetch.mockReset();
    });

    it('rewrites http(s) image URLs to base64 data URIs', async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(png, { contentType: 'image/png' }),
        );

        const messages = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'what is this' },
                    { image_url: { url: 'https://example.com/cat.png' } },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        expect(mockedSecureFetch).toHaveBeenCalledWith(
            'https://example.com/cat.png',
        );
        const part = messages[0].content[1] as {
            type?: string;
            image_url?: { url?: string };
        };
        expect(part.type).toBe('image_url');
        expect(part.image_url?.url).toBe(
            `data:image/png;base64,${png.toString('base64')}`,
        );
    });

    it('leaves data URIs untouched and skips fetching', async () => {
        const messages = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: 'data:image/png;base64,AAAA',
                        },
                    },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        expect(mockedSecureFetch).not.toHaveBeenCalled();
        const part = messages[0].content[0] as { image_url?: { url?: string } };
        expect(part.image_url?.url).toBe('data:image/png;base64,AAAA');
    });

    it('replaces oversized images with a text error block', async () => {
        const oversize = Buffer.alloc(10);
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(oversize, {
                contentType: 'image/jpeg',
                contentLength: String(MAX_IMAGE_BYTES + 1),
            }),
        );

        const messages = [
            {
                role: 'user',
                content: [
                    { image_url: { url: 'https://example.com/huge.jpg' } },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        const part = messages[0].content[0] as {
            type?: string;
            text?: string;
            image_url?: unknown;
        };
        expect(part.type).toBe('text');
        expect(part.image_url).toBeUndefined();
        expect(part.text).toContain('exceeds maximum');
    });

    it('replaces non-image responses with a text error block', async () => {
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(Buffer.from('<html/>'), {
                contentType: 'text/html',
            }),
        );

        const messages = [
            {
                role: 'user',
                content: [
                    { image_url: { url: 'https://example.com/page' } },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        const part = messages[0].content[0] as {
            type?: string;
            text?: string;
        };
        expect(part.type).toBe('text');
        expect(part.text).toContain('expected an image');
    });

    it('replaces fetch failures with a text error block', async () => {
        mockedSecureFetch.mockRejectedValueOnce(new Error('boom'));

        const messages = [
            {
                role: 'user',
                content: [
                    { image_url: { url: 'https://example.com/x.png' } },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        const part = messages[0].content[0] as {
            type?: string;
            text?: string;
        };
        expect(part.type).toBe('text');
        expect(part.text).toContain('boom');
    });

    it('ignores non-image-url parts and string content', async () => {
        const messages = [
            { role: 'user', content: 'plain text' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'still here' },
                    { type: 'tool_use', id: 't', name: 'x', input: {} },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        expect(mockedSecureFetch).not.toHaveBeenCalled();
    });
});
