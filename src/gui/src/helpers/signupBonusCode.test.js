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
import {
    bonusRequirementsKey,
    checkSignupBonusCode,
    readSignupBonusCode,
} from './signupBonusCode.js';

const query = (search) => new URLSearchParams(search);

describe('readSignupBonusCode', () => {
    it('reads a well-shaped code from the query', () => {
        expect(readSignupBonusCode(query('?bonusCode=startup3m-7KQ2'))).toBe(
            'startup3m-7KQ2',
        );
    });

    it('ignores a missing or ill-shaped code', () => {
        expect(readSignupBonusCode(query(''))).toBeNull();
        expect(readSignupBonusCode(query('?bonusCode=abc'))).toBeNull();
        expect(
            readSignupBonusCode(query('?bonusCode=<script>1234</script>')),
        ).toBeNull();
        expect(readSignupBonusCode(undefined)).toBeNull();
    });
});

describe('checkSignupBonusCode', () => {
    const respond = (status, body) => {
        const calls = [];
        const fetchImpl = async (url, init) => {
            calls.push({ url, init });
            return {
                ok: status >= 200 && status < 300,
                json: async () => body,
            };
        };
        return { fetchImpl, calls };
    };

    it('posts the code (and fingerprint) to the check route', async () => {
        const { fetchImpl, calls } = respond(200, { valid: false });
        await checkSignupBonusCode('startup3m-7kq2', {
            origin: 'https://puter.test',
            fingerprint: 'fp1',
            fetchImpl,
        });
        expect(calls[0].url).toBe('https://puter.test/signup/bonus-code/check');
        expect(JSON.parse(calls[0].init.body)).toEqual({
            bonusCode: 'startup3m-7kq2',
            fingerprint: 'fp1',
        });
    });

    it('returns a valid answer as-is', async () => {
        const answer = {
            valid: true,
            display: { title: 'T', description: 'D' },
            requirements: { phone: true, card: false },
        };
        const { fetchImpl } = respond(200, answer);
        expect(await checkSignupBonusCode('abcd', { fetchImpl })).toEqual(
            answer,
        );
    });

    it('collapses a refusal to invalid', async () => {
        const { fetchImpl } = respond(200, { valid: false, reason: 'ended' });
        expect(await checkSignupBonusCode('abcd', { fetchImpl })).toEqual({
            valid: false,
        });
    });

    it('returns null when the answer is unknown', async () => {
        const { fetchImpl } = respond(429, {});
        expect(await checkSignupBonusCode('abcd', { fetchImpl })).toBeNull();
        const offline = async () => {
            throw new Error('offline');
        };
        expect(
            await checkSignupBonusCode('abcd', { fetchImpl: offline }),
        ).toBeNull();
    });
});

describe('bonusRequirementsKey', () => {
    it('names the verification a code requires', () => {
        expect(bonusRequirementsKey({ phone: true, card: false })).toBe(
            'signup_bonus_requires_phone',
        );
        expect(bonusRequirementsKey({ phone: false, card: true })).toBe(
            'signup_bonus_requires_card',
        );
        expect(bonusRequirementsKey({ phone: true, card: true })).toBe(
            'signup_bonus_requires_phone_and_card',
        );
        expect(bonusRequirementsKey({ phone: false, card: false })).toBeNull();
        expect(bonusRequirementsKey(null)).toBeNull();
    });
});
