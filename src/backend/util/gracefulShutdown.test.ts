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
    createGracefulShutdown,
    type ShutdownTarget,
} from './gracefulShutdown.js';
import { registerTelemetryShutdown } from './telemetryShutdown.js';

let events: string[] = [];
let unregisterTelemetry: (() => void) | null = null;

const makeTarget = (opts?: {
    prepareFails?: boolean;
    shutdownFails?: boolean;
    shutdownHangs?: boolean;
}): ShutdownTarget => ({
    prepareShutdown: async () => {
        events.push('prepare');
        if (opts?.prepareFails) throw new Error('prepare failed');
    },
    shutdown: async () => {
        if (opts?.shutdownHangs) return new Promise(() => {});
        events.push('shutdown');
        if (opts?.shutdownFails) throw new Error('shutdown failed');
    },
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    events = [];
    unregisterTelemetry = registerTelemetryShutdown(async () => {
        events.push('telemetry');
    });
});

afterEach(() => {
    unregisterTelemetry?.();
    unregisterTelemetry = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('createGracefulShutdown', () => {
    it('drains for the configured window, then tears down, flushes and exits 0', async () => {
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(makeTarget(), {
            drainMs: 90_000,
            exit,
        });

        const done = trigger('SIGTERM');
        await vi.advanceTimersByTimeAsync(89_999);
        expect(events).toEqual(['prepare']);
        expect(exit).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await done;
        expect(events).toEqual(['prepare', 'shutdown', 'telemetry', 'exit:0']);
    });

    it('SIGINT with a drain function returning 0 for SIGINT exits without waiting', async () => {
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const drainMs = (signal: string) => (signal === 'SIGTERM' ? 90_000 : 0);
        const trigger = createGracefulShutdown(makeTarget(), {
            drainMs,
            exit,
        });

        await trigger('SIGINT');
        expect(events).toEqual(['prepare', 'shutdown', 'telemetry', 'exit:0']);
    });

    it('runs prepare/shutdown/exit exactly once across repeat signals during the drain', async () => {
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(makeTarget(), {
            drainMs: 1_000,
            exit,
        });

        const first = trigger('SIGTERM');
        const second = trigger('SIGTERM');
        const third = trigger('SIGINT');
        await vi.advanceTimersByTimeAsync(1_000);
        await Promise.all([first, second, third]);

        expect(events.filter((e) => e === 'prepare')).toHaveLength(1);
        expect(events.filter((e) => e === 'shutdown')).toHaveLength(1);
        expect(events.filter((e) => e === 'exit:0')).toHaveLength(1);
    });

    it('exits 0 once the telemetry cap elapses, even if telemetry never settles', async () => {
        unregisterTelemetry?.();
        unregisterTelemetry = registerTelemetryShutdown(
            () => new Promise(() => {}),
        );
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(makeTarget(), {
            drainMs: 0,
            telemetryTimeoutMs: 5_000,
            exit,
        });

        const done = trigger('SIGTERM');
        await vi.advanceTimersByTimeAsync(5_000);
        await done;
        expect(exit).toHaveBeenCalledWith(0);
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it('still flushes telemetry and exits 1 when shutdown() rejects', async () => {
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(
            makeTarget({ shutdownFails: true }),
            {
                drainMs: 0,
                exit,
            },
        );

        await trigger('SIGTERM');
        expect(events).toContain('telemetry');
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('the watchdog forces exit 1 exactly once if shutdown() never settles', async () => {
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(
            makeTarget({ shutdownHangs: true }),
            { drainMs: 1_000, hardLimitMs: 25_000, exit },
        );

        const done = trigger('SIGTERM');
        await vi.advanceTimersByTimeAsync(25_999);
        expect(exit).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);

        // The hung shutdown() promise never resolves, so nothing beyond the
        // watchdog's own exit call should follow.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(exit).toHaveBeenCalledTimes(1);
        void done;
    });

    it('exits 0 when no telemetry preload registered anything', async () => {
        unregisterTelemetry?.();
        unregisterTelemetry = null;
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(makeTarget(), {
            drainMs: 0,
            exit,
        });

        await trigger('SIGINT');
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('still drains, tears down and exits when prepareShutdown() rejects', async () => {
        const exit = vi.fn((code: number) => events.push(`exit:${code}`));
        const trigger = createGracefulShutdown(
            makeTarget({ prepareFails: true }),
            { drainMs: 0, exit },
        );

        await trigger('SIGTERM');
        expect(events).toEqual(['prepare', 'shutdown', 'telemetry', 'exit:0']);
    });
});
