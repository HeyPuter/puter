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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installJsonConsole } from './jsonConsole.js';

/**
 * Capture what the patched console writes to stdout/stderr. Returns the raw
 * chunks plus helpers to parse them, then uninstall() restores everything.
 */
const withInstalledConsole = (
    options?: Parameters<typeof installJsonConsole>[0],
) => {
    const out: string[] = [];
    const err: string[] = [];
    const stdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
            out.push(String(chunk));
            return true;
        });
    const stderr = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
            err.push(String(chunk));
            return true;
        });
    const uninstall = installJsonConsole(options);
    return {
        out,
        err,
        uninstall: () => {
            uninstall();
            stdout.mockRestore();
            stderr.mockRestore();
        },
    };
};

describe('installJsonConsole', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('emits one JSON line per call with level, timestamp and msg', () => {
        const { out, uninstall } = withInstalledConsole();
        try {
            console.log('hello world');
        } finally {
            uninstall();
        }

        expect(out).toHaveLength(1);
        expect(out[0].endsWith('\n')).toBe(true);
        const entry = JSON.parse(out[0]);
        expect(entry.level).toBe('info');
        expect(entry.msg).toBe('hello world');
        expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
        expect(entry.timestamp).toBe(new Date(entry.timestamp).toISOString());
    });

    it('maps each console method to the expected level and stream', () => {
        const { out, err, uninstall } = withInstalledConsole();
        try {
            console.info('i');
            console.debug('d');
            console.warn('w');
            console.error('e');
        } finally {
            uninstall();
        }

        expect(out.map((l) => JSON.parse(l).level)).toEqual(['info', 'debug']);
        expect(err.map((l) => JSON.parse(l).level)).toEqual(['warn', 'error']);
    });

    it('formats non-string args like console does (objects preserved)', () => {
        const { out, uninstall } = withInstalledConsole();
        try {
            console.log('user', { id: 5, roles: ['a'] }, [1, 2]);
        } finally {
            uninstall();
        }

        const entry = JSON.parse(out[0]);
        expect(entry.msg).toBe("user { id: 5, roles: [ 'a' ] } [ 1, 2 ]");
    });

    it('collapses a multi-line stack trace into a single log event', () => {
        const { err, uninstall } = withInstalledConsole();
        try {
            console.error(new Error('boom'));
        } finally {
            uninstall();
        }

        // Exactly one write, one trailing newline, no interior raw newlines
        // (the stack lives inside the JSON-escaped `msg` string).
        expect(err).toHaveLength(1);
        expect(err[0].match(/\n/g)).toHaveLength(1);
        const entry = JSON.parse(err[0]);
        expect(entry.level).toBe('error');
        expect(entry.msg).toContain('Error: boom');
        expect(entry.msg).toContain('\n    at '); // stack frames survive in msg
    });

    it('attaches traceId/spanId only when a span is active', () => {
        let ctx: { traceId: string; spanId?: string } | undefined;
        const { out, uninstall } = withInstalledConsole({
            getTraceContext: () => ctx,
        });
        try {
            console.log('no span');
            ctx = { traceId: 'abc123', spanId: 'def456' };
            console.log('with span');
        } finally {
            uninstall();
        }

        const first = JSON.parse(out[0]);
        expect(first).not.toHaveProperty('traceId');
        const second = JSON.parse(out[1]);
        expect(second.traceId).toBe('abc123');
        expect(second.spanId).toBe('def456');
    });

    it('restores the original console methods on uninstall', () => {
        const before = console.log;
        const { uninstall } = withInstalledConsole();
        expect(console.log).not.toBe(before);
        uninstall();
        expect(console.log).toBe(before);
    });

    it('is idempotent — a second install is a no-op', () => {
        const { out, uninstall } = withInstalledConsole();
        const second = installJsonConsole();
        try {
            console.log('once');
        } finally {
            second();
            uninstall();
        }
        // Still a single JSON line, not double-patched.
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0]).msg).toBe('once');
    });
});
