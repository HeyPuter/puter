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

/**
 * Wiring test for `guiOriginOnly`.
 *
 * `originGate.test.ts` covers what the gate decides. This covers that the
 * routes which hand a session credential back to the caller actually opt into
 * it — a correct gate wired to nothing protects nothing, and the failure is
 * invisible (the route keeps working, just for everybody).
 */

import { describe, expect, it } from 'vitest';
import { AuthController } from './AuthController.js';
import {
    ROUTES_METADATA_KEY,
    type CollectedRoute,
} from '../../core/http/types.js';

// The decorators register on the prototype via `addInitializer`, which only
// runs once an instance exists. We never start this one — constructing it is
// enough to populate the route metadata.
const collectRoutes = (): CollectedRoute[] => {
    const proto = AuthController.prototype as unknown as Record<
        string,
        CollectedRoute[] | undefined
    >;
    if (!proto[ROUTES_METADATA_KEY]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (AuthController as any)({}, {}, {}, {}, {});
    }
    return proto[ROUTES_METADATA_KEY] ?? [];
};

/**
 * Every route that answers with a usable session credential. Adding one here
 * without `guiOriginOnly` is the mistake this test exists to catch: reflected
 * CORS would let any page read the credential out of the response.
 */
const CREDENTIAL_ROUTES: Array<[method: string, path: string]> = [
    ['post', '/login'],
    ['post', '/login/otp'],
    ['post', '/login/recovery-code'],
    ['post', '/signup'],
    ['get', '/session/sync-cookie'],
];

describe('guiOriginOnly wiring on AuthController', () => {
    const routes = collectRoutes();

    it('registers the routes under test at all (guards against a rename)', () => {
        for (const [method, path] of CREDENTIAL_ROUTES) {
            const found = routes.find(
                (r) => r.method === method && r.path === path,
            );
            expect(found, `${method.toUpperCase()} ${path} not registered`)
                .toBeDefined();
        }
    });

    it.each(CREDENTIAL_ROUTES)(
        'gates %s %s to the GUI origin',
        (method, path) => {
            const route = routes.find(
                (r) => r.method === method && r.path === path,
            );
            expect(route?.options.guiOriginOnly).toBe(true);
        },
    );

    // The popup relay is the third-party sign-in path: `puter.auth.signIn()`
    // polls `/login/wait` from whatever origin the app is served from, and
    // `/login/set` is posted by the popup. Gating either to our own origin
    // would break every third-party app, and neither needs it — the token
    // they move is app-scoped, not a session.
    it.each([
        ['post', '/login/wait'],
        ['post', '/login/set'],
    ])('leaves %s %s open cross-origin', (method, path) => {
        const route = routes.find(
            (r) => r.method === method && r.path === path,
        );
        expect(route, `${method.toUpperCase()} ${path} not registered`)
            .toBeDefined();
        expect(route?.options.guiOriginOnly).toBeUndefined();
    });
});
