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
    assertResolvedActor,
    makeActor,
    SYSTEM_ACTOR,
    userRelatedActor,
    type Actor,
} from './actor';

describe('makeActor / effectiveApp', () => {
    const user = { uuid: 'u-1', id: 1, username: 'u' };

    it('resolves a plain user actor to no app', () => {
        expect(makeActor({ user }).effectiveApp).toBeNull();
    });

    it("resolves an app-under-user actor to its own app", () => {
        expect(makeActor({ user, app: { uid: 'app-1' } }).effectiveApp).toEqual({
            uid: 'app-1',
        });
    });

    it("resolves a token to the app that issued it", () => {
        // The whole point: a token actor carries no `app` of its own, so
        // anything reading `app` sees a bare user token and skips app gating.
        const issuer = makeActor({ user, app: { uid: 'app-1' } });
        const token = makeActor({
            user,
            accessToken: { uid: 'tok-1', issuer },
        });
        expect(token.app).toBeUndefined();
        expect(token.effectiveApp).toEqual({ uid: 'app-1' });
    });

    it('collapses a chain of tokens in one hop', () => {
        const issuer = makeActor({ user, app: { uid: 'app-1' } });
        const inner = makeActor({ user, accessToken: { uid: 't1', issuer } });
        const outer = makeActor({
            user,
            accessToken: { uid: 't2', issuer: inner },
        });
        expect(outer.effectiveApp).toEqual({ uid: 'app-1' });
    });

    it('resolves a user-issued token to no app', () => {
        const issuer = makeActor({ user });
        const token = makeActor({
            user,
            accessToken: { uid: 'tok-1', issuer, fullAccess: true },
        });
        expect(token.effectiveApp).toBeNull();
    });

    it('drops the app when narrowing to the underlying user', () => {
        const app = makeActor({ user, app: { uid: 'app-1' } });
        expect(userRelatedActor(app).effectiveApp).toBeNull();
    });

    it('resolves the system actor', () => {
        expect(SYSTEM_ACTOR.effectiveApp).toBeNull();
    });
});

describe('assertResolvedActor', () => {
    it('passes a resolved actor through unchanged', () => {
        const actor = makeActor({ user: { uuid: 'u-1' } });
        expect(assertResolvedActor(actor)).toBe(actor);
        // `null` is a resolved answer, not a missing one.
        expect(assertResolvedActor({ user: {}, effectiveApp: null })).toEqual({
            user: {},
            effectiveApp: null,
        });
    });

    it('throws on an actor that skipped makeActor', () => {
        // The field is optional so pre-existing literals still compile, which
        // means an unresolved one can reach a gate. Fail loudly at the edge
        // rather than let a gate read `undefined` as "no app" and wave it
        // through — an app-under-user actor is the dangerous case.
        const unresolved = { user: { uuid: 'u-1' }, app: { uid: 'app-1' } };
        expect(() => assertResolvedActor(unresolved as Actor)).toThrow(
            /effectiveApp/,
        );
    });
});
