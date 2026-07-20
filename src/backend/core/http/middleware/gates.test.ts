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
    assertNotUserSession,
    noUserSessionGate,
    requireAuthGate,
    requireVerifiedAccount,
    requireNonAccessTokenGate,
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
    gate: (
        req: Request,
        res: Response,
        next: (arg?: unknown) => void,
    ) => unknown,
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
    it('passes through (next()) when the active subdomain matches', () => {
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

    // ── Reauth signal ───────────────────────────────────────────────

    it('returns 401 reauth_required for a legacy v1 token', () => {
        const got = runGate(requireAuthGate(), {
            requiresReauth: { reason: 'token_v1', auth_id: 'u-1' },
        });
        expectHttpError(got, 401, 'reauth_required');
        expect((got as HttpError).fields).toMatchObject({
            code: 'reauth_required',
            reason: 'token_v1',
            auth_id: 'u-1',
        });
    });

    it('returns 401 reauth_required with reason=session_revoked', () => {
        const got = runGate(requireAuthGate(), {
            requiresReauth: { reason: 'session_revoked', auth_id: 'u-2' },
        });
        expectHttpError(got, 401, 'reauth_required');
        expect((got as HttpError).fields).toMatchObject({
            reason: 'session_revoked',
            auth_id: 'u-2',
        });
    });

    it('returns 401 reauth_required with reason=session_expired', () => {
        const got = runGate(requireAuthGate(), {
            requiresReauth: { reason: 'session_expired' },
        });
        expectHttpError(got, 401, 'reauth_required');
        expect((got as HttpError).fields).toMatchObject({
            reason: 'session_expired',
        });
        // No auth_id field at all when none was supplied (vs. set-to-undefined).
        expect((got as HttpError).fields?.auth_id).toBeUndefined();
    });

    it('reauth_required takes priority over tokenAuthFailed', () => {
        // Both flags set: the structured reauth signal wins. v2 clients
        // key on `code === 'reauth_required'`; v1 clients still see a 401.
        const got = runGate(requireAuthGate(), {
            requiresReauth: { reason: 'token_v1', auth_id: 'u-1' },
            tokenAuthFailed: true,
        });
        expectHttpError(got, 401, 'reauth_required');
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
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                },
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

    it('rejects a FULL-ACCESS access token too — account routes stay closed', () => {
        // The account wall is actor-type based: even a full-access PAT (which
        // the resource wall lets through) is rejected here, so it can never
        // reach change-password/email/2FA/token-minting/etc.
        const got = runGate(requireUserActorGate(), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                    fullAccess: true,
                },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    // allowFullAccess opt-in: relaxes ONLY the access-token half, for
    // user-resource/inference routes (e.g. the AI proxy).
    it('admits a full-access PAT when allowFullAccess is set', () => {
        const got = runGate(requireUserActorGate({ allowFullAccess: true }), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                    fullAccess: true,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it('still rejects a SCOPED access token even when allowFullAccess is set', () => {
        const got = runGate(requireUserActorGate({ allowFullAccess: true }), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                    // no fullAccess
                },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('still rejects a third-party app even when allowFullAccess is set', () => {
        const got = runGate(requireUserActorGate({ allowFullAccess: true }), {
            actor: { user: { uuid: 'u-1' }, app: { uid: 'app-1' } },
        });
        expectHttpError(got, 403, 'forbidden');
    });
});

// -- requireNonAccessTokenGate --

describe('requireNonAccessTokenGate', () => {
    it('passes through for plain user actors', () => {
        const got = runGate(requireNonAccessTokenGate(), {
            actor: { user: { uuid: 'u-1' } },
        });
        expect(got).toBeUndefined();
    });

    it('passes through for app-under-user actors (only access tokens are gated)', () => {
        const got = runGate(requireNonAccessTokenGate(), {
            actor: { user: { uuid: 'u-1' }, app: { uid: 'app-1' } },
        });
        expect(got).toBeUndefined();
    });

    it('rejects a normal (scoped) access token with 403', () => {
        const got = runGate(requireNonAccessTokenGate(), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('admits a FULL-ACCESS access token (the resource-wall carve-out)', () => {
        const got = runGate(requireNonAccessTokenGate(), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                    fullAccess: true,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it("falls back to 401 if there's no actor at all (defensive)", () => {
        const got = runGate(requireNonAccessTokenGate(), {});
        expectHttpError(got, 401, 'token_missing');
    });
});

// ── noUserSessionGate ───────────────────────────────────────────────

describe('noUserSessionGate', () => {
    it('rejects a bare user-session ("root" token) actor with 403', () => {
        const got = runGate(noUserSessionGate(), {
            actor: { user: { uuid: 'u-1' } },
        });
        expectHttpError(got, 403, 'app_or_api_token_required');
    });

    it('passes through for app-under-user actors (app/worker tokens)', () => {
        const got = runGate(noUserSessionGate(), {
            actor: { user: { uuid: 'u-1' }, app: { uid: 'app-1' } },
        });
        expect(got).toBeUndefined();
    });

    it('passes through for user-scoped worker sessions (kind="worker")', () => {
        const got = runGate(noUserSessionGate(), {
            actor: {
                user: { uuid: 'u-1' },
                session: { uid: 'sess-1', kind: 'worker' },
            },
        });
        expect(got).toBeUndefined();
    });

    it('passes through for access-token actors (which access tokens are OK is decided by the other gates)', () => {
        const got = runGate(noUserSessionGate(), {
            actor: {
                user: { uuid: 'u-1' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1' } },
                    fullAccess: true,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it("falls back to 401 if there's no actor at all (defensive)", () => {
        const got = runGate(noUserSessionGate(), {});
        expectHttpError(got, 401, 'token_missing');
    });
});

describe('assertNotUserSession', () => {
    it('is a no-op for a missing actor (anonymous is the auth gate’s job)', () => {
        expect(() => assertNotUserSession(undefined)).not.toThrow();
        expect(() => assertNotUserSession(null)).not.toThrow();
    });

    it('always admits a user-scoped worker session — workers are never root tokens', () => {
        // Workers deployed with no app binding hold a session-TYPE token
        // whose row is kind='worker' (see AuthService.createWorkerSessionToken)
        // — a bare user actor plus that session ref. The gate is an
        // annoyance for sign-up-and-scrape abuse; a deployed worker is
        // already a delegated, revocable credential.
        expect(() =>
            assertNotUserSession({
                app: null,
                accessToken: null,
                session: { uid: 'sess-1', kind: 'worker' },
            }),
        ).not.toThrow();
    });

    it('still rejects web sessions', () => {
        expect(() =>
            assertNotUserSession({
                app: null,
                accessToken: null,
                session: { uid: 'sess-1', kind: 'web' },
            }),
        ).toThrow();
    });

    it('throws 403 app_or_api_token_required for a bare session actor', () => {
        try {
            assertNotUserSession({ app: null, accessToken: null });
            expect.unreachable('expected assertNotUserSession to throw');
        } catch (err) {
            expect(isHttpError(err)).toBe(true);
            expect((err as HttpError).statusCode).toBe(403);
            expect((err as HttpError).legacyCode).toBe(
                'app_or_api_token_required',
            );
            // The user asked for a helpful message: it must point at the
            // credentials that DO work and where to get one.
            expect((err as HttpError).message).toMatch(/app or worker token/i);
            expect((err as HttpError).message).toMatch(/API token/);
            expect((err as HttpError).message).toMatch(/dashboard/i);
        }
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

    it('admits the built-ins regardless of case', () => {
        // On a SQLite self-host with case-sensitive (BINARY) collation, a
        // user row could exist with `Admin`/`SYSTEM` capitalization. The
        // gate must still admit those — case is normalized on both sides.
        for (const username of ['Admin', 'ADMIN', 'sYsTeM']) {
            const got = runGate(adminOnlyGate(), {
                actor: { user: { uuid: 'u-1', username } },
            });
            expect(got).toBeUndefined();
        }
    });

    it('admits case-mismatched extras (allowlist lowercased on construction)', () => {
        // Pass an extra in mixed case; the gate must accept the same name
        // in any case — the on-disk username row may be either, depending
        // on the DB's column collation.
        const gate = adminOnlyGate(['Daniel']);
        expect(
            runGate(gate, {
                actor: { user: { uuid: 'u-1', username: 'daniel' } },
            }),
        ).toBeUndefined();
        expect(
            runGate(gate, {
                actor: { user: { uuid: 'u-1', username: 'DANIEL' } },
            }),
        ).toBeUndefined();
    });

    // -- Root-token requirement --
    //
    // Admin endpoints require a root token (an actor with no app anywhere
    // in its token chain), so a third-party app an admin authorized can't
    // reach them on the admin's behalf.

    it('admits an admin acting via a session (root token)', () => {
        const got = runGate(adminOnlyGate(), {
            actor: { user: { uuid: 'u-1', username: 'admin' } },
        });
        expect(got).toBeUndefined();
    });

    it("admits an admin's full-access PAT (still a root token — no app)", () => {
        const got = runGate(adminOnlyGate(), {
            actor: {
                user: { uuid: 'u-1', username: 'admin' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: { user: { uuid: 'u-1', username: 'admin' } },
                    fullAccess: true,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it('rejects an admin acting through an app with 403 (not a root token)', () => {
        const got = runGate(adminOnlyGate(), {
            actor: {
                user: { uuid: 'u-1', username: 'admin' },
                app: { uid: 'app-1' },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('rejects an admin access token issued through an app (app in the token chain)', () => {
        // Access-token actors carry their app on `accessToken.issuer.app`,
        // not top-level `actor.app` — the root-token check must walk the
        // chain, not just the top level.
        const got = runGate(adminOnlyGate(), {
            actor: {
                user: { uuid: 'u-1', username: 'admin' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: {
                        user: { uuid: 'u-1', username: 'admin' },
                        app: { uid: 'app-1' },
                    },
                },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('rejects an app-issued access token even when appGated', () => {
        // The appGated deferral only applies to direct app-under-user
        // actors: `allowedAppIdsGate` reads top-level `actor.app` and would
        // pass a chain-only app straight through, so it must not be
        // deferred to.
        const got = runGate(adminOnlyGate([], { appGated: true }), {
            actor: {
                user: { uuid: 'u-1', username: 'admin' },
                accessToken: {
                    uid: 'tok-1',
                    issuer: {
                        user: { uuid: 'u-1', username: 'admin' },
                        app: { uid: 'app-1' },
                    },
                },
            },
        });
        expectHttpError(got, 403, 'forbidden');
    });

    it('admits an admin acting through an app when appGated (allowedAppIdsGate then decides)', () => {
        // On an appId-gated route the root-token check is deferred to
        // `allowedAppIdsGate`; this gate must let the app actor through.
        const got = runGate(adminOnlyGate([], { appGated: true }), {
            actor: {
                user: { uuid: 'u-1', username: 'admin' },
                app: { uid: 'app-1' },
            },
        });
        expect(got).toBeUndefined();
    });

    it('still admits a root token when appGated', () => {
        const got = runGate(adminOnlyGate([], { appGated: true }), {
            actor: { user: { uuid: 'u-1', username: 'admin' } },
        });
        expect(got).toBeUndefined();
    });

    it('applies the username check before the root-token check', () => {
        // A non-admin acting through an app is rejected for being non-admin,
        // regardless of the app scope.
        const got = runGate(adminOnlyGate(), {
            actor: {
                user: { uuid: 'u-1', username: 'random-user' },
                app: { uid: 'app-1' },
            },
        });
        expectHttpError(got, 403, 'forbidden');
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
        expectHttpError(got, 403, 'account_is_not_verified');
    });

    it('treats missing actor as unverified under strict mode', () => {
        const got = runGate(requireVerifiedGate(true), {});
        expectHttpError(got, 403, 'account_is_not_verified');
    });
});

// ── requireVerifiedAccount ──────────────────────────────────────────

describe('requireVerifiedAccount', () => {
    it('passes through users that do not require confirmation (e.g. legacy/temp)', () => {
        const got = runGate(requireVerifiedAccount(), {
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
        const got = runGate(requireVerifiedAccount(), {
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
        const got = runGate(requireVerifiedAccount(), {
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

    it('returns 403 phone_verification_required while the phone gate is set', () => {
        const got = runGate(requireVerifiedAccount(), {
            actor: {
                user: {
                    uuid: 'u-1',
                    requires_email_confirmation: false,
                    email_confirmed: true,
                    requires_phone_verification: true,
                },
            },
        });
        expectHttpError(got, 403, 'phone_verification_required');
    });

    it('returns 403 card_verification_required while the card gate is set', () => {
        const got = runGate(requireVerifiedAccount(), {
            actor: {
                user: {
                    uuid: 'u-1',
                    requires_email_confirmation: false,
                    email_confirmed: true,
                    requires_card_verification: true,
                },
            },
        });
        expectHttpError(got, 403, 'card_verification_required');
    });

    it('passes through once every gate is cleared', () => {
        const got = runGate(requireVerifiedAccount(), {
            actor: {
                user: {
                    uuid: 'u-1',
                    requires_email_confirmation: true,
                    email_confirmed: true,
                    requires_phone_verification: false,
                    requires_card_verification: false,
                },
            },
        });
        expect(got).toBeUndefined();
    });

    it("passes through when there's no actor (auth gate handled it)", () => {
        const got = runGate(requireVerifiedAccount(), {});
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
