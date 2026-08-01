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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '../../util/kvSingleton.js';
import { ServerHealthService } from './ServerHealthService.js';

const STATUS_CACHE_KEY = 'server-health:status';
const CHECK_INTERVAL_MS = 5000;

interface Harness {
    service: ServerHealthService;
    dbRead: ReturnType<typeof vi.fn>;
    hasIO: ReturnType<typeof vi.fn>;
}

const makeService = (
    config: Record<string, unknown> = {},
    opts: { db?: boolean; socket?: boolean } = {},
): Harness => {
    const dbRead = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const hasIO = vi.fn().mockReturnValue(true);
    const clients = opts.db === false ? {} : { db: { read: dbRead } };
    const services = opts.socket === false ? {} : { socket: { hasIO } };
    const args = [
        config,
        clients,
        {},
        services,
    ] as unknown as ConstructorParameters<typeof ServerHealthService>;
    return { service: new ServerHealthService(...args), dbRead, hasIO };
};

/** Run one full check cycle by advancing past the loop interval. */
const runCycle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS + 1);
};

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    // The 5s status cache is process-wide; a stale entry would leak between
    // tests.
    kv.del(STATUS_CACHE_KEY);
    vi.useFakeTimers();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    kv.del(STATUS_CACHE_KEY);
});

describe('ServerHealthService.addCheck', () => {
    it('runs a registered check every cycle and reports it healthy', async () => {
        const { service } = makeService();
        const check = vi.fn().mockResolvedValue(undefined);
        service.addCheck('custom', check);
        service.onServerStart();

        await runCycle();
        expect(check).toHaveBeenCalledTimes(1);
        expect(await service.getStatus()).toEqual({ ok: true });
        expect(service.getStats().failed_checks).toEqual([]);
        expect(service.getStats().check_durations_ms).toHaveProperty('custom');

        service.onServerShutdown();
    });

    it('reports a failing check and fires its onFail hook only on the transition', async () => {
        const { service } = makeService();
        const onFail = vi.fn();
        let failing = true;
        service
            .addCheck('flaky', () => {
                if (failing) throw new Error('nope');
            })
            .onFail(onFail);
        service.onServerStart();

        await runCycle();
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['flaky'],
        });
        expect(onFail).toHaveBeenCalledTimes(1);
        expect(onFail.mock.calls[0][0]).toBeInstanceOf(Error);

        // Still failing — the self-heal hook must not re-fire every cycle.
        kv.del(STATUS_CACHE_KEY);
        await runCycle();
        expect(onFail).toHaveBeenCalledTimes(1);

        // Recovers.
        failing = false;
        kv.del(STATUS_CACHE_KEY);
        await runCycle();
        expect(await service.getStatus()).toEqual({ ok: true });

        service.onServerShutdown();
    });

    it('keeps going when an onFail hook itself throws', async () => {
        const { service } = makeService();
        service
            .addCheck('bad', () => {
                throw new Error('check failed');
            })
            .onFail(() => {
                throw new Error('handler failed');
            });
        service.onServerStart();

        await runCycle();
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['bad'],
        });
        expect(errorSpy).toHaveBeenCalledWith(
            '[server-health] onFail handler for bad threw:',
            expect.anything(),
        );
        service.onServerShutdown();
    });

    it('fails a check that never settles, via the per-check timeout', async () => {
        const { service } = makeService();
        service.addCheck('hangs', () => new Promise(() => {}));
        service.onServerStart();

        // Loop tick, then the 4s check timeout.
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS + 1);
        await vi.advanceTimersByTimeAsync(4001);
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['hangs'],
        });
        service.onServerShutdown();
    });
});

describe('ServerHealthService — default checks', () => {
    it('passes when the database answers quickly and socket.io is attached', async () => {
        const { service, dbRead, hasIO } = makeService();
        service.onServerStart();
        await runCycle();

        expect(dbRead).toHaveBeenCalledWith('SELECT 1 AS ok');
        expect(hasIO).toHaveBeenCalled();
        expect(await service.getStatus()).toEqual({ ok: true });
        expect(service.getStats().database_liveness_latency_ms).toBeTypeOf(
            'number',
        );
        service.onServerShutdown();
    });

    it('fails when the liveness query comes back empty', async () => {
        const { service, dbRead } = makeService();
        dbRead.mockResolvedValue([]);
        service.onServerStart();
        await runCycle();
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['database-liveness'],
        });
        service.onServerShutdown();
    });

    it('fails when the liveness query is slower than the configured threshold', async () => {
        const { service, dbRead } = makeService({
            server_health: { db_liveness_latency_fail_ms: 10 },
        });
        dbRead.mockImplementation(async () => {
            // Advance the fake clock so the measured latency crosses over.
            vi.setSystemTime(Date.now() + 50);
            return [{ ok: 1 }];
        });
        service.onServerStart();
        await runCycle();
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['database-liveness'],
        });
        service.onServerShutdown();
    });

    it('fails when socket.io was never attached', async () => {
        const { service, hasIO } = makeService();
        hasIO.mockReturnValue(false);
        service.onServerStart();
        await runCycle();
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['socket-initialized'],
        });
        service.onServerShutdown();
    });

    it('registers neither default check when the dependencies are absent', async () => {
        const { service } = makeService({}, { db: false, socket: false });
        service.onServerStart();
        await runCycle();
        // No checks at all — healthy, and nothing timed.
        expect(await service.getStatus()).toEqual({ ok: true });
        expect(service.getStats().check_durations_ms).toEqual({});
        service.onServerShutdown();
    });
});

