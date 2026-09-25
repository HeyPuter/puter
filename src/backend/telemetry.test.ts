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

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { shutdownTelemetry } from './util/telemetryShutdown.js';

const sdk = vi.hoisted(() => ({
    start: vi.fn(),
    shutdown: vi.fn(async () => {}),
}));
vi.mock('@opentelemetry/sdk-node', () => ({
    NodeSDK: class {
        start() {
            sdk.start();
        }
        shutdown() {
            return sdk.shutdown();
        }
    },
}));
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
    getNodeAutoInstrumentations: () => [],
}));

let sigtermBefore: number;
let sigintBefore: number;

beforeAll(async () => {
    sigtermBefore = process.listenerCount('SIGTERM');
    sigintBefore = process.listenerCount('SIGINT');
    await import('./telemetry.js');
});

describe('telemetry preload', () => {
    it('starts the SDK without taking over process signals', () => {
        expect(sdk.start).toHaveBeenCalledTimes(1);
        expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
        expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
    });

    it('hands SDK shutdown to shutdownTelemetry', async () => {
        await shutdownTelemetry(1_000);
        expect(sdk.shutdown).toHaveBeenCalledTimes(1);
    });
});
