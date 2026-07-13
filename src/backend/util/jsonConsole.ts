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

import { format } from 'node:util';

/**
 * Console severity methods we replace, mapped to the `level` value emitted for
 * each. `log` collapses to `info` so downstream `level = "info"` / `"error"`
 * filters behave conventionally.
 */
const METHOD_LEVELS = {
    log: 'info',
    info: 'info',
    warn: 'warn',
    error: 'error',
    debug: 'debug',
} as const;

type ConsoleMethod = keyof typeof METHOD_LEVELS;

/** Identifiers for the currently-active trace, if any. */
export interface TraceContext {
    traceId: string;
    spanId?: string;
}

export interface JsonConsoleOptions {
    /**
     * Resolves the active trace context at log time, or `undefined` when no
     * recording span is active. Kept as a callback so this module carries no
     * telemetry dependency and stays trivially unit-testable.
     */
    getTraceContext?: () => TraceContext | undefined;
}

// Guard against double-installation across duplicate module instances.
const INSTALLED_FLAG = '__puterJsonConsoleInstalled';

/**
 * Replace the global console severity methods so every call emits exactly one
 * line of JSON: `{ level, timestamp, msg, traceId?, spanId? }`. `msg` is
 * `util.format`ed from the call args — byte-for-byte what console would have
 * printed — so multi-line values (stack traces, inspected objects) become a
 * single log event instead of being split across many by a line-oriented log
 * collector.
 *
 * Returns a function that restores the original console methods.
 */
export const installJsonConsole = (
    options: JsonConsoleOptions = {},
): (() => void) => {
    const globals = globalThis as Record<string, unknown>;
    if (globals[INSTALLED_FLAG]) return () => {};

    const { getTraceContext } = options;
    const originals = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;

    for (const method of Object.keys(METHOD_LEVELS) as ConsoleMethod[]) {
        // Keep the exact reference so uninstall() restores it identically.
        const original = console[method] as (...args: unknown[]) => void;
        originals[method] = original;

        const level = METHOD_LEVELS[method];
        // Match console's stream routing so stderr keeps carrying warnings and
        // errors even in JSON mode.
        const stream =
            method === 'warn' || method === 'error'
                ? process.stderr
                : process.stdout;

        console[method] = (...args: unknown[]): void => {
            try {
                const entry: Record<string, unknown> = {
                    level,
                    timestamp: new Date().toISOString(),
                    msg: format(...args),
                };
                const trace = getTraceContext?.();
                if (trace?.traceId) {
                    entry.traceId = trace.traceId;
                    if (trace.spanId) entry.spanId = trace.spanId;
                }
                stream.write(`${JSON.stringify(entry)}\n`);
            } catch {
                // Logging must never take down the process — fall back to the
                // untouched console method if formatting/serialization throws.
                original.apply(console, args);
            }
        };
    }

    globals[INSTALLED_FLAG] = true;

    return () => {
        for (const method of Object.keys(originals) as ConsoleMethod[]) {
            console[method] = originals[method];
        }
        delete globals[INSTALLED_FLAG];
    };
};
