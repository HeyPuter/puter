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
    normalizeSignupUtm,
    readSignupUtm,
    SIGNUP_UTM_MAX_LENGTH,
} from './signupUtm.js';

describe('readSignupUtm', () => {
    it('reads the utm_* params, keyed without the prefix', () => {
        expect(
            readSignupUtm({
                utm_source: 'newsletter',
                utm_medium: 'email',
                utm_campaign: 'launch',
                utm_term: 'cloud os',
                utm_content: 'hero-cta',
            }),
        ).toEqual({
            source: 'newsletter',
            medium: 'email',
            campaign: 'launch',
            term: 'cloud os',
            content: 'hero-cta',
        });
    });

    it('drops unknown keys, non-strings, blanks and oversized values', () => {
        expect(
            readSignupUtm({
                utm_source: '  ads  ',
                utm_medium: 42,
                utm_campaign: '   ',
                utm_term: 'x'.repeat(SIGNUP_UTM_MAX_LENGTH + 1),
                utm_content: { nested: true },
                utm_id: 'not-tracked',
                password: 'secret',
            }),
        ).toEqual({ source: 'ads' });
    });

    it('takes the first value of a repeated query param', () => {
        expect(readSignupUtm({ utm_source: ['first', 'second'] })).toEqual({
            source: 'first',
        });
    });

    it('returns null when nothing usable is present', () => {
        expect(readSignupUtm({})).toBeNull();
        expect(readSignupUtm({ utm_source: '' })).toBeNull();
        expect(readSignupUtm(undefined)).toBeNull();
    });
});

describe('normalizeSignupUtm', () => {
    it('keeps a well-formed value and re-checks each field', () => {
        expect(
            normalizeSignupUtm({ source: 'ads', medium: 7, extra: 'x' }),
        ).toEqual({ source: 'ads' });
    });

    it('returns null for anything that is not a plain object', () => {
        expect(normalizeSignupUtm(null)).toBeNull();
        expect(normalizeSignupUtm('ads')).toBeNull();
        expect(normalizeSignupUtm(['ads'])).toBeNull();
    });
});
