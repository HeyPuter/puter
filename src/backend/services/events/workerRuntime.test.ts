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
    EVENTS_INVOKE_KEY_VERSION,
    eventsInvokeKey,
    eventsWorkerScope,
    eventsWorkerScript,
} from './workerRuntime.js';

const SET_HASH = 'a1'.repeat(32);
const OTHER_HASH = 'b2'.repeat(32);

describe('eventsWorkerScript', () => {
    it('names the script after the handler set, within the name grammar', () => {
        const script = eventsWorkerScript(SET_HASH, '');
        expect(script).toBe(eventsWorkerScript(SET_HASH, ''));
        // The worker-name grammar the deploy machinery enforces.
        expect(script).toMatch(/^evw-[a-f0-9]{32}$/);
        expect(script).not.toBe(eventsWorkerScript(OTHER_HASH, ''));
    });

    it('scopes the name to the backend, so two backends never share one script', () => {
        const staging = eventsWorkerScript(SET_HASH, 'https://staging.example');
        const prod = eventsWorkerScript(SET_HASH, 'https://prod.example');
        expect(staging).not.toBe(prod);
        // Same scope, same set: stable, and independent of the other scope.
        expect(eventsWorkerScript(SET_HASH, 'https://staging.example')).toBe(
            staging,
        );
        expect(staging).toMatch(/^evw-[a-f0-9]{32}$/);
        expect(prod).toMatch(/^evw-[a-f0-9]{32}$/);
    });
});

describe('eventsWorkerScope', () => {
    it('reads the same field `#cfDeploy` binds as `puter_endpoint`, and falls back to empty', () => {
        expect(eventsWorkerScope({})).toBe('');
        expect(
            eventsWorkerScope({ workers: { internetExposedUrl: 'https://x' } }),
        ).toBe('https://x');
    });
});

describe('eventsInvokeKey', () => {
    it('derives per script, per secret, and carries its version', () => {
        const key = eventsInvokeKey('secret', 'evw-a');
        expect(key.startsWith(`${EVENTS_INVOKE_KEY_VERSION}:`)).toBe(true);
        expect(key).toBe(eventsInvokeKey('secret', 'evw-a'));
        expect(key).not.toBe(eventsInvokeKey('secret', 'evw-b'));
        expect(key).not.toBe(eventsInvokeKey('rotated', 'evw-a'));
        // Nothing of the secret survives into what a worker is handed.
        expect(key).not.toContain('secret');
    });
});
