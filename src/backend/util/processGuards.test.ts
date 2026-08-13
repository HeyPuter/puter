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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProcessGuards } from './processGuards.js';

// The guards mutate global process state, so every test tears its own down and
// asserts against listener counts taken before installing.
const counts = () => ({
    monitor: process.listenerCount('uncaughtExceptionMonitor'),
    uncaught: process.listenerCount('uncaughtException'),
    rejection: process.listenerCount('unhandledRejection'),
});

let uninstall: (() => void) | null = null;

afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.restoreAllMocks();
});

describe('installProcessGuards', () => {
    it('watches exceptions without suppressing them by default', () => {
        const before = counts();
        uninstall = installProcessGuards();
        const after = counts();

        // The monitor observes; it does not stop Node from exiting.
        expect(after.monitor).toBe(before.monitor + 1);
        expect(after.uncaught).toBe(before.uncaught);
        expect(after.rejection).toBe(before.rejection);
    });

    it('suppresses the exit only when asked to keep serving', () => {
        const before = counts();
        uninstall = installProcessGuards({ keepAliveOnUncaught: true });
        const after = counts();

        expect(after.monitor).toBe(before.monitor + 1);
        expect(after.uncaught).toBe(before.uncaught + 1);
        expect(after.rejection).toBe(before.rejection + 1);
    });

    it('removes every listener it added', () => {
        const before = counts();
        installProcessGuards({ keepAliveOnUncaught: true })();
        expect(counts()).toEqual(before);
    });

    it('logs the fault and reports it to onFault', () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const onFault = vi.fn();
        uninstall = installProcessGuards({ onFault });

        const error = new Error('boom');
        process.emit('uncaughtExceptionMonitor', error, 'uncaughtException');

        expect(onFault).toHaveBeenCalledWith(
            'uncaughtException',
            error,
            'uncaughtException',
        );
        expect(consoleError).toHaveBeenCalledWith('uncaughtException', error);
    });

    it('survives an onFault that throws', () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        uninstall = installProcessGuards({
            onFault: () => {
                throw new Error('alarm unavailable');
            },
        });

        expect(() =>
            process.emit(
                'uncaughtExceptionMonitor',
                new Error('boom'),
                'uncaughtException',
            ),
        ).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
            'process fault handler threw',
            expect.any(Error),
        );
    });

    it('labels a rejection surfaced through the monitor', () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        uninstall = installProcessGuards();

        const error = new Error('rejected');
        process.emit('uncaughtExceptionMonitor', error, 'unhandledRejection');

        expect(consoleError).toHaveBeenCalledWith(
            'uncaughtException (unhandledRejection)',
            error,
        );
    });
});
