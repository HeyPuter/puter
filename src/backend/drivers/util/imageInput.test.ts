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
import { fetchImageAsBase64, fetchImageBytes } from './imageInput.js';

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
        });
        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://example.com/image',
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
});
