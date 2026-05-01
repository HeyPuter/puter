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

import { describe, expect, it } from 'vitest';
import { isPublicResolvedAddress, validateUrlNoIP } from './secureHttp.js';

describe('secureHttp URL validation', () => {
    it('rejects raw IP and localhost URLs before fetching', () => {
        expect(() => validateUrlNoIP('http://127.0.0.1/')).toThrow();
        expect(() => validateUrlNoIP('http://[::1]/')).toThrow();
        expect(() => validateUrlNoIP('http://localhost/')).toThrow();
        expect(() =>
            validateUrlNoIP('https://example.com/image.png'),
        ).not.toThrow();
    });
});

describe('secureHttp resolved address validation', () => {
    it('allows public resolved addresses', () => {
        for (const address of [
            '1.1.1.1',
            '8.8.8.8',
            '2001:4860:4860::8888',
            '2606:4700:4700::1111',
        ]) {
            expect(isPublicResolvedAddress(address)).toBe(true);
        }
    });

    it('rejects private, link-local, loopback, mapped, and reserved addresses', () => {
        for (const address of [
            '0.0.0.0',
            '10.0.0.1',
            '100.64.0.1',
            '127.0.0.1',
            '169.254.169.254',
            '172.16.0.1',
            '192.168.0.1',
            '198.18.0.1',
            '224.0.0.1',
            '255.255.255.255',
            '::',
            '::1',
            '::ffff:8.8.8.8',
            '0:0:0:0:0:ffff:8.8.8.8',
            '::ffff:808:808',
            'fc00::1',
            'fe80::1',
            'ff02::1',
        ]) {
            expect(isPublicResolvedAddress(address)).toBe(false);
        }
    });
});
