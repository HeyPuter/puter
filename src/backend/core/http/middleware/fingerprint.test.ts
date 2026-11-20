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

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createFingerprintMiddleware } from './fingerprint';

const VALID_FP = 'dev-fingerprint-abc123';

const run = (
    reqPartial: Partial<Request> & Record<string, unknown>,
    opts?: Parameters<typeof createFingerprintMiddleware>[0],
) => {
    const middleware = createFingerprintMiddleware(opts);
    const req = {
        headers: {},
        ...reqPartial,
    } as unknown as Request;
    const next = vi.fn();
    middleware(req, {} as Response, next);
    return { req, next };
};

describe('createFingerprintMiddleware', () => {
    it('always sets a well-formed networkFingerprint and calls next', () => {
        const { req, next } = run({ ip: '203.0.113.1' });

        expect(req.networkFingerprint).toMatch(/^[A-Za-z0-9_-]{16}$/);
        expect(next).toHaveBeenCalledOnce();
    });

    it('networkFingerprint is stable for identical inputs and varies by UA', () => {
        const headers = { 'user-agent': 'UA/1.0' };
        const a = run({ ip: '203.0.113.1', headers }).req.networkFingerprint;
        const b = run({ ip: '203.0.113.1', headers }).req.networkFingerprint;
        const c = run({
            ip: '203.0.113.1',
            headers: { 'user-agent': 'UA/2.0' },
        }).req.networkFingerprint;

        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it('reads a well-shaped device fingerprint from the body', () => {
        const { req } = run({ body: { fingerprint: VALID_FP } });
        expect(req.deviceFingerprint).toBe(VALID_FP);
    });

    it('falls back to the x-puter-device-fingerprint header', () => {
        const { req } = run({
            headers: { 'x-puter-device-fingerprint': VALID_FP },
        });
        expect(req.deviceFingerprint).toBe(VALID_FP);
    });

    it('prefers the body fingerprint over the header', () => {
        const { req } = run({
            body: { fingerprint: VALID_FP },
            headers: { 'x-puter-device-fingerprint': 'other-fingerprint-xyz' },
        });
        expect(req.deviceFingerprint).toBe(VALID_FP);
    });

    it('drops a malformed fingerprint to undefined', () => {
        expect(
            run({ body: { fingerprint: 'bad fp!' } }).req.deviceFingerprint,
        ).toBeUndefined();
        expect(
            run({ body: { fingerprint: 'short' } }).req.deviceFingerprint,
        ).toBeUndefined();
        expect(
            run({ body: { fingerprint: 123 as unknown as string } }).req
                .deviceFingerprint,
        ).toBeUndefined();
    });

    it('leaves deviceFingerprint undefined when nothing was supplied', () => {
        const { req } = run({ ip: '203.0.113.1' });
        expect(req.deviceFingerprint).toBeUndefined();
    });

    it('reads the TLS fingerprint from the configured header only', () => {
        const ja4 = 't13d1516h2_8daaf6152771_02713d6af862';
        const headers = { 'x-tls-fp': ja4 };

        expect(run({ headers }).req.tlsFingerprint).toBeUndefined();
        expect(
            run({ headers }, { tlsFingerprintHeader: 'X-TLS-FP' }).req
                .tlsFingerprint,
        ).toBe(ja4);
        expect(
            run(
                { headers: { 'x-tls-fp': 'not a fingerprint!' } },
                { tlsFingerprintHeader: 'x-tls-fp' },
            ).req.tlsFingerprint,
        ).toBeUndefined();
    });

    describe('request signals', () => {
        const signalHeaders = {
            'X-Edge-Bot': 'bot',
            'x-edge-leaked': 'credential_exposed',
            'x-edge-bot-alt': 'bot',
        };

        it('is empty without configured headers', () => {
            const { req } = run({ headers: { 'x-edge-bot': '1' } });
            expect(req.requestSignals).toEqual([]);
        });

        it('are off, with one warning, when no value is configured', () => {
            const warn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            try {
                const middleware = createFingerprintMiddleware({
                    requestSignalHeaders: signalHeaders,
                });
                expect(warn).toHaveBeenCalledTimes(1);
                for (const value of ['1', 'yes']) {
                    const req = {
                        headers: { 'x-edge-bot': value, 'x-edge-leaked': value },
                    } as unknown as Request;
                    middleware(req, {} as Response, vi.fn());
                    expect(req.requestSignals).toEqual([]);
                }
                expect(warn).toHaveBeenCalledTimes(1);
            } finally {
                warn.mockRestore();
            }
        });

        it('counts each signal once, and never a header holding an empty value', () => {
            const { req } = run(
                {
                    headers: {
                        'x-edge-bot': 'proxy-secret',
                        'x-edge-bot-alt': 'proxy-secret',
                        'x-edge-leaked': '',
                    },
                },
                {
                    requestSignalHeaders: signalHeaders,
                    requestSignalValue: 'proxy-secret',
                },
            );
            expect(req.requestSignals).toEqual(['bot']);
        });

        it('counts only the configured value when one is set', () => {
            const opts = {
                requestSignalHeaders: signalHeaders,
                requestSignalValue: 'proxy-secret',
            };
            expect(
                run(
                    {
                        headers: {
                            'x-edge-bot': 'proxy-secret',
                            'x-edge-leaked': 'proxy-secret',
                        },
                    },
                    opts,
                ).req.requestSignals,
            ).toEqual(['bot', 'credential_exposed']);
            expect(
                run(
                    {
                        headers: {
                            'x-edge-bot': 'forged',
                            'x-edge-leaked': 'proxy-secret-',
                        },
                    },
                    opts,
                ).req.requestSignals,
            ).toEqual([]);
        });

        const flaggedRun = (
            headers: Record<string, string>,
            actor: unknown,
        ) => {
            const emit = vi.fn();
            const closers: Array<() => void> = [];
            const res = {
                once: vi.fn((_event: string, listener: () => void) => {
                    closers.push(listener);
                }),
            };
            const middleware = createFingerprintMiddleware({
                requestSignalHeaders: signalHeaders,
                requestSignalValue: 'proxy-secret',
                events: { emit } as never,
            });
            const req = {
                headers,
                method: 'POST',
                path: '/drivers/call',
                ip: '198.51.100.4',
                actor,
            } as unknown as Request;
            middleware(req, res as unknown as Response, vi.fn());
            return { req, res, emit, close: () => closers.forEach((c) => c()) };
        };

        it('announces a flagged request with an actor once it closes', () => {
            const { req, emit, close } = flaggedRun(
                { 'x-edge-bot': 'proxy-secret' },
                {
                    user: { id: 7, uuid: 'user-uuid', username: 'alice' },
                    effectiveApp: { uid: 'app-uid' },
                },
            );
            expect(emit).not.toHaveBeenCalled();
            (req as unknown as { route: { path: string } }).route = {
                path: '/drivers/call',
            };
            close();
            expect(emit).toHaveBeenCalledWith(
                'puter.request.flagged',
                {
                    signals: ['bot'],
                    user_id: 7,
                    user_uuid: 'user-uuid',
                    username: 'alice',
                    app_uid: 'app-uid',
                    method: 'POST',
                    route: '/drivers/call',
                    ip: '198.51.100.4',
                    tls_fingerprint: null,
                },
                {},
            );
        });

        it('stays quiet for a flagged request without an actor', () => {
            const { emit, close } = flaggedRun(
                { 'x-edge-bot': 'proxy-secret' },
                undefined,
            );
            close();
            expect(emit).not.toHaveBeenCalled();
        });

        it('adds no work to a request without signals', () => {
            const { res, emit } = flaggedRun(
                { 'user-agent': 'UA/1.0' },
                { user: { id: 7, uuid: 'user-uuid', username: 'alice' } },
            );
            expect(res.once).not.toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        });
    });
});
