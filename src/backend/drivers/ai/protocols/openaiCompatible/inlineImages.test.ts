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
import {
    inlineHttpImageUrls,
    inlineHttpVideoUrls,
    MAX_IMAGE_BYTES,
    MAX_INLINE_IMAGES,
    MAX_INLINE_VIDEOS,
    MAX_VIDEO_BYTES,
} from './inlineImages.js';

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
    const headers = new Headers();
    if (contentType) headers.set('content-type', contentType);
    if (contentLength) headers.set('content-length', contentLength);
    return new Response(Buffer.isBuffer(body) ? body : Buffer.from(body), {
        status,
        headers,
    });
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
            { signal: expect.any(AbortSignal) },
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

    it('stops reading an undeclared body at the cap', async () => {
        let pulled = 0;
        const endless = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled += 1;
                controller.enqueue(new Uint8Array(1024 * 1024));
            },
        });
        mockedSecureFetch.mockResolvedValueOnce(
            new Response(endless, {
                headers: { 'content-type': 'image/png' },
            }),
        );

        const messages = [
            {
                role: 'user',
                content: [
                    { image_url: { url: 'https://example.com/endless.png' } },
                ],
            },
        ];

        await inlineHttpImageUrls(messages);

        const part = messages[0].content[0] as { type?: string; text?: string };
        expect(part.type).toBe('text');
        expect(part.text).toContain('exceeds maximum');
        // One chunk past the cap, not the whole stream.
        expect(pulled).toBeLessThanOrEqual(
            Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024)) + 2,
        );
    });

    it('replaces a response with no declared type with a text error block', async () => {
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(Buffer.from([1, 2, 3]), { contentType: null }),
        );

        const messages = [
            {
                role: 'user',
                content: [{ image_url: { url: 'https://example.com/blob' } }],
            },
        ];

        await inlineHttpImageUrls(messages);

        const part = messages[0].content[0] as { type?: string; text?: string };
        expect(part.type).toBe('text');
        expect(part.text).toContain('unknown MIME type');
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
        expect(part.text).toContain('failed to fetch image');
        expect(part.text).not.toContain('boom');
    });

    it('skips a non-string image url instead of throwing', async () => {
        const messages = [
            {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url: 5 } }],
            },
        ];

        await inlineHttpImageUrls(messages as never);

        expect(mockedSecureFetch).not.toHaveBeenCalled();
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


describe('remote image bounds', () => {
    afterEach(() => mockedSecureFetch.mockReset());

    it('caps remote image count and limits concurrent fetches', async () => {
        let active = 0;
        let peak = 0;
        mockedSecureFetch.mockImplementation(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--;
            return buildResponse(Buffer.from('image'));
        });
        const parts = Array.from({ length: MAX_INLINE_IMAGES + 2 }, () => ({
            image_url: { url: 'https://example.com/image.png' },
        }));
        await inlineHttpImageUrls([{ content: parts }]);
        expect(mockedSecureFetch).toHaveBeenCalledTimes(MAX_INLINE_IMAGES);
        expect(peak).toBe(4);
        expect(parts[MAX_INLINE_IMAGES]).toMatchObject({ type: 'text' });
    });

    it('cancels a chunked body as soon as it exceeds the byte cap', async () => {
        const cancel = vi.fn();
        let pulls = 0;
        const body = new ReadableStream({
            pull(controller) {
                pulls++;
                controller.enqueue(new Uint8Array(1_000_000));
            },
            cancel,
        }, { highWaterMark: 0 });
        mockedSecureFetch.mockResolvedValue(new Response(body, {
            headers: { 'content-type': 'image/png' },
        }));
        const part = { image_url: { url: 'https://example.com/image.png' } };
        await inlineHttpImageUrls([{ content: [part] }]);
        expect(cancel).toHaveBeenCalledOnce();
        expect(pulls).toBeLessThanOrEqual(7);
        expect(part).toMatchObject({ type: 'text', text: expect.stringContaining('exceeds maximum') });
    });

    it('cancels bodies rejected by declared size or MIME type before reading', async () => {
        for (const headers of [
            { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) },
            { 'content-type': 'text/html' },
        ]) {
            const cancel = vi.fn();
            const pull = vi.fn();
            mockedSecureFetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel, pull }, { highWaterMark: 0 }), { headers }));
            await inlineHttpImageUrls([{ content: [{ image_url: { url: 'https://example.com/image' } }] }]);
            expect(cancel).toHaveBeenCalledOnce();
            expect(pull).not.toHaveBeenCalled();
        }
    });
});

