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
import { describe, expect, it } from 'vitest';
import { HttpError, isHttpError } from '../HttpError';
import {
    DEFAULT_ADMIN_USERNAMES,
    adminOnlyGate,
    allowedAppIdsGate,
    requireAuthGate,
    requireEmailConfirmedGate,
    requireUserActorGate,
    requireVerifiedGate,
    subdomainGate,
} from './gates';

// ── Tiny harness ────────────────────────────────────────────────────
//
// Gates only touch `req`, never `res`. We capture what they pass to
// `next()` — either a string ('route'), an HttpError, or `undefined` for
// pass-through.

type NextArg = undefined | 'route' | HttpError | unknown;

const runGate = (
    gate: (req: Request, res: Response, next: (arg?: unknown) => void) => unknown,
    req: Partial<Request>,
): NextArg => {
    let captured: NextArg = undefined;
    let called = false;
    gate(req as Request, {} as Response, (arg?: unknown) => {
        called = true;
        captured = arg as NextArg;
    });
    if (!called) {
        throw new Error('gate did not call next()');
    }
    return captured;
};

const expectHttpError = (got: NextArg, status: number, legacyCode?: string) => {
    expect(isHttpError(got)).toBe(true);
    const err = got as HttpError;
    expect(err.statusCode).toBe(status);
    if (legacyCode) expect(err.legacyCode).toBe(legacyCode);
};

// ── subdomainGate ───────────────────────────────────────────────────

describe('subdomainGate', () => {
    it("passes through (next()) when the active subdomain matches", () => {
        const got = runGate(subdomainGate('api'), {
            // express stores subdomains right-to-left → active is the last entry
            subdomains: ['com', 'puter', 'api'] as unknown as string[],
        });
        expect(got).toBeUndefined();
    });

    it("calls next('route') when subdomain doesn't match — does NOT throw", () => {
        const got = runGate(subdomainGate('api'), {
            subdomains: ['com', 'puter', 'admin'] as unknown as string[],
        });
        // Critical: subdomainGate skips, it does not reject. This is how
        // multiple route trees coexist on the same host.
        expect(got).toBe('route');
    });

    it('accepts an array of allowed subdomains', () => {
        const gate = subdomainGate(['api', 'admin']);
        expect(
            runGate(gate, {
                subdomains: ['admin'] as unknown as string[],
            }),
        ).toBeUndefined();
        expect(
            runGate(gate, {
                subdomains: ['other'] as unknown as string[],
            }),
        ).toBe('route');
    });

    it("treats a missing/empty subdomains array as ''", () => {
        const got = runGate(subdomainGate('api'), {});
        expect(got).toBe('route');
        // And an empty allow-of-empty does pass:
        expect(runGate(subdomainGate(''), {})).toBeUndefined();
    });
});

// ── requireAuthGate ─────────────────────────────────────────────────

describe('requireAuthGate', () => {
    it('passes through when an actor is attached and not suspended', () => {
        const got = runGate(requireAuthGate(), {
            actor: { user: { uuid: 'u-1', suspended: false } },
        });
        expect(got).toBeUndefined();
    });

    it('returns 401 token_missing when no actor and no prior probe failure', () => {
        const got = runGate(requireAuthGate(), {});
        expectHttpError(got, 401, 'token_missing');
    });

    it('returns 401 token_auth_failed when a token was probed but invalid', () => {
        const got = runGate(requireAuthGate(), {
            tokenAuthFailed: true,
        });
        expectHttpError(got, 401, 'token_auth_failed');
    });

    it('returns 403 forbidden for suspended users (no DB hit needed)', () => {
        const got = runGate(requireAuthGate(), {
            actor: { user: { uuid: 'u-1', suspended: true } },
        });
        expectHttpError(got, 403, 'forbidden');
    });
});

// ── requireUserActorGate ────────────────────────────────────────────