describe('ServerHealthService.getStatus — filtering', () => {
    const failingService = async () => {
        const { service } = makeService({}, { db: false, socket: false });
        service.addCheck('alpha', () => {
            throw new Error('a');
        });
        service.addCheck('beta', () => {
            throw new Error('b');
        });
        service.onServerStart();
        await runCycle();
        return service;
    };

    it('drops ignored failures and collapses back to healthy', async () => {
        const service = await failingService();
        expect(await service.getStatus({ ignore: ['alpha'] })).toEqual({
            ok: false,
            failed: ['beta'],
        });
        expect(await service.getStatus({ ignore: ['alpha', 'beta'] })).toEqual({
            ok: true,
        });
        service.onServerShutdown();
    });

    it('demotes degraded failures without flipping ok to false', async () => {
        const service = await failingService();
        expect(await service.getStatus({ degrade: ['alpha', 'beta'] })).toEqual(
            { ok: true, degraded: ['alpha', 'beta'] },
        );
        expect(await service.getStatus({ degrade: ['alpha'] })).toEqual({
            ok: false,
            failed: ['beta'],
            degraded: ['alpha'],
        });
        service.onServerShutdown();
    });

    it('leaves a healthy status untouched by filters', async () => {
        const { service } = makeService({}, { db: false, socket: false });
        service.onServerStart();
        await runCycle();
        expect(await service.getStatus({ ignore: ['anything'] })).toEqual({
            ok: true,
        });
        service.onServerShutdown();
    });

    it('caches the unfiltered status so filters never leak between callers', async () => {
        const service = await failingService();
        expect(await service.getStatus({ ignore: ['alpha', 'beta'] })).toEqual({
            ok: true,
        });
        // Same 5s window, no filters: the full failure set is still there.
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['alpha', 'beta'],
        });
        service.onServerShutdown();
    });
});

describe('ServerHealthService — loop staleness', () => {
    it('reports the loop as never started once the grace period lapses', async () => {
        const { service } = makeService({
            server_health: { stale_health_loop_fail_ms: 1000 },
        });
        // No onServerStart — nothing is driving the loop.
        expect(await service.getStatus()).toEqual({ ok: true });

        kv.del(STATUS_CACHE_KEY);
        vi.setSystemTime(Date.now() + 5000);
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['health-check-loop-not-running'],
        });
    });

    it('reports the loop as stale when cycles stop landing', async () => {
        const { service } = makeService(
            { server_health: { stale_health_loop_fail_ms: 1000 } },
            { db: false, socket: false },
        );
        service.onServerStart();
        await runCycle();
        expect(await service.getStatus()).toEqual({ ok: true });

        service.onServerShutdown();
        kv.del(STATUS_CACHE_KEY);
        vi.setSystemTime(Date.now() + 60_000);
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['health-check-loop-stale'],
        });
    });
});

describe('ServerHealthService — draining', () => {
    it('reports unhealthy so load balancers route away, and clears failures', async () => {
        const { service } = makeService({}, { db: false, socket: false });
        service.addCheck('alpha', () => {
            throw new Error('a');
        });
        service.onServerStart();
        await runCycle();

        service.onServerPrepareShutdown();
        expect(await service.getStatus()).toEqual({
            ok: false,
            failed: ['draining'],
        });
        expect(service.getStats().failed_checks).toEqual([]);

        // `draining` is a filterable state like any other.
        expect(await service.getStatus({ ignore: ['draining'] })).toEqual({
            ok: true,
        });

        // Cycles keep ticking while draining, but run no checks.
        await runCycle();
        expect(service.getStats().check_durations_ms).toEqual({});

        // Idempotent — a second prepare-shutdown is a no-op.
        logSpy.mockClear();
        service.onServerPrepareShutdown();
        expect(logSpy).not.toHaveBeenCalled();

        service.onServerShutdown();
    });
});

describe('ServerHealthService.getStats', () => {
    it('hands back a copy, not the live durations map', async () => {
        const { service } = makeService({}, { db: false, socket: false });
        service.addCheck('alpha', () => undefined);
        service.onServerStart();
        await runCycle();

        const stats = service.getStats();
        stats.check_durations_ms.alpha = 9999;
        expect(service.getStats().check_durations_ms.alpha).not.toBe(9999);
        service.onServerShutdown();
    });
});
