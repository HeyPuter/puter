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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    registerTelemetryShutdown,
    shutdownTelemetry,
} from './telemetryShutdown.js';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('shutdownTelemetry', () => {
    it('resolves with nothing registered', async () => {
        await expect(shutdownTelemetry(1_000)).resolves.toBeUndefined();
    });

    it('runs the registered shutdown once; a second call is a no-op', async () => {
        const shutdown = vi.fn(async () => {});
        registerTelemetryShutdown(shutdown);

        await shutdownTelemetry(1_000);
        expect(shutdown).toHaveBeenCalledTimes(1);

        await shutdownTelemetry(1_000);
        expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it('times out a shutdown that never settles, and warns', async () => {
        vi.useFakeTimers();
        registerTelemetryShutdown(() => new Promise(() => {}));

        let settled = false;
        const result = shutdownTelemetry(5_000).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(4_999);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await result;
        expect(settled).toBe(true);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('did not finish within 5000ms'),
        );
    });

    it('resolves undefined and logs when the registered shutdown rejects', async () => {
        registerTelemetryShutdown(async () => {
            throw new Error('sdk shutdown failed');
        });

        await expect(shutdownTelemetry(1_000)).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(
            '[telemetry] shutdown error',
            expect.any(Error),
        );
    });

    it('does not call the hook once it has been unregistered', async () => {
        const shutdown = vi.fn(async () => {});
        const unregister = registerTelemetryShutdown(shutdown);
        unregister();

        await shutdownTelemetry(1_000);
        expect(shutdown).not.toHaveBeenCalled();
    });
});
