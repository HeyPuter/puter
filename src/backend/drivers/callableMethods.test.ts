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

import { describe, expect, it } from 'vitest';
import { puterDrivers } from './index.js';
import { RESERVED_DRIVER_METHODS, resolveCallableMethods } from './meta.js';

// Guard on the exact set of methods each driver exposes over `/drivers/call`.
// The RPC surface is derived structurally (see `resolveCallableMethods`): a
// method is callable iff it is a novel public method on the concrete driver
// class. This test pins that surface so that ADDING a plain public method to a
// driver — which would silently make it a remote endpoint — fails CI until the
// expected list here is updated. It is the "fail loud" backstop for the
// otherwise fail-open structural gate.
//
// PuterDriver's constructor signature is (config, clients, stores, services);
// field initializers don't read them, so empty mocks are fine (same trick as
// driverPolicies.test.ts).
const fake = () => [{}, {}, {}, {}] as [any, any, any, any];

// Expected callable surface, keyed by the registry key in `puterDrivers`.
// Keep alphabetical within each list for easy diffing.
const EXPECTED: Record<string, string[]> = {
    kvStore: [
        'add', 'batchPut', 'decr', 'del', 'expire', 'expireAt', 'flush',
        'get', 'incr', 'list', 'remove', 'set', 'update',
    ],
    aiChat: ['complete', 'list', 'models'],
    aiImage: ['generate', 'list', 'models'],
    aiTts: ['list', 'list_engines', 'list_voices', 'synthesize'],
    aiVideo: ['generate', 'list', 'models'],
    aiSpeech2Speech: ['convert'],
    aiSpeech2Txt: ['list_models', 'transcribe', 'translate'],
    aiSpeech2TxtXai: ['list_models', 'transcribe', 'translate'],
    aiOcr: ['recognize'],
    // AppDriver is the legacy `.js` driver: its non-RPC helpers are plain
    // public methods (not `#`-private), so `isNameAvailable` (an AppController
    // helper) and `toClientView` (a safe-field projection used by the homepage
    // shell) sit on the callable surface. Both are (and always were, under the
    // old reflection dispatch) remotely callable — pinned here rather than
    // silently exposed. See the follow-up note: lock these down by making them
    // `#`-private with dedicated call sites if the exposure is unwanted.
    apps: [
        'create', 'delete', 'isNameAvailable', 'read', 'select',
        'toClientView', 'update', 'upsert',
    ],
    subdomains: ['create', 'delete', 'read', 'select', 'update', 'upsert'],
    notifications: ['create', 'mark_acknowledged', 'mark_shown', 'read', 'select'],
    workers: ['create', 'destroy', 'getFilePaths', 'getLoggingUrl'],
};

describe('driver callable-method surface', () => {
    for (const [key, DriverClass] of Object.entries(puterDrivers)) {
        const instance = new (DriverClass as new (
            ...a: [any, any, any, any]
        ) => object)(...fake());
        const callable = resolveCallableMethods(instance);

        it(`${key}: exposes exactly its declared RPC methods`, () => {
            expect([...callable].sort()).toEqual(EXPECTED[key]);
        });

        it(`${key}: never exposes lifecycle/framework methods`, () => {
            for (const reserved of RESERVED_DRIVER_METHODS) {
                expect(callable.has(reserved)).toBe(false);
            }
            for (const framework of [
                'constructor',
                'toString',
                'valueOf',
                'hasOwnProperty',
                'isPrototypeOf',
            ]) {
                expect(callable.has(framework)).toBe(false);
            }
        });
    }
});
