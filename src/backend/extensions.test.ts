/**
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

import { afterEach, describe, expect, it } from 'vitest';
import { extension } from './extensions.ts';
import { clientsContainers } from './exports.ts';

/**
 * The `extension.import('client')` proxy does NOT return `undefined` for
 * clients that were never registered — it hands back a placeholder proxy that
 * throws on property access. Extensions reaching for an OPTIONAL client (e.g.
 * the ClickHouse analytics client, absent on plain self-hosts) must therefore
 * probe for a real method behind a try/catch rather than trusting truthiness.
 *
 * These tests lock it so a future proxy change can't silently
 * reintroduce the "truthy-but-throws" footgun.
 */
describe('extension.import("client") optional client access', () => {
    const clients = extension.import('client') as Record<
        string,
        { query?: unknown } | undefined
    >;

    afterEach(() => {
        delete clientsContainers.notRegistered;
        delete clientsContainers.optionalThing;
    });

    it('returns a truthy-but-throwing placeholder for an unregistered client', () => {
        delete clientsContainers.notRegistered;
        const placeholder = clients.notRegistered;
        // Truthy — so a bare `if (clients.x)` check is NOT safe.
        expect(placeholder).toBeTruthy();
        // ...and accessing a method on it throws.
        expect(() => (placeholder as { query: unknown }).query).toThrow();
    });

    it('the try/catch probe pattern reports absence safely', () => {
        delete clientsContainers.optionalThing;
        const probe = () => {
            try {
                return typeof clients.optionalThing?.query === 'function'
                    ? clients.optionalThing
                    : null;
            } catch {
                return null;
            }
        };
        expect(probe()).toBeNull();
    });

    it('the same probe returns a registered client exposing the method', () => {
        const fake = { query: async () => undefined };
        clientsContainers.optionalThing =
            fake as unknown as (typeof clientsContainers)[string];
        const probe = () => {
            try {
                return typeof clients.optionalThing?.query === 'function'
                    ? clients.optionalThing
                    : null;
            } catch {
                return null;
            }
        };
        // The import proxy method-binds, so the result is a binding proxy over
        // `fake` rather than the raw reference (identity is intentionally not
        // preserved). What the probe pattern locks is that a registered client
        // surfaces a callable method.
        const result = probe();
        expect(result).not.toBeNull();
        expect(typeof (result as { query: unknown }).query).toBe('function');
    });
});
