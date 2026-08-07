/**
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

/**
 * Unit tests for the shared `input_images` helpers used by the image providers.
 * `secureFetch` is stubbed — it is the SSRF-guarded network egress point and
 * the only external dependency here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchImageAsBase64,
    isHttpUrl,
    parseDataUri,
    resolveSingleInputImage,
    toBase64DataUri,
} from './inputImage.js';

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));

vi.mock('../../util/secureHttp.js', () => ({ secureFetch: secureFetchMock }));

const fetchResponse = (
    body: Buffer,
    {
        ok = true,
        status = 200,
        contentType = 'image/png',
    }: { ok?: boolean; status?: number; contentType?: string | null } = {},
) => ({
    ok,
    status,
    headers: {
        get: (name: string) => (name === 'content-type' ? contentType : null),
    },
    arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

beforeEach(() => {
    secureFetchMock.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// -- isHttpUrl -------------------------------------------------------

describe('isHttpUrl', () => {
    it('accepts http and https prefixes only', () => {
        expect(isHttpUrl('http://example.com/a.png')).toBe(true);
        expect(isHttpUrl('https://example.com/a.png')).toBe(true);
        expect(isHttpUrl('data:image/png;base64,AAAA')).toBe(false);
        expect(isHttpUrl('ftp://example.com/a.png')).toBe(false);
        expect(isHttpUrl('AAAA')).toBe(false);
    });
});

// -- resolveSingleInputImage -----------------------------------------

describe('resolveSingleInputImage', () => {
    it('returns undefined when neither field is supplied', () => {
        expect(resolveSingleInputImage({}, 'TestProvider')).toBeUndefined();
    });

    it('prefers the singular input_image over input_images', () => {
        expect(
            resolveSingleInputImage(
                { input_image: 'singular', input_images: ['plural'] },
                'TestProvider',
            ),
        ).toBe('singular');
    });

    it('falls back to the single input_images entry', () => {
        expect(
            resolveSingleInputImage({ input_images: ['only'] }, 'TestProvider'),
        ).toBe('only');
    });

    it('returns undefined for an empty input_images array', () => {
        expect(
            resolveSingleInputImage({ input_images: [] }, 'TestProvider'),
        ).toBeUndefined();
    });

    it('throws 400 naming the provider when more than one image is supplied', () => {
        try {
            resolveSingleInputImage(
                { input_images: ['a', 'b'] },
                'TestProvider',
            );
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect((err as Error).message).toContain(
                'TestProvider supports only a single input image',
            );
        }
    });
});

// -- parseDataUri ----------------------------------------------------

describe('parseDataUri', () => {
    it('splits mime and payload out of a base64 data URI', () => {
        expect(parseDataUri('data:image/jpeg;base64,QUJD')).toEqual({
            base64: 'QUJD',
            mime: 'image/jpeg',
        });
    });

    it('defaults the mime to image/png when the URI omits it', () => {
        expect(parseDataUri('data:;base64,QUJD')).toEqual({
            base64: 'QUJD',
            mime: 'image/png',
        });
    });

    it('handles a data URI with no base64 marker', () => {
        expect(parseDataUri('data:image/png,QUJD')).toEqual({
            base64: 'QUJD',
            mime: 'image/png',
        });
    });

    it('returns null for anything that is not a data URI', () => {
        expect(parseDataUri('https://example.com/a.png')).toBeNull();
        expect(parseDataUri('QUJD')).toBeNull();
    });
});

// -- fetchImageAsBase64 ----------------------------------------------

describe('fetchImageAsBase64', () => {
    it('returns the fetched bytes as base64 with the response content-type', async () => {
        const body = Buffer.from([1, 2, 3, 4]);
        secureFetchMock.mockResolvedValueOnce(
            fetchResponse(body, { contentType: 'image/webp; charset=binary' }),
        );

        const result = await fetchImageAsBase64('https://example.com/a.webp');

        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://example.com/a.webp',
        );
        expect(result).toEqual({
            base64: body.toString('base64'),
            mime: 'image/webp',
        });
    });

    it('defaults the mime to image/png when the response has no content-type', async () => {
        secureFetchMock.mockResolvedValueOnce(
            fetchResponse(Buffer.from([0]), { contentType: null }),
        );

        expect((await fetchImageAsBase64('https://example.com/a')).mime).toBe(
            'image/png',
        );
    });

    it('throws 400 with the upstream status when the fetch is not ok', async () => {
        secureFetchMock.mockResolvedValueOnce(
            fetchResponse(Buffer.alloc(0), { ok: false, status: 404 }),
        );

        try {
            await fetchImageAsBase64('https://example.com/missing.png');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
            expect((err as Error).message).toBe(
                'Failed to fetch input image (status 404)',
            );
        }
    });
});

// -- toBase64DataUri -------------------------------------------------

describe('toBase64DataUri', () => {
    it('returns an existing data URI untouched without fetching', async () => {
        const uri = 'data:image/gif;base64,R0lGOD';
        expect(await toBase64DataUri(uri)).toBe(uri);
        expect(secureFetchMock).not.toHaveBeenCalled();
    });

    it('fetches an http(s) URL and wraps it with the response mime', async () => {
        const body = Buffer.from('img');
        secureFetchMock.mockResolvedValueOnce(
            fetchResponse(body, { contentType: 'image/jpeg' }),
        );

        expect(await toBase64DataUri('https://example.com/a.jpg')).toBe(
            `data:image/jpeg;base64,${body.toString('base64')}`,
        );
    });

    it('wraps raw base64 with image/png by default', async () => {
        expect(await toBase64DataUri('QUJD')).toBe(
            'data:image/png;base64,QUJD',
        );
        expect(secureFetchMock).not.toHaveBeenCalled();
    });

    it('honours an explicit mime hint for raw base64', async () => {
        expect(await toBase64DataUri('QUJD', 'image/webp')).toBe(
            'data:image/webp;base64,QUJD',
        );
    });

    it('propagates a failed remote fetch rather than producing an empty image', async () => {
        secureFetchMock.mockResolvedValueOnce(
            fetchResponse(Buffer.alloc(0), { ok: false, status: 500 }),
        );

        await expect(
            toBase64DataUri('https://example.com/boom.png'),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});
