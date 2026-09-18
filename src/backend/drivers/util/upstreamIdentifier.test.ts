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
import { SYSTEM_ACTOR, makeActor } from '../../core/actor.js';
import { upstreamUserIdentifier } from './upstreamIdentifier.js';

describe('upstreamUserIdentifier', () => {
    const user = { id: 42, uuid: 'u-42', username: 'alice' };

    it('names a plain user by id alone', () => {
        expect(upstreamUserIdentifier(makeActor({ user }))).toBe('42');
    });

    it('appends the app an app-under-user actor carries', () => {
        const actor = makeActor({ user, app: { uid: 'app-1', id: 7 } });
        expect(upstreamUserIdentifier(actor)).toBe('42:app-1');
    });

    it('attributes an app-issued access token to the issuing app', () => {
        const issuer = makeActor({ user, app: { uid: 'app-1', id: 7 } });
        const token = makeActor({
            user,
            accessToken: { uid: 'tok-1', issuer },
        });
        expect(upstreamUserIdentifier(token)).toBe('42:app-1');
    });

    it('is empty when there is no user to name', () => {
        expect(upstreamUserIdentifier(undefined)).toBe('');
        expect(upstreamUserIdentifier(null)).toBe('');
        expect(upstreamUserIdentifier(SYSTEM_ACTOR)).toBe('');
    });
});
