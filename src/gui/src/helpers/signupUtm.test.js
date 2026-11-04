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
import {
    readSignupUtm,
    rememberSignupUtm,
    signupUtmQuery,
} from './signupUtm.js';

const query = (search) => new URLSearchParams(search);

const memoryStorage = () => {
    const items = new Map();
    return {
        getItem: (k) => (items.has(k) ? items.get(k) : null),
        setItem: (k, v) => items.set(k, String(v)),
    };
};

describe('readSignupUtm', () => {
    it('reads the known utm params from a query', () => {
        expect(
            readSignupUtm(
                query('?utm_source=ads&utm_campaign=launch&utm_id=x&ref=y'),
            ),
        ).toEqual({ utm_source: 'ads', utm_campaign: 'launch' });
    });

    it('drops blank and oversized values', () => {
        expect(
            readSignupUtm(
                query(`?utm_source=%20&utm_term=${'x'.repeat(256)}`),
            ),
        ).toBeNull();
    });

    it('reads a plain object and ignores non-strings', () => {
        expect(readSignupUtm({ utm_source: 'ads', utm_medium: 3 })).toEqual({
            utm_source: 'ads',
        });
        expect(readSignupUtm(undefined)).toBeNull();
    });
});

describe('rememberSignupUtm', () => {
    it('saves the page params and returns them on a later load without any', () => {
        const storage = memoryStorage();
        expect(rememberSignupUtm(query('?utm_source=ads'), storage)).toEqual({
            utm_source: 'ads',
        });
        expect(rememberSignupUtm(query(''), storage)).toEqual({
            utm_source: 'ads',
        });
    });

    it('lets new page params replace the saved ones', () => {
        const storage = memoryStorage();
        rememberSignupUtm(query('?utm_source=ads'), storage);
        expect(
            rememberSignupUtm(query('?utm_source=newsletter'), storage),
        ).toEqual({ utm_source: 'newsletter' });
    });

    it('still returns the page params when storage throws', () => {
        const storage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        };
        expect(rememberSignupUtm(query('?utm_source=ads'), storage)).toEqual({
            utm_source: 'ads',
        });
        expect(rememberSignupUtm(query(''), storage)).toBeNull();
    });

    it('ignores a corrupted saved value', () => {
        const storage = memoryStorage();
        storage.setItem('signup_utm', '{not json');
        expect(rememberSignupUtm(query(''), storage)).toBeNull();
    });
});

describe('signupUtmQuery', () => {
    it('encodes utm as extra query pairs', () => {
        expect(signupUtmQuery({ utm_source: 'a b', utm_campaign: 'x&y' })).toBe(
            '&utm_source=a+b&utm_campaign=x%26y',
        );
        expect(signupUtmQuery(null)).toBe('');
    });
});
