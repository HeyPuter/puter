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
 * Hand-off between the telemetry preload and the entry point that owns process
 * exit: the preload registers how to stop the SDK, the owner calls
 * `shutdownTelemetry()` as its last shutdown step. Imports nothing, so reaching
 * it never loads the SDK.
 */
type TelemetryShutdown = () => Promise<void>;

let registered: TelemetryShutdown | null = null;

/** Returns a function that removes the registration. */
export const registerTelemetryShutdown = (
    shutdown: TelemetryShutdown,
): (() => void) => {
    registered = shutdown;
    return () => {
        if (registered === shutdown) registered = null;
    };
};

/**
 * Flush and stop telemetry if a preload registered it. Settles within
 * `timeoutMs` even when the export endpoint is gone, and never rejects.
 */
export const shutdownTelemetry = async (timeoutMs: number): Promise<void> => {
    const shutdown = registered;
    registered = null;
    if (!shutdown) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
        const outcome = await Promise.race([
            shutdown().then(() => 'done' as const),
            timedOut,
        ]);
        if (outcome === 'timeout') {
            console.warn(
                `[telemetry] shutdown did not finish within ${timeoutMs}ms`,
            );
        }
    } catch (err) {
        console.error('[telemetry] shutdown error', err);
    } finally {
        clearTimeout(timer);
    }
};
