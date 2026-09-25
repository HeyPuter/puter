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
import type { IConfig } from '../types';
import type { Actor } from './actor';
import { isHttpError } from './http/HttpError';
import {
    assertActorMeetsReputation,
    DEFAULT_REPUTATION,
    resolveActorReputation,
    resolveReputationThreshold,
    validateReputationRequirement,
} from './reputation';

const configWith = (
    tiers: Record<string, number>,
    enabled?: boolean,
): IConfig =>
    ({
        reputationGate: {
            ...(enabled === undefined ? {} : { enabled }),
            tiers,
        },
    }) as unknown as IConfig;

const actorWith = (reputation?: unknown): Actor =>
    ({ user: { uuid: 'u-1', reputation } }) as unknown as Actor;

describe('validateReputationRequirement', () => {
    it('accepts a tier name and trims it', () => {
        expect(validateReputationRequirement('standard', 't')).toBe('standard');
        expect(validateReputationRequirement('  standard  ', 't')).toBe(
            'standard',
        );
    });

    it('accepts an explicit opt-out', () => {
        expect(validateReputationRequirement(false, 't')).toBe(false);
    });

    it('rejects anything that reads as a gate but names none', () => {
        expect(() => validateReputationRequirement('', 't')).toThrow(
            /non-empty tier name/,
        );
        expect(() => validateReputationRequirement('   ', 't')).toThrow(
            /non-empty tier name/,
        );
        expect(() => validateReputationRequirement(true, 't')).toThrow(
            /expected a tier name, or false/,
        );
        expect(() => validateReputationRequirement(50, 't')).toThrow(
            /expected a tier name, or false/,
        );
    });
});

describe('resolveActorReputation', () => {
    it('reads the score off the actor', () => {
        expect(resolveActorReputation(actorWith(40))).toBe(40);
    });

    it('treats a missing or unusable score as neutral', () => {
        expect(resolveActorReputation(actorWith(undefined))).toBe(
            DEFAULT_REPUTATION,
        );
        expect(resolveActorReputation(actorWith('40'))).toBe(
            DEFAULT_REPUTATION,
        );
        expect(resolveActorReputation(actorWith(NaN))).toBe(DEFAULT_REPUTATION);
    });

    it('clamps a score off the ends of the scale', () => {
        expect(resolveActorReputation(actorWith(-20))).toBe(0);
        expect(resolveActorReputation(actorWith(140))).toBe(100);
    });

    it('has no score for a caller with no account', () => {
        expect(resolveActorReputation(undefined)).toBeUndefined();
        expect(
            resolveActorReputation({ user: {} } as unknown as Actor),
        ).toBeUndefined();
    });
});

describe('resolveReputationThreshold', () => {
    it('reads the minimum a deployment gives a tier', () => {
        expect(
            resolveReputationThreshold(
                configWith({ standard: 60 }),
                'standard',
            ),
        ).toBe(60);
    });

    it('clamps a configured minimum to the scale', () => {
        expect(resolveReputationThreshold(configWith({ t: 500 }), 't')).toBe(
            100,
        );
        expect(resolveReputationThreshold(configWith({ t: -5 }), 't')).toBe(0);
    });

    it('has nothing for an undefined or malformed tier', () => {
        expect(
            resolveReputationThreshold(configWith({ standard: 60 }), 'other'),
        ).toBeUndefined();
        expect(
            resolveReputationThreshold(
                {
                    reputationGate: { tiers: { t: '60' } },
                } as unknown as IConfig,
                't',
            ),
        ).toBeUndefined();
        expect(resolveReputationThreshold({} as IConfig, 't')).toBeUndefined();
    });
});

describe('assertActorMeetsReputation', () => {
    const config = configWith({ standard: 60 });

    const denial = async (promise: Promise<unknown>) => {
        const err = await promise.then(
            () => undefined,
            (e: unknown) => e,
        );
        expect(isHttpError(err)).toBe(true);
        return err as { statusCode: number; legacyCode?: string };
    };

    it('admits an account at or above the tier', async () => {
        await expect(
            assertActorMeetsReputation(actorWith(60), 'standard', config),
        ).resolves.toBeUndefined();
        await expect(
            assertActorMeetsReputation(actorWith(95), 'standard', config),
        ).resolves.toBeUndefined();
    });

    it('turns away an account below the tier with 403', async () => {
        const err = await denial(
            assertActorMeetsReputation(actorWith(30), 'standard', config),
        );
        expect(err).toMatchObject({
            statusCode: 403,
            legacyCode: 'reputation_required',
        });
    });

    it('says nothing about the score or the tier in the denial', async () => {
        const err = await denial(
            assertActorMeetsReputation(actorWith(30), 'standard', config),
        );
        const rendered = JSON.stringify(err);
        expect(rendered).not.toMatch(/standard/);
        expect(rendered).not.toMatch(/\b30\b|\b60\b/);
    });

    it('turns away a caller with no account', async () => {
        const err = await denial(
            assertActorMeetsReputation(undefined, 'standard', config),
        );
        expect(err.statusCode).toBe(403);
    });

    it('lets the system actor through', async () => {
        await expect(
            assertActorMeetsReputation(
                { user: { uuid: 'sys' }, system: true } as unknown as Actor,
                'standard',
                config,
            ),
        ).resolves.toBeUndefined();
    });

    it('enforces nothing for a tier the deployment never defined', async () => {
        await expect(
            assertActorMeetsReputation(actorWith(0), 'unheard-of', config),
        ).resolves.toBeUndefined();
    });

    it('enforces nothing once the master switch is off', async () => {
        await expect(
            assertActorMeetsReputation(
                actorWith(0),
                'standard',
                configWith({ standard: 60 }, false),
            ),
        ).resolves.toBeUndefined();
    });

    it('enforces nothing on an explicit opt-out', async () => {
        await expect(
            assertActorMeetsReputation(actorWith(0), false, config),
        ).resolves.toBeUndefined();
    });

    it('holds an account with no recorded score to the neutral score', async () => {
        await expect(
            assertActorMeetsReputation(
                actorWith(undefined),
                'standard',
                config,
            ),
        ).resolves.toBeUndefined();
        await expect(
            assertActorMeetsReputation(
                actorWith(undefined),
                'perfect',
                configWith({ perfect: 100 }),
            ),
        ).resolves.toBeUndefined();
    });
});
