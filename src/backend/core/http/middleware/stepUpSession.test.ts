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
import { TokenService } from '../../../services/auth/TokenService.js';
import {
    createStepUpGate,
    signStepUpToken,
    STEP_UP_COOKIE_NAME,
    verifyStepUpSession,
} from './stepUpSession.js';

const V2_SECRET = 'test-v2-secret';
const USER_UUID = 'a1111111-1111-1111-1111-111111111111';

function tokenService(): TokenService {
    const config = {
        jwt_secret: 'test-v1-secret',
        jwt_secret_v2: V2_SECRET,
        allow_v1_tokens: true,
    } as ConstructorParameters<typeof TokenService>[0];
    const svc = new TokenService(
        config,
        {} as ConstructorParameters<typeof TokenService>[1],
        {} as ConstructorParameters<typeof TokenService>[2],
        {} as ConstructorParameters<typeof TokenService>[3],
    );
    svc.onServerStart();
    return svc;
}

function reqWith(
    cookie: string | undefined,
    actorUuid: string | undefined,
    extra: Partial<Request> = {},
): Request {
    return {
        cookies: cookie ? { [STEP_UP_COOKIE_NAME]: cookie } : {},
        actor: actorUuid ? { user: { uuid: actorUuid } } : undefined,
        ...extra,
    } as unknown as Request;
}

describe('verifyStepUpSession', () => {
    it('accepts a token bound to the acting user', () => {
        const ts = tokenService();
        const token = signStepUpToken(ts, { uuid: USER_UUID });
        expect(
            verifyStepUpSession(reqWith(token, USER_UUID), { tokenService: ts }),
        ).toBe(true);
    });

    it('rejects a token bound to a different user (cookie alone is useless)', () => {
        const ts = tokenService();
        const token = signStepUpToken(ts, { uuid: USER_UUID });
        expect(
            verifyStepUpSession(
                reqWith(token, 'b2222222-2222-2222-2222-222222222222'),
                { tokenService: ts },
            ),
        ).toBe(false);
    });

    it('rejects when there is no actor (no live session)', () => {
        const ts = tokenService();
        const token = signStepUpToken(ts, { uuid: USER_UUID });
        expect(
            verifyStepUpSession(reqWith(token, undefined), {
                tokenService: ts,
            }),
        ).toBe(false);
    });

    it('rejects when the cookie is missing', () => {
        const ts = tokenService();
        expect(
            verifyStepUpSession(reqWith(undefined, USER_UUID), {
                tokenService: ts,
            }),
        ).toBe(false);
    });

    it('rejects an expired token', () => {
        const ts = tokenService();
        // Sign with a lifetime past the verifier's 30s clock tolerance.
        const expired = ts.sign(
            'step-up',
            { user_uuid: USER_UUID, purpose: 'elevation' },
            { expiresIn: -60 },
        );
        expect(
            verifyStepUpSession(reqWith(expired, USER_UUID), {
                tokenService: ts,
            }),
        ).toBe(false);
    });

    it('rejects a token minted under a different scope/purpose (no cross-use)', () => {
        const ts = tokenService();
        // A well-formed session-style token must not satisfy the gate.
        const authToken = ts.sign('auth', {
            type: 'session',
            version: '2',
            user_uid: USER_UUID,
        });
        expect(
            verifyStepUpSession(reqWith(authToken, USER_UUID), {
                tokenService: ts,
            }),
        ).toBe(false);
    });
});

describe('createStepUpGate', () => {
    it('passes a session with a valid elevation cookie', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const token = signStepUpToken(ts, { uuid: USER_UUID });
        const next = vi.fn();
        gate(reqWith(token, USER_UUID), {} as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a session without an elevation cookie, hinting the factor', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const next = vi.fn();
        const req = reqWith(undefined, USER_UUID, {
            actor: { user: { uuid: USER_UUID, otp_enabled: true } },
        } as never);
        gate(req, {} as Response, next);
        const err = next.mock.calls[0][0];
        expect(err.statusCode).toBe(403);
        expect(err.legacyCode).toBe('elevation_required');
        expect(err.fields.factor).toBe('otp');
    });

    it('hints the password factor when 2FA is off', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const next = vi.fn();
        gate(reqWith(undefined, USER_UUID), {} as Response, next);
        expect(next.mock.calls[0][0].fields.factor).toBe('password');
    });

    // A stolen session can mint a full-access token via
    // /auth/create-access-token without re-proving identity, so exempting one
    // here would be a way around the gate rather than an exception to it.
    it('does NOT exempt full-access personal access tokens', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const next = vi.fn();
        const req = reqWith(undefined, USER_UUID, {
            actor: {
                user: { uuid: USER_UUID },
                accessToken: { fullAccess: true },
            },
        } as never);
        gate(req, {} as Response, next);
        expect(next.mock.calls[0][0]?.statusCode).toBe(403);
    });

    // App-gated routes (adminOnly + allowedAppIds): an admin acting through an
    // allowlisted app can't elevate — apps have no password/TOTP and are blocked
    // from /auth/elevate. The exemption keys off the token carrying an allowed
    // app id, not the route flag.
    it('exempts a token that carries an allowlisted app id', () => {
        const ts = tokenService();
        const gate = createStepUpGate({
            tokenService: ts,
            allowedAppUids: ['app-xyz'],
        });
        const next = vi.fn();
        const req = reqWith(undefined, USER_UUID, {
            actor: { user: { uuid: USER_UUID }, app: { uid: 'app-xyz' } },
        } as never);
        gate(req, {} as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it('still requires step-up for an app id NOT in the allowlist', () => {
        const ts = tokenService();
        const gate = createStepUpGate({
            tokenService: ts,
            allowedAppUids: ['other-app'],
        });
        const next = vi.fn();
        const req = reqWith(undefined, USER_UUID, {
            actor: { user: { uuid: USER_UUID }, app: { uid: 'app-xyz' } },
        } as never);
        gate(req, {} as Response, next);
        expect(next.mock.calls[0][0]?.statusCode).toBe(403);
    });

    it('still requires step-up when the route has no allowedAppIds', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const next = vi.fn();
        const req = reqWith(undefined, USER_UUID, {
            actor: { user: { uuid: USER_UUID }, app: { uid: 'app-xyz' } },
        } as never);
        gate(req, {} as Response, next);
        expect(next.mock.calls[0][0]?.statusCode).toBe(403);
    });

    it('still requires step-up on the human/root-token path (no app id in token)', () => {
        const ts = tokenService();
        const gate = createStepUpGate({
            tokenService: ts,
            allowedAppUids: ['app-xyz'],
        });
        const next = vi.fn();
        gate(reqWith(undefined, USER_UUID), {} as Response, next);
        expect(next.mock.calls[0][0]?.statusCode).toBe(403);
    });

    it('accepts the elevation via the x-puter-elevation header (API clients)', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const token = signStepUpToken(ts, { uuid: USER_UUID });
        const next = vi.fn();
        const req = {
            cookies: {},
            headers: { 'x-puter-elevation': token },
            actor: { user: { uuid: USER_UUID } },
        } as never;
        gate(req, {} as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a header elevation bound to a different user', () => {
        const ts = tokenService();
        const gate = createStepUpGate({ tokenService: ts });
        const token = signStepUpToken(ts, {
            uuid: 'b2222222-2222-2222-2222-222222222222',
        });
        const next = vi.fn();
        const req = {
            cookies: {},
            headers: { 'x-puter-elevation': token },
            actor: { user: { uuid: USER_UUID } },
        } as never;
        gate(req, {} as Response, next);
        expect(next.mock.calls[0][0]?.statusCode).toBe(403);
    });
});
