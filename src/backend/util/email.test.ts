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
import { cleanEmail, isBlockedEmail } from './email.ts';

describe('cleanEmail', () => {
    it('lowercases the whole address', () => {
        expect(cleanEmail('Foo.Bar@Example.COM')).toBe('foo.bar@example.com');
    });

    it('strips subaddressing for every provider by default', () => {
        expect(cleanEmail('foo+newsletter@example.com')).toBe(
            'foo@example.com',
        );
    });

    it('drops dots and subaddressing for gmail', () => {
        expect(cleanEmail('foo.bar+tag@gmail.com')).toBe('foobar@gmail.com');
    });

    it('collapses googlemail.com onto gmail.com before applying gmail rules', () => {
        expect(cleanEmail('foo.bar@googlemail.com')).toBe('foobar@gmail.com');
    });

    it('drops dots for icloud too', () => {
        expect(cleanEmail('foo.bar@icloud.com')).toBe('foobar@icloud.com');
    });

    it('keeps `+` for yahoo, which treats it as significant', () => {
        expect(cleanEmail('foo+tag@yahoo.com')).toBe('foo+tag@yahoo.com');
        expect(cleanEmail('foo.bar+tag@yahoo.co.uk')).toBe(
            'foo.bar+tag@yahoo.co.uk',
        );
    });

    it('leaves dots alone for providers with no dot rule', () => {
        expect(cleanEmail('foo.bar@example.com')).toBe('foo.bar@example.com');
    });

    it('returns the lowercased input when there is no domain part', () => {
        expect(cleanEmail('NoAtSign')).toBe('noatsign');
    });
});

describe('isBlockedEmail', () => {
    it('is false when no block list is configured', () => {
        expect(isBlockedEmail('a@mailinator.com', undefined)).toBe(false);
        expect(isBlockedEmail('a@mailinator.com', [])).toBe(false);
    });

    it('blocks an exact domain match', () => {
        expect(isBlockedEmail('a@mailinator.com', ['mailinator.com'])).toBe(
            true,
        );
    });

    it('blocks subdomains via suffix matching', () => {
        expect(isBlockedEmail('a@sub.mailinator.com', ['mailinator.com'])).toBe(
            true,
        );
    });

    it('allows an unlisted domain', () => {
        expect(isBlockedEmail('a@example.com', ['mailinator.com'])).toBe(false);
    });

    it('matches on the cleaned address, so aliasing cannot bypass the list', () => {
        expect(
            isBlockedEmail('A.B+tag@MAILINATOR.com', ['mailinator.com']),
        ).toBe(true);
    });
});
