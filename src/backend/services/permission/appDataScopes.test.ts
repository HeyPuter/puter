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
import { appDataRootPath, appDataScopeForActor } from './appDataScopes.js';

describe('appDataRootPath', () => {
    it("names the app's folder under the user's AppData", () => {
        expect(appDataRootPath('alice', 'app-1')).toBe('/alice/AppData/app-1');
    });
});

describe('appDataScopeForActor', () => {
    it("confines an app-scoped actor to its app's AppData root", () => {
        expect(
            appDataScopeForActor({
                effectiveApp: { uid: 'app-1' },
                user: { username: 'alice' },
            }),
        ).toBe('/alice/AppData/app-1');
    });

    it('leaves an actor no app scopes, or one with no username, unscoped', () => {
        expect(
            appDataScopeForActor({
                effectiveApp: null,
                user: { username: 'alice' },
            }),
        ).toBeUndefined();
        expect(
            appDataScopeForActor({
                effectiveApp: { uid: 'app-1' },
                user: { username: '' },
            }),
        ).toBeUndefined();
    });
});