describe('requireUserActorGate', () => {
    it('passes through for plain user actors', () => {
        const got = runGate(requireUserActorGate(), {
            actor: { user: { uuid: 'u-1' } },
        });
        expect(got).toBeUndefined();
    });

    it('rejects with 403 when the actor is acting through an app', () => {
        const got = runGate(requireUserActorGate(), {
            actor: {
                user: { uuid: 'u-1' },
                app: { uid: 'app-1' },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('rejects with 403 when the actor is using an access token', () => {
        const got = runGate(requireUserActorGate(), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: { uid: 'tok-1', issuer: { user: { uuid: 'u-1' } } },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it("falls back to 401 if there's no actor at all (defensive)", () => {
        // requireAuth runs first, so this is rare — but the gate handles
        // it anyway rather than dereferencing undefined.
        const got = runGate(requireUserActorGate(), {});
        expectHttpError(got, 401, 'token_missing');
    });
});

// ── adminOnlyGate ───────────────────────────────────────────────────

describe('adminOnlyGate', () => {
    it("admits the built-in 'admin' and 'system' users by default", () => {
        for (const username of DEFAULT_ADMIN_USERNAMES) {
            const got = runGate(adminOnlyGate(), {
                actor: { user: { uuid: 'u-1', username } },
            });
            expect(got).toBeUndefined();
        }
    });

    it('admits extras IN ADDITION to the built-ins (not as a replacement)', () => {
        const gate = adminOnlyGate(['daniel']);
        // The extra works
        expect(
            runGate(gate, {
                actor: { user: { uuid: 'u-1', username: 'daniel' } },
            }),
        ).toBeUndefined();
        // ...and the built-ins still work
        expect(
            runGate(gate, {
                actor: { user: { uuid: 'u-1', username: 'admin' } },
            }),
        ).toBeUndefined();
    });

    it('rejects unknown usernames with 403 forbidden', () => {
        const got = runGate(adminOnlyGate(), {
            actor: { user: { uuid: 'u-1', username: 'random-user' } },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('rejects when no username is present (anonymous / malformed actor)', () => {
        // No actor at all
        expectHttpError(runGate(adminOnlyGate(), {}), 403, 'forbidden');
        // Actor without a username
        expectHttpError(
            runGate(adminOnlyGate(), {
                actor: { user: { uuid: 'u-1' } },
            }),
            403,
            'forbidden',
        );
    });
});

// ── requireVerifiedGate ─────────────────────────────────────────────

describe('requireVerifiedGate', () => {
    it('is a no-op when the strict flag is false (self-hosted without email)', () => {
        // Even an unverified user passes when strict is off.
        const got = runGate(requireVerifiedGate(false), {
            actor: { user: { uuid: 'u-1', email_confirmed: false } },
        });
        expect(got).toBeUndefined();
    });

    it('passes when email_confirmed is true under strict mode', () => {
        const got = runGate(requireVerifiedGate(true), {
            actor: { user: { uuid: 'u-1', email_confirmed: true } },
        });
        expect(got).toBeUndefined();
    });

    it('returns 400 account_is_not_verified for unverified users under strict mode', () => {
        const got = runGate(requireVerifiedGate(true), {
            actor: { user: { uuid: 'u-1', email_confirmed: false } },
        });
        expectHttpError(got, 400, 'account_is_not_verified');
    });

    it('treats missing actor as unverified under strict mode', () => {
        const got = runGate(requireVerifiedGate(true), {});
        expectHttpError(got, 400, 'account_is_not_verified');
    });
});

// ── requireEmailConfirmedGate ───────────────────────────────────────

describe('requireEmailConfirmedGate', () => {
    it('passes through users that do not require confirmation (e.g. legacy/temp)', () => {
        const got = runGate(requireEmailConfirmedGate(), {
            actor: {
                user: {
                    uuid: 'u-1',
                    requires_email_confirmation: false,
                    email_confirmed: false,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it('passes through confirmed users even when confirmation is required', () => {
        const got = runGate(requireEmailConfirmedGate(), {
            actor: {
                user: {
                    uuid: 'u-1',
                    requires_email_confirmation: true,
                    email_confirmed: true,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it('returns 403 email_confirmation_required for pending-confirmation users', () => {
        const got = runGate(requireEmailConfirmedGate(), {
            actor: {
                user: {
                    uuid: 'u-1',
                    requires_email_confirmation: true,
                    email_confirmed: false,
                },
            },
        });
        expectHttpError(got, 403, 'email_confirmation_required');
    });

    it("passes through when there's no actor (auth gate handled it)", () => {
        const got = runGate(requireEmailConfirmedGate(), {});
        expect(got).toBeUndefined();
    });
});

// ── allowedAppIdsGate ───────────────────────────────────────────────

describe('allowedAppIdsGate', () => {
    it('passes through when the actor has no app (user-only actor)', () => {
        // The gate only narrows app-under-user actors; user-only actors
        // are handled by `requireUserActorGate` separately.
        const got = runGate(allowedAppIdsGate(['app-allowed']), {
            actor: { user: { uuid: 'u-1' } },
        });
        expect(got).toBeUndefined();
    });

    it('passes when the actor.app.uid is in the allow-list', () => {
        const got = runGate(allowedAppIdsGate(['app-allowed']), {
            actor: {
                user: { uuid: 'u-1' },
                app: { uid: 'app-allowed' },
            },
        });
        expect(got).toBeUndefined();
    });

    it('rejects with 403 forbidden when the app is not in the allow-list', () => {
        const got = runGate(allowedAppIdsGate(['app-allowed']), {
            actor: {
                user: { uuid: 'u-1' },
                app: { uid: 'app-other' },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('rejects every app when the allow-list is empty', () => {
        const got = runGate(allowedAppIdsGate([]), {
            actor: {
                user: { uuid: 'u-1' },
                app: { uid: 'app-anything' },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });
});
