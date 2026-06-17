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

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createFingerprintMiddleware } from './fingerprint';

const VALID_FP = 'dev-fingerprint-abc123';

const run = (reqPartial: Partial<Request> & Record<string, unknown>) => {
    const middleware = createFingerprintMiddleware();
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
        expect(run({ body: { fingerprint: 'bad fp!' } }).req.deviceFingerprint)
            .toBeUndefined();
        expect(run({ body: { fingerprint: 'short' } }).req.deviceFingerprint)
            .toBeUndefined();
        expect(
            run({ body: { fingerprint: 123 as unknown as string } }).req
                .deviceFingerprint,
        ).toBeUndefined();
    });

    it('leaves deviceFingerprint undefined when nothing was supplied', () => {
        const { req } = run({ ip: '203.0.113.1' });
        expect(req.deviceFingerprint).toBeUndefined();
    });
});
