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
import type { Actor } from '../../core/actor.js';
import { SYSTEM_ACTOR, makeActor } from '../../core/actor.js';
import { aiUserIdentifier } from './aiUserIdentifier.js';

// Real production shapes: `user.uuid` is a UUID v4 (36 chars) and
// `app.uid` is `app-<uuid v4>` (40 chars).
const REAL_UUID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const REAL_APP_UID = `app-${REAL_UUID}`;

describe('aiUserIdentifier', () => {
    const user = { id: 42, uuid: 'u42', username: 'alice' };
    const appUid = 'app-abc';

    it('derives a non-sequential id from the user uuid', () => {
        expect(aiUserIdentifier(makeActor({ user }))).toBe('puter-u42');
    });

    it('attaches the app uid when makeActor derives effectiveApp', () => {
        const actor = makeActor({ user, app: { uid: appUid } });
        expect(actor.effectiveApp?.uid).toBe(appUid);
        expect(aiUserIdentifier(actor)).toBe('puter-u42-app-abc');
    });

    it('attaches the app through effectiveApp across an access token', () => {
        const token = makeActor({
            user,
            accessToken: {
                uid: 'tok-1',
                issuer: makeActor({ user, app: { uid: appUid } }),
            },
        });
        expect(aiUserIdentifier(token)).toBe('puter-u42-app-abc');
    });

    it('omits the app suffix for an access token issued by a plain user', () => {
        const token = makeActor({
            user,
            accessToken: { uid: 'tok-1', issuer: makeActor({ user }) },
        });
        expect(aiUserIdentifier(token)).toBe('puter-u42');
    });

    it('reads only effectiveApp, ignoring a bare app on hand-built actors', () => {
        const actor = { user, app: { uid: 'direct-app' } } as Actor;
        expect(aiUserIdentifier(actor)).toBe('puter-u42');
    });

    it('prefers effectiveApp over a bare app on hand-built actors', () => {
        const actor = {
            user,
            app: { uid: 'direct-app' },
            effectiveApp: { uid: 'effective-app' },
        } as Actor;
        expect(aiUserIdentifier(actor)).toBe('puter-u42-effective-app');
    });

    it('returns undefined for the system actor', () => {
        expect(aiUserIdentifier(SYSTEM_ACTOR)).toBeUndefined();
        expect(aiUserIdentifier(makeActor({ user, system: true }))).toBeUndefined();
    });

    it('returns undefined without an actor or a user uuid', () => {
        expect(aiUserIdentifier()).toBeUndefined();
        expect(aiUserIdentifier(null)).toBeUndefined();
        expect(aiUserIdentifier(makeActor({ user: { id: 42 } }))).toBeUndefined();
    });

    it('keeps the full user uuid and truncates only the app token to fit maxLength', () => {
        const actor = makeActor({
            user: { ...user, uuid: REAL_UUID },
            app: { uid: REAL_APP_UID },
        });
        const identifier = aiUserIdentifier(actor, 64)!;
        // puter- (6) + uuid (36) + '-' (1) + app token cut to 21 chars = 64.
        expect(identifier).toBe(`puter-${REAL_UUID}-${REAL_APP_UID.slice(0, 21)}`);
        expect(identifier.length).toBe(64);
        expect(identifier.startsWith(`puter-${REAL_UUID}`)).toBe(true);
    });

    it('omits the app token entirely when there is no room for it', () => {
        const actor = makeActor({
            user: { ...user, uuid: REAL_UUID },
            app: { uid: appUid },
        });
        const base = `puter-${REAL_UUID}`;
        // No budget for '-<token>' inside the cap: the user-only form wins,
        // and never a dangling separator.
        expect(aiUserIdentifier(actor, base.length)).toBe(base);
        expect(aiUserIdentifier(actor, base.length + 1)).toBe(base);
        expect(aiUserIdentifier(actor, base.length + 1)).not.toMatch(/-$/);
    });

    it('never truncates the user uuid, even under a maxLength below the base length', () => {
        const actor = makeActor({ user: { ...user, uuid: REAL_UUID } });
        const base = `puter-${REAL_UUID}`;

        expect(aiUserIdentifier(actor, 10)).toBe(base);

        const withApp = makeActor({
            user: { ...user, uuid: REAL_UUID },
            app: { uid: REAL_APP_UID },
        });

        expect(aiUserIdentifier(withApp, 30)).toBe(base);
    });

    it('truncates a long app token to a larger maxLength deterministically', () => {
        const actor = makeActor({ user, app: { uid: 'long-'.repeat(40) } });
        const at64 = aiUserIdentifier(actor, 64)!;
        const at128 = aiUserIdentifier(actor, 128)!;
        expect(at64).toHaveLength(64);
        expect(at128).toHaveLength(128);
        expect(at64.startsWith('puter-u42-')).toBe(true);
        expect(at128.startsWith('puter-u42-')).toBe(true);
        expect(aiUserIdentifier(actor)).toBe(at64);
    });
});