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

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INTERNAL_AUTH_HEADER } from '../../core/http/middleware/internalAuth.js';
import type { PuterServer } from '../../server.js';
import type { ActiveCall } from '../../services/alarm/AlarmCallService.js';
import { allocateEphemeralPort, setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { formatCalls } from './AlarmController.js';

const SECRET = 'alarm-calls-test-secret';

/** Alarms raised in a real server, polled over a real socket. */
describe('GET /alarms/calls', () => {
    let server: PuterServer;
    let port: number;

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${port}`,
                api_base_url: `http://api.puter.localhost:${port}`,
                pager: {
                    calls: {
                        secret: SECRET,
                        rules: {
                            'billing:*': 'billing',
                            'ai:outage:*': 'ai',
                        },
                    },
                },
            } as unknown as IConfig,
            { listen: true },
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});
    }, 120_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        await server?.shutdown();
    });

    const get = (path: string, headers: Record<string, string> = {}) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = http.request(
                {
                    host: '127.0.0.1',
                    port,
                    path,
                    headers: {
                        host: `api.puter.localhost:${port}`,
                        ...headers,
                    },
                },
                (res) => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => (body += chunk));
                    res.on('end', () =>
                        resolve({ status: res.statusCode ?? 0, body }),
                    );
                },
            );
            req.on('error', reject);
            req.end();
        });

    const poll = (query = '') =>
        get(`/alarms/calls${query}`, { [INTERNAL_AUTH_HEADER]: SECRET });

    it('refuses a request without the secret', async () => {
        expect((await get('/alarms/calls')).status).toBe(403);
        expect(
            (
                await get('/alarms/calls', {
                    [INTERNAL_AUTH_HEADER]: 'wrong',
                })
            ).status,
        ).toBe(403);
    });

    it('rejects a group that cannot name one', async () => {
        expect((await poll('?group=a%20b')).status).toBe(400);
        expect((await poll('?group=a&group=b')).status).toBe(400);
    });

    it('answers 200 while nothing is calling', async () => {
        const res = await poll('?group=billing');
        expect(res.status).toBe(200);
        expect(res.body).toBe('no active calls');
    });

    it('answers 503 for the group an alarm calls, until it expires', async () => {
        server.clients.alarm.create(
            'billing:topup_stuck:tx1',
            'Top-up stuck crediting',
            {},
            'info',
        );
        // Not a call: no rule names it.
        server.clients.alarm.create('other:thing', 'unrelated', {}, 'info');

        await vi.waitFor(async () =>
            expect((await poll('?group=billing')).status).toBe(503),
        );
        const res = await poll('?group=billing');
        expect(res.body).toContain('1 active call');
        expect(res.body).toContain('[billing] Top-up stuck crediting');

        expect((await poll('?group=ai')).status).toBe(200);
        const all = await poll();
        expect(all.status).toBe(503);
        expect(all.body).not.toContain('unrelated');

        const {
            calls: [call],
        } = await server.services.alarmCalls.listActive('billing');
        expect(call).toMatchObject({
            group: 'billing',
            id: 'billing:topup_stuck:tx1',
            severity: 'info',
            links: [],
        });

        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(Date.now() + 31 * 60 * 1000);
            expect((await poll('?group=billing')).status).toBe(200);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('formatCalls', () => {
    const call = (over: Partial<ActiveCall> = {}): ActiveCall => ({
        group: 'billing',
        id: 'billing:stuck',
        shortId: 'amber-delta-fox',
        message: 'Top-up stuck',
        severity: 'info',
        count: 1,
        links: [],
        at: 0,
        ...over,
    });

    it('links each call to its message, or names it by short id', () => {
        expect(
            formatCalls([
                call({ links: ['https://chat/msg/1'], count: 3 }),
                call({ group: 'ai', message: 'Provider down' }),
            ]),
        ).toBe(
            '2 active calls\n' +
                '[billing] Top-up stuck (x3) https://chat/msg/1\n' +
                '[ai] Provider down amber-delta-fox',
        );
    });

    it('marks a listing that stopped early', () => {
        expect(formatCalls([], false)).toBe('call listing incomplete');
        expect(formatCalls([call()], false)).toMatch(/^1\+ active call\n/);
    });

    it('stays short enough for a monitor to keep', () => {
        const body = formatCalls(
            Array.from({ length: 20 }, (_, i) =>
                call({ message: `${'x'.repeat(200)} ${i}` }),
            ),
        );
        expect(body.length).toBeLessThanOrEqual(480);
        expect(body).toMatch(/\n\+\d+ more$/);
        expect(body.startsWith('20 active calls')).toBe(true);
    });
});
