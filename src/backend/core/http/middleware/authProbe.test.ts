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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../actor';
import type { AuthService } from '../../../services/auth/AuthService';
import { PuterServer } from '../../../server';
import { setupTestServer } from '../../../testUtil';
import { createAuthProbe } from './authProbe';

// ── Stub AuthService — captures the token the probe extracted ───────
//
// The probe's job is to find a token in one of six places and hand it to
// AuthService. To test extraction in isolation we replace AuthService
// with a thin spy: it records what it was given and returns whatever the
// test wants. This is mocking at a real boundary (a service), which the
// AGENTS.md guidance explicitly allows.

interface StubAuth {
    service: AuthService;
    seenTokens: string[];
    /** What the next call to authenticateFromToken should return. */
    setNext: (next: Actor | null | 'throw') => void;
}

const makeStubAuth = (defaultActor: Actor | null = null): StubAuth => {
    const seenTokens: string[] = [];
    let nextResult: Actor | null | 'throw' = defaultActor;
    const service = {
        authenticateFromToken: async (token: string) => {
            seenTokens.push(token);
            if (nextResult === 'throw') throw new Error('verify failed');
            return nextResult;
        },
    } as unknown as AuthService;
    return {
        service,
        seenTokens,
        setNext: (n) => {
            nextResult = n;
        },
    };
};

// ── Request harness ─────────────────────────────────────────────────
//
// The probe uses `req.header()` for header lookups and `req.body`,
// `req.query`, `req.handshake.query` for the other sources. Build a
// request that looks just real enough.

interface ReqInit {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    cookieHeader?: string;
    query?: Record<string, unknown>;
    handshakeQuery?: Record<string, unknown>;
    actor?: Actor;
    protocol?: string;
}

// Minimal stand-in for `cookie-parser` — splits on `;`, URL-decodes the
// value, and strips a pair of surrounding double quotes (matches the
// `cookie` package's behavior, which `cookie-parser` uses internally).
const parseCookieHeader = (header: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const piece of header.split(';')) {
        const eq = piece.indexOf('=');
        if (eq < 0) continue;
        const name = piece.slice(0, eq).trim();
        if (!name) continue;
        let value = piece.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        try {
            value = decodeURIComponent(value);
        } catch {
            /* leave as-is */
        }
        out[name] = value;
    }
    return out;
};

const makeReq = (init: ReqInit = {}): Request => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.cookieHeader) headers.cookie = init.cookieHeader;
    const req: Partial<Request> & { handshake?: unknown } = {
        body: init.body,
        query: (init.query ?? {}) as Request['query'],
        headers: headers as unknown as Request['headers'],
        protocol: init.protocol,
        header(name: string) {
            // Express's `req.header()` is case-insensitive; mirror that.
            return headers[name.toLowerCase()] as unknown as string[] & string;
        },
    };
    if (init.cookieHeader) {
        req.cookies = parseCookieHeader(init.cookieHeader);
    }
    if (init.actor) req.actor = init.actor;
    if (init.handshakeQuery) {
        req.handshake = { query: init.handshakeQuery };
    }
    return req as Request;
};

const runProbe = async (
    probe: ReturnType<typeof createAuthProbe>,
    req: Request,
) => {
    const next = vi.fn();
    await probe(req, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    return { req, next };
};

// ── Token extraction priority + edge cases ──────────────────────────

describe('createAuthProbe — token extraction precedence', () => {
    it('1. body.auth_token wins over every other source', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                body: { auth_token: 'body-tok' },
                headers: {
                    authorization: 'Bearer header-tok',
                    'x-api-key': 'xapi-tok',
                },
                cookieHeader: 'puter_token=cookie-tok',
                query: { auth_token: 'query-tok' },
                handshakeQuery: { auth_token: 'hs-tok' },
            }),
        );
        expect(stub.seenTokens).toEqual(['body-tok']);
    });

    it('2. Authorization: Bearer wins over header/cookie/query/handshake', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                headers: {
                    authorization: 'Bearer header-tok',
                    'x-api-key': 'xapi-tok',
                },
                cookieHeader: 'puter_token=cookie-tok',
                query: { auth_token: 'query-tok' },
                handshakeQuery: { auth_token: 'hs-tok' },
            }),
        );
        expect(stub.seenTokens).toEqual(['header-tok']);
    });

    it('3. x-api-key takes over when Authorization is absent', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                headers: { 'x-api-key': 'xapi-tok' },
                cookieHeader: 'puter_token=cookie-tok',
                query: { auth_token: 'query-tok' },
            }),
        );
        expect(stub.seenTokens).toEqual(['xapi-tok']);
    });

    it('4. session cookie wins over query string and handshake', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                cookieHeader: 'puter_token=cookie-tok',
                query: { auth_token: 'query-tok' },
                handshakeQuery: { auth_token: 'hs-tok' },
            }),
        );
        expect(stub.seenTokens).toEqual(['cookie-tok']);
    });

    it('5. query auth_token wins over the handshake-query (ws upgrade fallback)', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        await runProbe(
            probe,
            makeReq({
                query: { auth_token: 'query-tok' },
                handshakeQuery: { auth_token: 'hs-tok' },
            }),
        );
        expect(stub.seenTokens).toEqual(['query-tok']);
    });

    it('6. handshake query is the last resort (covers ws upgrades)', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        await runProbe(
            probe,
            makeReq({
                handshakeQuery: { auth_token: 'hs-tok' },
            }),
        );
        expect(stub.seenTokens).toEqual(['hs-tok']);
    });
});

