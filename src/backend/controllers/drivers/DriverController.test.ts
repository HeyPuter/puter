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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { DriverController } from './DriverController.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer (in-memory sqlite + dynamo + s3 + mock redis).
// The DriverController under test is the same instance the live request
// pipeline uses, so its iface→driver registry is populated from real
// drivers (puter-kvstore, puter-apps, puter-subdomains, …). The HTTP
// handlers (`#handleCall`, `#handleListInterfaces`, `#handleXd`) are
// private — we exercise the public lookup API (`resolve` / list / get
// default) which the handlers themselves delegate to.

let server: PuterServer;
let controller: DriverController;

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.drivers as unknown as DriverController;
});

afterAll(async () => {
    await server?.shutdown();
});

// ── Lookup API ──────────────────────────────────────────────────────

describe('DriverController.listInterfaces', () => {
    it('exposes built-in interfaces', () => {
        const interfaces = controller.listInterfaces();
        // Several drivers ship by default — assert known ones rather
        // than the exact set so adding a driver doesn't break this.
        expect(interfaces).toEqual(
            expect.arrayContaining([
                'puter-kvstore',
                'puter-apps',
                'puter-subdomains',
                'puter-notifications',
            ]),
        );
    });
});

describe('DriverController.listDrivers', () => {
    it('returns every name registered for an interface', () => {
        const drivers = controller.listDrivers('puter-kvstore');
        expect(drivers).toContain('puter-kvstore');
    });

    it('returns [] for an unknown interface', () => {
        expect(controller.listDrivers('nonexistent')).toEqual([]);
    });
});

describe('DriverController.getDefault', () => {
    it('returns the registered default driver name', () => {
        // KVStoreDriver declares `isDefault = true`.
        expect(controller.getDefault('puter-kvstore')).toBe('puter-kvstore');
    });

    it('returns undefined for an unknown interface', () => {
        expect(controller.getDefault('nonexistent')).toBeUndefined();
    });
});

describe('DriverController.resolve', () => {
    it('returns the default-driver instance when no name is given', () => {
        const driver = controller.resolve('puter-kvstore');
        expect(driver).not.toBeNull();
        // The KV driver exposes a `set` method per its interface.
        expect(typeof (driver as Record<string, unknown>)?.set).toBe(
            'function',
        );
    });

    it('finds the same instance by explicit driver name', () => {
        const byDefault = controller.resolve('puter-kvstore');
        const byName = controller.resolve('puter-kvstore', 'puter-kvstore');
        expect(byName).toBe(byDefault);
    });

    it('returns null for an unknown interface', () => {
        expect(controller.resolve('nope')).toBeNull();
    });

    it('returns null for a known interface but unknown driver name', () => {
        expect(
            controller.resolve('puter-kvstore', 'no-such-driver'),
        ).toBeNull();
    });
});
