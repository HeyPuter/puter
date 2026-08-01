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
import { describe, expect, it } from 'vitest';
import { HttpError, isHttpError } from '../HttpError';
import type { IConfig } from '../../../types';
import { guiOriginGate } from './originGate';

type NextArg = undefined | HttpError | unknown;

const run = (config: Partial<IConfig>, origin?: string): NextArg => {
    let captured: NextArg;
    let called = false;
    const gate = guiOriginGate(config as IConfig);
    const req = {
        headers: origin === undefined ? {} : { origin },
    } as unknown as Request;
    gate(req, {} as Response, (arg?: unknown) => {
        called = true;
        captured = arg as NextArg;
    });
    if (!called) throw new Error('gate did not call next()');
    return captured;
};

const expectForbidden = (got: NextArg) => {
    expect(isHttpError(got)).toBe(true);
    const err = got as HttpError;
    expect(err.statusCode).toBe(403);
    expect(err.legacyCode).toBe('forbidden');
};

const CONFIG: Partial<IConfig> = { origin: 'https://puter.com' };

describe('guiOriginGate', () => {
    it('passes a request from the deployment origin', () => {
        expect(run(CONFIG, 'https://puter.com')).toBeUndefined();
    });

    it('rejects a request from any other origin', () => {
        expectForbidden(run(CONFIG, 'https://evil.com'));
    });

    // The whole point: a locally served GUI is not a trusted origin, and it is
    // exactly what an attacker's page would claim to be if claiming helped.
    it('rejects a loopback origin', () => {
        expectForbidden(run(CONFIG, 'http://localhost:4000'));
        expectForbidden(run(CONFIG, 'http://puter.localhost:4100'));
    });

    // Non-browser callers (CLI, mobile, server-side, integration tests) send
    // no Origin, and gain nothing from being let through: whether a *page* can
    // read the response is what CORS governs.
    it('passes a request with no Origin header at all', () => {
        expect(run(CONFIG)).toBeUndefined();
    });

    // Sandboxed iframes and `file://` documents serialize their opaque origin
    // as the literal string "null", and two unrelated opaque origins compare
    // equal to each other — so it must never match.
    it('rejects the literal "null" origin', () => {
        expectForbidden(run(CONFIG, 'null'));
    });

    it('rejects an empty-string Origin', () => {
        expectForbidden(run(CONFIG, ''));
    });

    describe('normalization', () => {
        it('ignores a trailing slash on the configured origin', () => {
            expect(
                run({ origin: 'https://puter.com/' }, 'https://puter.com'),
            ).toBeUndefined();
        });

        it('ignores case and surrounding whitespace in config', () => {
            expect(
                run({ origin: '  HTTPS://Puter.com  ' }, 'https://puter.com'),
            ).toBeUndefined();
        });

        it('still distinguishes different hosts, ports, and schemes', () => {
            expectForbidden(run(CONFIG, 'https://puter.com.evil.com'));
            expectForbidden(run(CONFIG, 'https://puter.com:8443'));
            expectForbidden(run(CONFIG, 'http://puter.com'));
        });
    });

    describe('allow_gui_origins', () => {
        it('passes an explicitly allowlisted origin', () => {
            const config = {
                origin: 'https://puter.com',
                allow_gui_origins: ['https://gui.example.com'],
            };
            expect(run(config, 'https://gui.example.com')).toBeUndefined();
            // the main origin keeps working alongside it
            expect(run(config, 'https://puter.com')).toBeUndefined();
            expectForbidden(run(config, 'https://other.example.com'));
        });

        it('does not blow up on a missing or empty config origin', () => {
            expectForbidden(run({}, 'https://puter.com'));
            expectForbidden(run({ origin: '' }, 'https://puter.com'));
            // …and an absent Origin is still ungated
            expect(run({})).toBeUndefined();
        });
    });
});
