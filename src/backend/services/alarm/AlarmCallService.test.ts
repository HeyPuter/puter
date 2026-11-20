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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AlarmCall } from '../../clients/alarm/types.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import {
    DEFAULT_CALL_TTL_MS,
    MAX_LISTED_CALLS,
    MIN_CALL_TTL_MS,
} from './AlarmCallService.js';
import type { IConfig } from '../../types.js';

// The floor, so the ttl the service uses is the one configured here.
const TTL_MS = MIN_CALL_TTL_MS;

describe('AlarmCallService', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer({
            pager: {
                calls: {
                    rules: { 'billing:*': 'billing' },
                    secret: 'test-secret',
                    ttlMs: TTL_MS,
                },
            },
        } as unknown as IConfig);
    }, 120_000);

    afterAll(async () => {
        await server?.shutdown();
    });

    const call = (id: string, links: string[] = []): AlarmCall => ({
        group: 'billing',
        links,
        alert: {
            id,
            dedupKey: id,
            shortId: 'amber-delta-fox',
            message: 'x'.repeat(500),
            source: 'alarm',
            severity: 'warning',
            fields: {},
            repeatCount: 4,
            isRepeat: true,
            callGroup: 'billing',
        },
    });

    it('stores a capped message and expires with the configured ttl', async () => {
        const service = server.services.alarmCalls;
        await service.record(call('billing:capped'));

        const [stored] = (await service.listActive('billing')).calls.filter(
            (c) => c.id === 'billing:capped',
        );
        expect(stored.message).toHaveLength(200);
        expect(stored.count).toBe(4);

        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(Date.now() + TTL_MS + 1000);
            const { calls } = await service.listActive('billing');
            const ids = calls.map((c) => c.id);
            expect(ids).not.toContain('billing:capped');
        } finally {
            vi.useRealTimers();
        }
    });

    it('finds a live call behind more expired rows than one listing reads', async () => {
        const past = Math.floor(Date.now() / 1000) - 60;
        const expired = Array.from(
            { length: 12 * MAX_LISTED_CALLS },
            (_, i) => ({
                key: `paging:a${String(i).padStart(4, '0')}`,
                value: { group: 'paging', id: `dead:${i}`, at: 0 },
                expireAt: past,
            }),
        );
        for (let i = 0; i < expired.length; i += 25) {
            await server.stores.kv.batchPut(
                { items: expired.slice(i, i + 25) },
                { systemPartition: 'alarmCalls' },
            );
        }
        await server.services.alarmCalls.record({
            ...call('paging:live'),
            group: 'paging',
        });

        const { calls, complete } =
            await server.services.alarmCalls.listActive('paging');
        expect(complete).toBe(true);
        expect(calls.map((c) => c.id)).toEqual(['paging:live']);
    });

    it('rewrites a repeat only for a new link or once a third of the ttl has passed', async () => {
        const service = server.services.alarmCalls;
        const set = vi.spyOn(server.stores.kv, 'set');
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await service.record(call('billing:hot'));
            await service.record(call('billing:hot'));
            expect(set).toHaveBeenCalledTimes(1);

            await service.record(call('billing:hot', ['https://chat/msg/1']));
            expect(set).toHaveBeenCalledTimes(2);

            vi.setSystemTime(Date.now() + TTL_MS / 3 + 1);
            await service.record(call('billing:hot', ['https://chat/msg/1']));
            expect(set).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
            set.mockRestore();
        }
    });
});

describe('AlarmCallService without a secret', () => {
    it('records nothing, since no monitor could read it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const server = await setupTestServer({
            pager: { calls: { rules: { 'billing:*': 'billing' } } },
        } as unknown as IConfig);
        try {
            server.clients.alarm.create('billing:stuck', 'stuck', {}, 'info');
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(await server.services.alarmCalls.listActive()).toEqual({
                calls: [],
                complete: true,
            });
            expect(warn).toHaveBeenCalledWith(
                '[alarm] pager.calls has rules but no secret',
            );
        } finally {
            warn.mockRestore();
            await server.shutdown();
        }
    }, 120_000);
});

describe('AlarmCallService ttl', () => {
    it('floors a short ttl and defaults a missing one', async () => {
        const record = async (ttlMs?: number) => {
            const server = await setupTestServer({
                pager: {
                    calls: {
                        rules: { 'billing:*': 'billing' },
                        secret: 's',
                        ...(ttlMs === undefined ? {} : { ttlMs }),
                    },
                },
            } as unknown as IConfig);
            const set = vi.spyOn(server.stores.kv, 'set');
            try {
                const before = Date.now();
                await server.services.alarmCalls.record({
                    group: 'billing',
                    links: [],
                    alert: {
                        id: 'billing:x',
                        dedupKey: 'billing:x',
                        shortId: 'a-b-c',
                        message: 'x',
                        source: 'alarm',
                        severity: 'info',
                        fields: {},
                        repeatCount: 1,
                        isRepeat: false,
                    },
                });
                const { expireAt } = set.mock.calls[0][0] as {
                    expireAt: number;
                };
                return expireAt * 1000 - before;
            } finally {
                set.mockRestore();
                await server.shutdown();
            }
        };

        const floored = await record(30_000);
        expect(floored).toBeGreaterThanOrEqual(MIN_CALL_TTL_MS);
        expect(floored).toBeLessThan(MIN_CALL_TTL_MS + 5_000);
        const defaulted = await record();
        expect(defaulted).toBeGreaterThanOrEqual(DEFAULT_CALL_TTL_MS);
        expect(defaulted).toBeLessThan(DEFAULT_CALL_TTL_MS + 5_000);
    }, 120_000);
});
