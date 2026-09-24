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

import { shutdownTelemetry } from './telemetryShutdown.js';

/** What a graceful shutdown drives; `PuterServer` satisfies it. */
export interface ShutdownTarget {
    prepareShutdown(): Promise<void>;
    shutdown(): Promise<void>;
}

export interface GracefulShutdownOptions {
    /**
     * How long to keep serving after new connections stop, before teardown. A
     * function is called with the signal that triggered shutdown, so a
     * deployment can drain on `SIGTERM` but exit `SIGINT` (Ctrl-C) instantly.
     */
    drainMs: number | ((signal: string) => number);
    /** Cap on the final telemetry flush. */
    telemetryTimeoutMs?: number;
    /**
     * Cap on teardown plus flush, after the drain. Keep `drainMs + hardLimitMs`
     * under the supervisor's kill deadline so the exit (and its logs) are
     * ours.
     */
    hardLimitMs?: number;
    exit?: (code: number) => void;
}

export const DEFAULT_TELEMETRY_SHUTDOWN_TIMEOUT_MS = 5_000;
export const DEFAULT_SHUTDOWN_HARD_LIMIT_MS = 25_000;

/**
 * The process's one shutdown sequence: stop accepting connections, drain, tear
 * the server down, flush telemetry, exit. Calls made while it runs return the
 * same promise instead of starting a second shutdown.
 */
export const createGracefulShutdown = (
    target: ShutdownTarget,
    options: GracefulShutdownOptions,
): ((signal: string) => Promise<void>) => {
    const {
        drainMs,
        telemetryTimeoutMs = DEFAULT_TELEMETRY_SHUTDOWN_TIMEOUT_MS,
        hardLimitMs = DEFAULT_SHUTDOWN_HARD_LIMIT_MS,
        exit = (code: number) => process.exit(code),
    } = options;
    let running: Promise<void> | null = null;
    let exited = false;
    const exitOnce = (code: number) => {
        if (exited) return;
        exited = true;
        exit(code);
    };

    const run = async (signal: string): Promise<void> => {
        const drain = typeof drainMs === 'function' ? drainMs(signal) : drainMs;
        console.log(`[shutdown] ${signal} received; draining for ${drain}ms`);
        const watchdog = setTimeout(() => {
            console.error(
                `[shutdown] not finished ${drain + hardLimitMs}ms after ${signal}; forcing exit`,
            );
            exitOnce(1);
        }, drain + hardLimitMs);
        let exitCode = 0;
        try {
            await target.prepareShutdown();
        } catch (err) {
            console.error('[shutdown] prepareShutdown failed', err);
        }
        if (drain > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, drain));
        }
        try {
            await target.shutdown();
        } catch (err) {
            console.error('[shutdown] server shutdown failed', err);
            exitCode = 1;
        }
        // Last, so spans and metrics recorded during teardown are exported too.
        await shutdownTelemetry(telemetryTimeoutMs);
        clearTimeout(watchdog);
        exitOnce(exitCode);
    };

    return (signal) => {
        if (running) {
            console.log(
                `[shutdown] ${signal} received; shutdown already in progress`,
            );
            return running;
        }
        running = run(signal);
        return running;
    };
};