describe('createAuthProbe — header parsing', () => {
    it("strips 'Bearer ' (case-insensitive) from the Authorization value", async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        await runProbe(
            probe,
            makeReq({ headers: { authorization: 'bearer   ABCDEF' } }),
        );
        expect(stub.seenTokens).toEqual(['ABCDEF']);
    });

    it("ignores the literal word 'Bearer' (some Office clients send it as a placeholder)", async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        const { req } = await runProbe(
            probe,
            makeReq({ headers: { authorization: 'Bearer' } }),
        );
        // No token extracted; AuthService was never called.
        expect(stub.seenTokens).toEqual([]);
        expect(req.actor).toBeUndefined();
        expect(req.tokenAuthFailed).toBeUndefined();
    });

    it("ignores 'Basic ...' (HTTP Basic isn't our auth scheme)", async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        await runProbe(
            probe,
            makeReq({
                headers: { authorization: 'Basic dXNlcjpwYXNz' },
            }),
        );
        expect(stub.seenTokens).toEqual([]);
    });

    it("rejects the literal string 'undefined' after Bearer-strip (legacy client bug)", async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        await runProbe(
            probe,
            makeReq({
                headers: { authorization: 'Bearer undefined' },
            }),
        );
        expect(stub.seenTokens).toEqual([]);
    });

    it("also strips 'Bearer ' from body / x-api-key / query — they may carry the prefix too", async () => {
        const stub = makeStubAuth();
        // Body
        await runProbe(
            createAuthProbe({ authService: stub.service }),
            makeReq({ body: { auth_token: 'Bearer body-tok' } }),
        );
        // x-api-key
        await runProbe(
            createAuthProbe({ authService: stub.service }),
            makeReq({ headers: { 'x-api-key': 'Bearer xapi-tok' } }),
        );
        // Query
        await runProbe(
            createAuthProbe({ authService: stub.service }),
            makeReq({ query: { auth_token: 'Bearer query-tok' } }),
        );
        expect(stub.seenTokens).toEqual(['body-tok', 'xapi-tok', 'query-tok']);
    });
});

describe('createAuthProbe — cookie reading', () => {
    it('parses the named cookie out of a multi-cookie header', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                cookieHeader:
                    'other=val; puter_token=session-abc; trailing=last',
            }),
        );
        expect(stub.seenTokens).toEqual(['session-abc']);
    });

    it('URL-decodes the cookie value and strips surrounding quotes', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        // Quoted + percent-encoded value: `"a b"` → `a b`
        await runProbe(probe, makeReq({ cookieHeader: 'puter_token="a%20b"' }));
        expect(stub.seenTokens).toEqual(['a b']);
    });

    it("doesn't touch cookies when no cookieName is configured", async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        await runProbe(
            probe,
            makeReq({ cookieHeader: 'puter_token=session-abc' }),
        );
        expect(stub.seenTokens).toEqual([]);
    });

    it('ignores session cookies on cross-origin browser requests', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        const { req } = await runProbe(
            probe,
            makeReq({
                protocol: 'https',
                headers: {
                    host: 'api.puter.test',
                    origin: 'https://attacker.example',
                },
                cookieHeader: 'puter_token=session-abc',
            }),
        );

        expect(stub.seenTokens).toEqual([]);
        expect(req.actor).toBeUndefined();
        expect(req.tokenAuthFailed).toBeUndefined();
    });

    it('still accepts bearer tokens on cross-origin browser requests', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                protocol: 'https',
                headers: {
                    authorization: 'Bearer header-tok',
                    host: 'api.puter.test',
                    origin: 'https://app.example',
                },
                cookieHeader: 'puter_token=session-abc',
            }),
        );

        expect(stub.seenTokens).toEqual(['header-tok']);
    });

    it('keeps session cookies for same-origin browser requests', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                protocol: 'https',
                headers: {
                    host: 'api.puter.test',
                    origin: 'https://api.puter.test',
                },
                cookieHeader: 'puter_token=session-abc',
            }),
        );

        expect(stub.seenTokens).toEqual(['session-abc']);
    });

    it('normalizes default ports when comparing browser origins', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                protocol: 'https',
                headers: {
                    host: 'api.puter.test:443',
                    origin: 'https://api.puter.test',
                },
                cookieHeader: 'puter_token=session-abc',
            }),
        );

        expect(stub.seenTokens).toEqual(['session-abc']);
    });

    it('treats protocol mismatches as cross-origin for session cookies', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({
            authService: stub.service,
            cookieName: 'puter_token',
        });
        await runProbe(
            probe,
            makeReq({
                protocol: 'https',
                headers: {
                    host: 'api.puter.test',
                    origin: 'http://api.puter.test',
                },
                cookieHeader: 'puter_token=session-abc',
            }),
        );

        expect(stub.seenTokens).toEqual([]);
    });
});

