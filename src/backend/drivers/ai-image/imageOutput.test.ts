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
import { imageDataUri } from './imageOutput.js';

describe('imageDataUri', () => {
    it.each([
        ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
        ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
        ['webp', Buffer.from('RIFF0000WEBP')],
    ])('labels %s bytes without changing the payload', (format, bytes) => {
        const base64 = Buffer.from(bytes).toString('base64');
        expect(imageDataUri(base64)).toBe(
            `data:image/${format};base64,${base64}`,
        );
    });

    it('uses the model fallback for an unknown signature', () => {
        expect(imageDataUri('AAAA', 'image/jpeg')).toBe(
            'data:image/jpeg;base64,AAAA',
        );
    });

    it('labels svg when the root sits beyond the first bytes', () => {
        // `<?xml ...?>` pushes `<svg` past fixed-offset magic-number range, so
        // the sniff has to scan the full 8 KB window rather than the head only.
        const svg =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<svg xmlns="http://www.w3.org/2000/svg">' +
            '<rect width="10" height="10"/></svg>';
        const base64 = Buffer.from(svg).toString('base64');
        expect(imageDataUri(base64)).toBe(
            `data:image/svg+xml;base64,${base64}`,
        );
    });
});
