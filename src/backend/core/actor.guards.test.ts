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
    actorOwnsRow,
    assertActorEmailVerified,
    makeActor,
    requireContextActor,
    requireContextUserActor,
    SYSTEM_ACTOR,
    type Actor,
} from './actor.js';
import { runWithContext } from './context.js';

const user = { id: 7, uuid: 'u-7', username: 'dev', email_confirmed: true };
const plain = makeActor({ user });
const asApp = (appId: number) =>
    makeActor({ user, app: { id: appId, uid: `app-${appId}` } });

describe('requireContextActor', () => {
    it('returns the request actor and 401s without one', () => {
        expect(runWithContext({ actor: plain }, requireContextActor)).toBe(
            plain,
        );
        expect(() =>
            runWithContext({ actor: undefined }, requireContextActor),
        ).toThrow(expect.objectContaining({ statusCode: 401 }));
    });

    it('accepts an actor without a user id', () => {
        expect(
            runWithContext({ actor: SYSTEM_ACTOR }, requireContextActor),
        ).toBe(SYSTEM_ACTOR);
    });
});

describe('requireContextUserActor', () => {
    it('returns an actor acting for a user', () => {
        expect(runWithContext({ actor: plain }, requireContextUserActor)).toBe(
            plain,
        );
    });

    it('401s without an actor or without a user id', () => {
        for (const actor of [undefined, SYSTEM_ACTOR]) {
            expect(() =>
                runWithContext({ actor }, requireContextUserActor),
            ).toThrow(
                expect.objectContaining({
                    statusCode: 401,
                    legacyCode: 'unauthorized',
                }),
            );
        }
    });
});

describe('assertActorEmailVerified', () => {
    const unverified: Actor = makeActor({
        user: { ...user, email_confirmed: false },
    });

    it('is inert unless strict verification is configured', () => {
        expect(() => assertActorEmailVerified(unverified, {})).not.toThrow();
    });

    it('rejects an unverified actor with 400 under strict verification', () => {
        const strict = { strict_email_verification_required: true };
        expect(() => assertActorEmailVerified(plain, strict)).not.toThrow();
        expect(() => assertActorEmailVerified(unverified, strict)).toThrow(
            expect.objectContaining({
                statusCode: 400,
                legacyCode: 'account_is_not_verified',
            }),
        );
    });
});

describe('actorOwnsRow', () => {
    it('grants the owning user acting as themselves', () => {
        expect(actorOwnsRow(plain, { ownerUserId: 7, appOwnerId: 3 })).toBe(
            true,
        );
        expect(actorOwnsRow(plain, { ownerUserId: 8, appOwnerId: null })).toBe(
            false,
        );
    });

    it('grants an app actor only the owner’s rows that app created', () => {
        expect(actorOwnsRow(asApp(3), { ownerUserId: 7, appOwnerId: 3 })).toBe(
            true,
        );
        expect(actorOwnsRow(asApp(4), { ownerUserId: 7, appOwnerId: 3 })).toBe(
            false,
        );
        expect(actorOwnsRow(asApp(3), { ownerUserId: 8, appOwnerId: 3 })).toBe(
            false,
        );
    });
});
