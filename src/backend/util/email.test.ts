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
import validator from 'validator';
import { cleanEmail, isBlockedEmail, isStorableEmail } from './email.ts';

describe('cleanEmail', () => {
    it('lowercases the whole address', () => {
        expect(cleanEmail('Foo.Bar@Example.COM')).toBe('foo.bar@example.com');
    });

    // `+` is a convention the receiving domain defines, not a rule of SMTP.
    it('keeps subaddressing on a domain whose semantics we do not know', () => {
        expect(cleanEmail('foo+newsletter@example.com')).toBe(
            'foo+newsletter@example.com',
        );
    });

    it('strips subaddressing for a provider that defines it', () => {
        expect(cleanEmail('foo+newsletter@outlook.com')).toBe(
            'foo@outlook.com',
        );
    });

    it('strips subaddressing on regional Microsoft domains', () => {
        expect(cleanEmail('Foo+x1@outlook.jp')).toBe('foo@outlook.jp');
        expect(cleanEmail('foo.bar+x@hotmail.co.uk')).toBe(
            'foo.bar@hotmail.co.uk',
        );
        expect(cleanEmail('foo+x@live.jp')).toBe('foo@live.jp');
    });

    it('strips subaddressing for the other providers that deliver tags', () => {
        expect(cleanEmail('foo+x@protonmail.ch')).toBe('foo@protonmail.ch');
        expect(cleanEmail('foo+x@zohomail.eu')).toBe('foo@zohomail.eu');
        expect(cleanEmail('foo+x@yandex.ru')).toBe('foo@yandex.ru');
    });

    it('drops dots and subaddressing for gmail', () => {
        expect(cleanEmail('foo.bar+tag@gmail.com')).toBe('foobar@gmail.com');
    });

    it('collapses googlemail.com onto gmail.com before applying gmail rules', () => {
        expect(cleanEmail('foo.bar@googlemail.com')).toBe('foobar@gmail.com');
    });

    // Apple allocates the exact string: both of these can have owners.
    it('keeps dots for icloud, which treats them as significant', () => {
        expect(cleanEmail('foo.bar@icloud.com')).toBe('foo.bar@icloud.com');
        expect(cleanEmail('foobar@icloud.com')).toBe('foobar@icloud.com');
        for (const domain of ['icloud.com', 'me.com', 'mac.com']) {
            expect(cleanEmail(`a.b@${domain}`)).not.toBe(
                cleanEmail(`ab@${domain}`),
            );
        }
    });

    it('still drops `+` for icloud, which does fold subaddressing', () => {
        expect(cleanEmail('foo.bar+tag@icloud.com')).toBe(
            'foo.bar@icloud.com',
        );
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

describe('isStorableEmail', () => {
    const markup = '"<img/src=x/onerror=alert(1)>"@example.com';

    it('refuses a quoted local part that carries markup', () => {
        // The reason this gate exists: the library on its own says yes.
        expect(validator.isEmail(markup)).toBe(true);
        expect(isStorableEmail(markup)).toBe(false);
    });

    it('refuses the bare metacharacters too', () => {
        for (const bad of ['a<b@example.com', 'a>b@example.com', 'a"b@example.com'])
            expect(isStorableEmail(bad)).toBe(false);
    });

    it('answers for a non-string instead of throwing', () => {
        // A throw where a public route reaches this is a 500, not a 400.
        expect(() => validator.isEmail(1 as unknown as string)).toThrow();
        for (const bad of [1, null, undefined, {}, []])
            expect(isStorableEmail(bad)).toBe(false);
    });

    it('still accepts addresses people actually have', () => {
        for (const good of [
            "o'brien@example.com",
            'a&b@example.com',
            'foo.bar+tag@gmail.com',
            'user_name-1@sub.example.co.uk',
        ])
            expect(isStorableEmail(good)).toBe(true);
    });
});
