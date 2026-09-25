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

import { describe, it, expect } from 'vitest';
import { append_signed_item_params } from './appendSignedItemParams.js';

const readOnlySignature = {
    uid: 'uid-1',
    fsentry_name: 'shared.txt',
    read_url: 'https://api.puter.test/file?uid=uid-1&signature=read',
    // write_url intentionally absent — the backend strips it for a read-only share.
    metadata_url: 'https://api.puter.test/itemMetadata?uid=uid-1&signature=read',
    fsentry_size: 12,
    fsentry_accessed: 1,
    fsentry_modified: 2,
    fsentry_created: 3,
    path: '/owner/shared.txt',
};

describe('append_signed_item_params', () => {
    // Appending an absent write_url stringifies it to a truthy, invalid "undefined" that stops the editor opening; it must be omitted.
    it('omits write_url for a read-only share instead of forwarding "undefined"', () => {
        const params = new URLSearchParams();
        append_signed_item_params(params, readOnlySignature, '/owner/shared.txt');

        expect(params.has('puter.item.write_url')).toBe(false);
        expect(params.get('puter.item.write_url')).toBeNull();
        expect(params.get('puter.item.read_url')).toBe(readOnlySignature.read_url);
    });

    it('forwards write_url when the share grants write', () => {
        const params = new URLSearchParams();
        append_signed_item_params(
            params,
            { ...readOnlySignature, write_url: 'https://api.puter.test/writeFile?uid=uid-1&signature=write' },
            '/owner/shared.txt',
        );

        expect(params.get('puter.item.write_url')).toBe(
            'https://api.puter.test/writeFile?uid=uid-1&signature=write',
        );
    });

    it('advertises the passed path rather than the signature path', () => {
        const params = new URLSearchParams();
        append_signed_item_params(params, readOnlySignature, '~/shared.txt');
        expect(params.get('puter.item.path')).toBe('~/shared.txt');
    });
});