// ── Behavior when AuthService responds ──────────────────────────────

describe('createAuthProbe — actor attachment + failure tracking', () => {
    it('attaches actor + token on a successful authenticate', async () => {
        const actor: Actor = { user: { uuid: 'u-1' } };
        const stub = makeStubAuth(actor);
        const probe = createAuthProbe({ authService: stub.service });
        const { req } = await runProbe(
            probe,
            makeReq({ headers: { authorization: 'Bearer good-tok' } }),
        );
        expect(req.actor).toBe(actor);
        expect(req.token).toBe('good-tok');
        expect(req.tokenAuthFailed).toBeUndefined();
    });

    it('sets tokenAuthFailed when AuthService returns null (token resolved nothing)', async () => {
        const stub = makeStubAuth(null);
        const probe = createAuthProbe({ authService: stub.service });
        const { req } = await runProbe(
            probe,
            makeReq({ headers: { authorization: 'Bearer dead-tok' } }),
        );
        expect(req.actor).toBeUndefined();
        expect(req.tokenAuthFailed).toBe(true);
    });

    it('never rejects — sets tokenAuthFailed even when AuthService throws', async () => {
        const stub = makeStubAuth();
        stub.setNext('throw');
        const probe = createAuthProbe({ authService: stub.service });
        const { req, next } = await runProbe(
            probe,
            makeReq({ headers: { authorization: 'Bearer bad-tok' } }),
        );
        // Critical invariant: the probe NEVER rejects, no matter what.
        expect(next).toHaveBeenCalledWith();
        expect(req.tokenAuthFailed).toBe(true);
        expect(req.actor).toBeUndefined();
    });

    it("doesn't call AuthService when no token was found", async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        const { req } = await runProbe(probe, makeReq({}));
        expect(stub.seenTokens).toEqual([]);
        expect(req.actor).toBeUndefined();
        expect(req.tokenAuthFailed).toBeUndefined();
    });

    it('respects a pre-existing req.actor — does not re-probe', async () => {
        const stub = makeStubAuth();
        const probe = createAuthProbe({ authService: stub.service });
        const pre: Actor = { user: { uuid: 'pre-set' } };
        const { req } = await runProbe(
            probe,
            makeReq({
                actor: pre,
                headers: { authorization: 'Bearer ignored' },
            }),
        );
        // No call into AuthService — upstream already attached an actor.
        expect(stub.seenTokens).toEqual([]);
        expect(req.actor).toBe(pre);
    });
});

// ── Server-backed end-to-end (real AuthService + DB) ────────────────
//
// The unit tests above cover the extraction logic in isolation. This
// section validates that a real session token round-trips through the
// real AuthService into a real Actor.

let server: PuterServer;
let authService: AuthService;

beforeAll(async () => {
    server = await setupTestServer();
    authService = server.services.auth as unknown as AuthService;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async () => {
    const username = `ap-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    return (await server.stores.user.getById(created.id))!;
};

describe('createAuthProbe (integration) — real session token → real actor', () => {
    it('resolves a real session token issued by AuthService into req.actor', async () => {
        const user = await makeUser();
        const { token } = await authService.createSessionToken(user);

        const probe = createAuthProbe({ authService });
        const { req } = await runProbe(
            probe,
            makeReq({ headers: { authorization: `Bearer ${token}` } }),
        );
        expect(req.actor?.user?.uuid).toBe(user.uuid);
        expect(req.tokenAuthFailed).toBeUndefined();
    });

    it('sets tokenAuthFailed=true for a syntactically valid but garbage token', async () => {
        const probe = createAuthProbe({ authService });
        const { req } = await runProbe(
            probe,
            makeReq({ headers: { authorization: 'Bearer not-a-real-jwt' } }),
        );
        expect(req.actor).toBeUndefined();
        expect(req.tokenAuthFailed).toBe(true);
    });
});