describe('inlineHttpVideoUrls', () => {
    afterEach(() => {
        mockedSecureFetch.mockReset();
    });

    const videoMessages = (...urls: string[]) => [
        {
            role: 'user',
            content: urls.map((url) => ({
                type: 'video_url',
                video_url: { url },
            })) as Array<Record<string, unknown>>,
        },
    ];

    it('rewrites an http(s) video URL to a base64 data URL', async () => {
        const body = Buffer.from('video-bytes');
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(body, { contentType: 'video/mp4' }),
        );
        const messages = videoMessages('https://example.com/a.mp4');

        await inlineHttpVideoUrls(messages);

        expect(messages[0]!.content[0]).toEqual({
            type: 'video_url',
            video_url: {
                url: `data:video/mp4;base64,${body.toString('base64')}`,
            },
        });
    });

    it('takes the type from the extension when the host declares none', async () => {
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(Buffer.from('v'), {
                contentType: 'application/octet-stream',
            }),
        );
        const messages = videoMessages('https://example.com/clip.MOV?sig=1');

        await inlineHttpVideoUrls(messages);

        expect(
            (messages[0]!.content[0]!.video_url as { url: string }).url,
        ).toMatch(/^data:video\/quicktime;base64,/);
    });

    it('replaces a URL that is not a video with a text error', async () => {
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(Buffer.from('<html>'), { contentType: 'text/html' }),
        );
        const messages = videoMessages('https://example.com/page');

        await inlineHttpVideoUrls(messages);

        expect(messages[0]!.content[0]).toEqual({
            type: 'text',
            text: '{error: expected a video, got text/html; the user did not write this message}',
        });
    });

    it('replaces a video over the size cap with a text error', async () => {
        mockedSecureFetch.mockResolvedValueOnce(
            buildResponse(Buffer.from('v'), {
                contentType: 'video/mp4',
                contentLength: String(MAX_VIDEO_BYTES + 1),
            }),
        );
        const messages = videoMessages('https://example.com/big.mp4');

        await inlineHttpVideoUrls(messages);

        expect(messages[0]!.content[0]).toEqual({
            type: 'text',
            text: `{error: video exceeds maximum of ${MAX_VIDEO_BYTES} bytes; the user did not write this message}`,
        });
    });

    it('hides why a fetch failed', async () => {
        mockedSecureFetch.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.1'));
        const messages = videoMessages('https://example.com/a.mp4');

        await inlineHttpVideoUrls(messages);

        expect(messages[0]!.content[0]!.text).toBe(
            '{error: failed to fetch video; the user did not write this message}',
        );
    });

    it('fetches at most the capped number of videos and leaves data URLs alone', async () => {
        mockedSecureFetch.mockImplementation(async () =>
            buildResponse(Buffer.from('v'), { contentType: 'video/webm' }),
        );
        const urls = Array.from(
            { length: MAX_INLINE_VIDEOS + 1 },
            (_, i) => `https://example.com/${i}.webm`,
        );
        const messages = videoMessages('data:video/mp4;base64,AAAA', ...urls);

        await inlineHttpVideoUrls(messages);

        expect(mockedSecureFetch).toHaveBeenCalledTimes(MAX_INLINE_VIDEOS);
        expect(messages[0]!.content[0]).toEqual({
            type: 'video_url',
            video_url: { url: 'data:video/mp4;base64,AAAA' },
        });
        expect(messages[0]!.content.at(-1)).toEqual({
            type: 'text',
            text: `{error: maximum of ${MAX_INLINE_VIDEOS} remote videos per request; the user did not write this message}`,
        });
    });
});
