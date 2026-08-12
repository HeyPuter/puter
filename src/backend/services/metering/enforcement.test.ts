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

import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_ACTOR, type Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { IConfig } from '../../types';
import {
    assertActorHasCredits,
    creditEnforcementExempt,
    enforcementEnabled,
} from './enforcement.js';

const userActor = (overrides: Partial<Actor> = {}): Actor =>
    ({
        user: { uuid: 'user-uuid', username: 'user' },
        ...overrides,
    }) as Actor;

const workerActor = (): Actor =>
    userActor({ session: { uid: 'session-uid', kind: 'worker' } });

const config = (overrides: Partial<IConfig> = {}): IConfig =>
    overrides as IConfig;

const brokeMetering = { hasAnyUsageCached: vi.fn().mockResolvedValue(false) };
const fundedMetering = { hasAnyUsageCached: vi.fn().mockResolvedValue(true) };

describe('enforcementEnabled', () => {
    it('is on unless turned off', () => {
        expect(enforcementEnabled(config())).toBe(true);
        expect(enforcementEnabled(config({ meteringEnforcement: {} }))).toBe(
            true,
        );
        expect(
            enforcementEnabled(
                config({ meteringEnforcement: { enabled: true } }),
            ),
        ).toBe(true);
        expect(
            enforcementEnabled(
                config({ meteringEnforcement: { enabled: false } }),
            ),
        ).toBe(false);
    });
});

describe('creditEnforcementExempt', () => {
    it('exempts callers there is no account to charge', () => {
        expect(creditEnforcementExempt(undefined, config())).toBe(true);
        expect(creditEnforcementExempt({ user: {} } as Actor, config())).toBe(
            true,
        );
    });

    it('exempts the system actor', () => {
        expect(creditEnforcementExempt(SYSTEM_ACTOR, config())).toBe(true);
    });

    it('exempts worker sessions by default, and stops when told to', () => {
        expect(creditEnforcementExempt(workerActor(), config())).toBe(true);
        expect(
            creditEnforcementExempt(
                workerActor(),
                config({ meteringEnforcement: { workers: true } }),
            ),
        ).toBe(false);
    });

    it('does not exempt an ordinary user or app caller', () => {
        expect(creditEnforcementExempt(userActor(), config())).toBe(false);
        expect(
            creditEnforcementExempt(
                userActor({ app: { uid: 'app-uid', id: 1 } }),
                config(),
            ),
        ).toBe(false);
    });
});

describe('assertActorHasCredits', () => {
    const expect402 = async (promise: Promise<unknown>) => {
        await expect(promise).rejects.toBeInstanceOf(HttpError);
        await expect(promise).rejects.toMatchObject({
            statusCode: 402,
            // Same code the AI surfaces reject with, so a client that already
            // handles running out of budget handles this too.
            legacyCode: 'insufficient_funds',
        });
    };

    it('rejects an account with nothing left', async () => {
        await expect402(
            assertActorHasCredits(brokeMetering, userActor(), config()),
        );
    });

    it('admits an account with budget left', async () => {
        await expect(
            assertActorHasCredits(fundedMetering, userActor(), config()),
        ).resolves.toBeUndefined();
    });

    it('admits everyone when enforcement is off', async () => {
        await expect(
            assertActorHasCredits(
                brokeMetering,
                userActor(),
                config({ meteringEnforcement: { enabled: false } }),
            ),
        ).resolves.toBeUndefined();
    });

    it('admits everyone with no metering service to ask', async () => {
        await expect(
            assertActorHasCredits(undefined, userActor(), config()),
        ).resolves.toBeUndefined();
        await expect(
            assertActorHasCredits({}, userActor(), config()),
        ).resolves.toBeUndefined();
    });

    it('does not ask about an exempt caller', async () => {
        const metering = {
            hasAnyUsageCached: vi.fn().mockResolvedValue(false),
        };
        await expect(
            assertActorHasCredits(metering, workerActor(), config()),
        ).resolves.toBeUndefined();
        expect(metering.hasAnyUsageCached).not.toHaveBeenCalled();
    });
});
