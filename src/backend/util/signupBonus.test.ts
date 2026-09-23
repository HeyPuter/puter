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
import { EventClient } from '../clients/event/EventClient.js';
import type { EventMap } from '../clients/event/types.js';
import {
    bonusCodeInvalidError,
    isAbsentBonusCode,
    normalizeBonusCode,
    validateSignupBonus,
} from './signupBonus.js';

const baseContext = {
    email: 'a@test.local',
    ip: '203.0.113.1',
    requires_phone_verification: false,
    requires_card_verification: false,
};

const clientWith = (
    listener: (data: EventMap['puter.signup-bonus.validate']) => void,
) => {
    const client = new EventClient({} as never);
    client.on('puter.signup-bonus.validate', (_k, data) => listener(data));
    return client;
};

describe('normalizeBonusCode', () => {
    it('lowercases and drops separators', () => {
        expect(normalizeBonusCode('Startup3M-7KQ2_9XPA')).toBe(
            'startup3m7kq29xpa',
        );
        expect(normalizeBonusCode(' abcd 1234 ')).toBe('abcd1234');
    });

    it('rejects anything that cannot be a code', () => {
        for (const bad of [
            undefined,
            null,
            42,
            {},
            '',
            'abc',
            'a'.repeat(65),
            'x'.repeat(129),
            'abcd.1234',
            'abcd:1234',
            'ábcd1234',
        ]) {
            expect(normalizeBonusCode(bad)).toBeNull();
        }
    });
});

describe('isAbsentBonusCode', () => {
    it('treats undefined, null and empty string as absent', () => {
        expect(isAbsentBonusCode(undefined)).toBe(true);
        expect(isAbsentBonusCode(null)).toBe(true);
        expect(isAbsentBonusCode('')).toBe(true);
        expect(isAbsentBonusCode('abcd')).toBe(false);
        expect(isAbsentBonusCode(0)).toBe(false);
    });
});

describe('bonusCodeInvalidError', () => {
    it('is a 400 with the stable code', () => {
        const err = bonusCodeInvalidError();
        expect(err.statusCode).toBe(400);
        expect(err.legacyCode).toBe('bonus_code_invalid');
    });
});

describe('validateSignupBonus', () => {
    it('refuses when nothing is listening', async () => {
        expect(
            await validateSignupBonus(undefined, 'abcd1234', baseContext),
        ).toEqual({ accepted: false });
    });

    it('refuses when the listener leaves the code unaccepted', async () => {
        const client = clientWith(() => {});
        expect(
            await validateSignupBonus(client, 'abcd1234', baseContext),
        ).toEqual({ accepted: false });
    });

    it('hands the listener the code and the current requirements', async () => {
        let seen: EventMap['puter.signup-bonus.validate'] | null = null;
        const client = clientWith((data) => {
            seen = { ...data };
        });
        await validateSignupBonus(client, 'abcd1234', {
            ...baseContext,
            requires_card_verification: true,
        });
        expect(seen).toMatchObject({
            code: 'abcd1234',
            email: 'a@test.local',
            requires_phone_verification: false,
            requires_card_verification: true,
            accepted: false,
        });
    });

    it('returns the requirements a listener raises', async () => {
        const client = clientWith((data) => {
            data.accepted = true;
            data.requires_phone_verification = true;
        });
        expect(
            await validateSignupBonus(client, 'abcd1234', baseContext),
        ).toEqual({
            accepted: true,
            requiresPhoneVerification: true,
            requiresCardVerification: false,
        });
    });

    it('never lets a listener lower a requirement', async () => {
        const client = clientWith((data) => {
            data.accepted = true;
            data.requires_phone_verification = false;
            data.requires_card_verification = false;
        });
        expect(
            await validateSignupBonus(client, 'abcd1234', {
                ...baseContext,
                requires_phone_verification: true,
                requires_card_verification: true,
            }),
        ).toEqual({
            accepted: true,
            requiresPhoneVerification: true,
            requiresCardVerification: true,
        });
    });

    it('treats a throwing listener as not accepting', async () => {
        const client = clientWith(() => {
            throw new Error('boom');
        });
        expect(
            await validateSignupBonus(client, 'abcd1234', baseContext),
        ).toEqual({ accepted: false });
    });
});
