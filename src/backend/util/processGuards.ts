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
 * Process-level error visibility.
 *
 * A request handler can kill the whole process without any of its own code
 * throwing: an `'error'` event on a stream nobody is listening to becomes an
 * uncaught exception, and the default response is to exit. Every other
 * in-flight request dies with it.
 *
 * The guards here make that visible, and optionally survivable.
 */

export type ProcessFaultKind = 'uncaughtException' | 'unhandledRejection';

export interface ProcessGuardOptions {
    /**
     * Stay alive after an uncaught exception instead of exiting.
     *
     * Off by default, because a process that resumes after an uncaught
     * exception may be holding half-applied state, and Node treats resuming as
     * undefined behavior. Turn it on where an exit is the more expensive
     * failure — a small pool of nodes behind a health check, where one bad
     * request would otherwise take out the whole pool's worth of live
     * requests.
     */
    keepAliveOnUncaught?: boolean;
    /**
     * Called for every fault, before the exit decision. Use it to raise an
     * alarm; it must not throw.
     */
    onFault?: (kind: ProcessFaultKind, error: unknown, origin?: string) => void;
}

/**
 * Install process-level fault logging. Returns a function that removes every
 * listener it added, so a server can install per boot without leaking listeners
 * across restarts (or across test files).
 */
export const installProcessGuards = (
    options: ProcessGuardOptions = {},
): (() => void) => {
    const { keepAliveOnUncaught = false, onFault } = options;

    const report = (
        kind: ProcessFaultKind,
        error: unknown,
        origin?: string,
    ) => {
        // One console call per fault: with structured logging installed, that
        // keeps the whole stack in a single log event.
        console.error(
            `${kind}${origin && origin !== kind ? ` (${origin})` : ''}`,
            error,
        );
        if (!onFault) return;
        try {
            onFault(kind, error, origin);
        } catch (faultHandlerError) {
            console.error('process fault handler threw', faultHandlerError);
        }
    };

    // `uncaughtExceptionMonitor` sees every uncaught exception — including the
    // ones that are about to be fatal — without suppressing Node's default
    // handling. It is the only way to log a crash and still crash.
    const onMonitor = (error: Error, origin: string) =>
        report('uncaughtException', error, origin);
    process.on('uncaughtExceptionMonitor', onMonitor);

    // Registering an 'uncaughtException' listener is what actually stops the
    // exit; the monitor above has already logged, so this body stays empty.
    const onUncaught = () => {};
    // Node's default for an unhandled rejection is to raise it as an uncaught
    // exception, which the monitor already reports. Only take it over when the
    // process is meant to survive.
    const onRejection = (reason: unknown) =>
        report('unhandledRejection', reason);

    if (keepAliveOnUncaught) {
        process.on('uncaughtException', onUncaught);
        process.on('unhandledRejection', onRejection);
    }

    return () => {
        process.off('uncaughtExceptionMonitor', onMonitor);
        if (keepAliveOnUncaught) {
            process.off('uncaughtException', onUncaught);
            process.off('unhandledRejection', onRejection);
        }
    };
};
