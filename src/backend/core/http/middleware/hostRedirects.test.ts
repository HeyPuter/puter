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

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../../types';
import { HttpError } from '../HttpError';
import {
    addClaimedSubdomain,
    createNativeAppStatic,
    createUserSubdomainNotFound,
    createWwwRedirect,
    type ResolvedClaim,
    type SubdomainClaim,
} from './hostRedirects';

// ── Tiny harness ────────────────────────────────────────────────────
//
// Each middleware calls next() (pass-through), next(err) (rejection), or
// res.redirect(...). Capture all so each test can assert against the outcome
// it cares about.

interface CapturedRes {
    redirectArgs?: unknown[];
}

const makeRes = (): { res: Response; out: CapturedRes } => {
    const out: CapturedRes = {};
    const res = {
        redirect(...args: unknown[]) {
            out.redirectArgs = args;
        },
    } as unknown as Response;
    return { res, out };
};

interface ReqInit {
    subdomains?: string[];
    host?: string;
    protocol?: string;
    originalUrl?: string;
}

// `req.subdomains` in express is right-to-left (`['com', 'puter', 'foo']`
// for `foo.puter.com`), with the active subdomain at the end.
const makeReq = (init: ReqInit): Request =>
    ({
        subdomains: init.subdomains ?? [],
        protocol: init.protocol ?? 'https',
        originalUrl: init.originalUrl ?? '/',
        headers: { host: init.host ?? '' },
    }) as unknown as Request;

const run = (
    middleware: (req: Request, res: Response, next: () => void) => void,
    req: Request,
) => {
    const { res, out } = makeRes();
    const next = vi.fn();
    middleware(req, res, next);
    return { out, next };
};

const expectNotFound = (next: ReturnType<typeof vi.fn>) => {
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(404);
};

// ── createWwwRedirect ───────────────────────────────────────────────

describe('createWwwRedirect', () => {
    const config = { domain: 'puter.com' } as IConfig;

    it('redirects www.<domain> → <domain> (path dropped on purpose)', () => {
        // www → apex is a canonicalization, not a route — the original
        // path is intentionally discarded.
        const { out, next } = run(
            createWwwRedirect(config),
            makeReq({
                subdomains: ['com', 'puter', 'www'],
                host: 'www.puter.com',
                originalUrl: '/some/path?x=1',
            }),
        );
        expect(out.redirectArgs).toEqual(['https://puter.com']);
        expect(next).not.toHaveBeenCalled();
    });

    it('passes through non-www subdomains', () => {
        const { out, next } = run(
            createWwwRedirect(config),
            makeReq({
                subdomains: ['com', 'puter', 'api'],
                host: 'api.puter.com',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes through when no subdomain is present', () => {
        const { next } = run(
            createWwwRedirect(config),
            makeReq({ subdomains: [], host: 'puter.com' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
    });

    it("passes through when config.domain isn't configured (no target to redirect to)", () => {
        const { out, next } = run(
            createWwwRedirect({} as IConfig),
            makeReq({
                subdomains: ['com', 'puter', 'www'],
                host: 'www.puter.com',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('preserves the request protocol (http or https)', () => {
        const { out } = run(
            createWwwRedirect(config),
            makeReq({
                subdomains: ['com', 'puter', 'www'],
                host: 'www.puter.com',
                protocol: 'http',
            }),
        );
        expect(out.redirectArgs).toEqual(['http://puter.com']);
    });
});

// ── createUserSubdomainNotFound ─────────────────────────────────────

describe('createUserSubdomainNotFound', () => {
    const config = {
        domain: 'puter.com',
        static_hosting_domain: 'puter.site',
    } as IConfig;

    it('404s a user subdomain on the main domain (never redirects)', () => {
        const { out, next } = run(
            createUserSubdomainNotFound(config),
            makeReq({
                subdomains: ['com', 'puter', 'foo'],
                host: 'foo.puter.com',
                originalUrl: '/bar?x=1',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expectNotFound(next);
    });

    it('passes through reserved subdomains (api, js, native apps, etc.)', () => {
        // `api`, `js`, `dav`, `docs`, `developer`, `editor`, `pdf`,
        // `puter-app-icons`, `onlyoffice`, etc. all bypass.
        for (const sub of ['api', 'js', 'docs', 'editor', 'puter-app-icons']) {
            const { out, next } = run(
                createUserSubdomainNotFound(config),
                makeReq({
                    subdomains: ['com', 'puter', sub],
                    host: `${sub}.puter.com`,
                }),
            );
            expect(out.redirectArgs).toBeUndefined();
            expect(next).toHaveBeenCalledWith();
        }
    });

    it('passes through when no subdomain is present (root)', () => {
        const { next } = run(
            createUserSubdomainNotFound(config),
            makeReq({ subdomains: [], host: 'puter.com' }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it("passes through hosts that don't end in the configured domain (custom domains)", () => {
        const { next } = run(
            createUserSubdomainNotFound(config),
            makeReq({
                subdomains: ['com', 'example', 'foo'],
                host: 'foo.example.com',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it('returns a no-op middleware when no static_hosting_domain is configured', () => {
        // Self-hosted deployments without a separate hosting domain may serve
        // sites on the main domain; don't 404 them.
        const noStatic = { domain: 'puter.com' } as IConfig;
        const { next } = run(
            createUserSubdomainNotFound(noStatic),
            makeReq({
                subdomains: ['com', 'puter', 'foo'],
                host: 'foo.puter.com',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it('returns a no-op middleware when no main domain is configured', () => {
        const noDomain = { static_hosting_domain: 'puter.site' } as IConfig;
        const { next } = run(
            createUserSubdomainNotFound(noDomain),
            makeReq({
                subdomains: ['com', 'puter', 'foo'],
                host: 'foo.puter.com',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it('lowercases the active subdomain when comparing against the reserved set', () => {
        // Reserved-subdomain matching must be case-insensitive — otherwise
        // a request to `API.puter.com` would accidentally 404.
        const { next } = run(
            createUserSubdomainNotFound(config),
            makeReq({
                subdomains: ['com', 'puter', 'API'],
                host: 'API.puter.com',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it('matches the domain suffix with its port when one is configured', () => {
        const localConfig = {
            domain: 'puter.localhost:4100',
            static_hosting_domain: 'site.puter.localhost:4100',
        } as IConfig;
        const { next } = run(
            createUserSubdomainNotFound(localConfig),
            makeReq({
                subdomains: ['localhost', 'puter', 'foo'],
                host: 'foo.puter.localhost:4100',
                originalUrl: '/x',
                protocol: 'http',
            }),
        );
        expectNotFound(next);
    });

    const selfHosted = {
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_domain_alt: 'host.puter.localhost',
        private_app_hosting_domain: 'app.puter.localhost',
        private_app_hosting_domain_alt: 'dev.puter.localhost',
    } as IConfig;

    it('404s a bare subdomain on the main domain (self-hosted)', () => {
        const { next } = run(
            createUserSubdomainNotFound(selfHosted),
            makeReq({
                subdomains: ['localhost', 'puter', 'foo'],
                host: 'foo.puter.localhost',
                originalUrl: '/bar?x=1',
                protocol: 'http',
            }),
        );
        expectNotFound(next);
    });

    it('passes through hosts on the static hosting domain nested under the main domain', () => {
        const { next } = run(
            createUserSubdomainNotFound(selfHosted),
            makeReq({
                subdomains: ['localhost', 'puter', 'site', 'foo'],
                host: 'foo.site.puter.localhost',
                originalUrl: '/',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it('passes through hosts on the alt / private-app hosting domains too', () => {
        for (const host of [
            'foo.host.puter.localhost',
            'foo.app.puter.localhost',
            'foo.dev.puter.localhost',
        ]) {
            const { next } = run(
                createUserSubdomainNotFound(selfHosted),
                makeReq({
                    subdomains: [
                        'localhost',
                        'puter',
                        host.split('.')[1],
                        'foo',
                    ],
                    host,
                }),
            );
            expect(next).toHaveBeenCalledWith();
        }
    });

    it('passes through the hosting-domain root itself', () => {
        const { next } = run(
            createUserSubdomainNotFound(selfHosted),
            makeReq({
                subdomains: ['localhost', 'puter', 'site'],
                host: 'site.puter.localhost',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it("404s a user subdomain whose host carries a port the configured domain doesn't", () => {
        // Hosts compare without their port, so a ported host can't slip past
        // the 404 that its port-less form gets.
        const portlessConfig = {
            domain: 'puter.localhost',
            static_hosting_domain: 'site.puter.localhost',
        } as IConfig;
        for (const host of [
            'foo.puter.localhost:4100',
            'foo.puter.localhost:443',
        ]) {
            const { next } = run(
                createUserSubdomainNotFound(portlessConfig),
                makeReq({ subdomains: ['localhost', 'puter', 'foo'], host }),
            );
            expectNotFound(next);
        }
    });

    it('passes through a host that only shares the domain as a text suffix', () => {
        const { next } = run(
            createUserSubdomainNotFound(config),
            makeReq({
                subdomains: ['com', 'evilputer', 'foo'],
                host: 'foo.evilputer.com',
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it('passes through local worker hosts while the local worker server is on', () => {
        const workerHost = 'hello.workers.puter.localhost:4100';
        const req = () =>
            makeReq({
                subdomains: ['localhost', 'puter', 'workers', 'hello'],
                host: workerHost,
            });
        const on = run(
            createUserSubdomainNotFound({
                ...selfHosted,
                workers: { localServer: true },
            } as IConfig),
            req(),
        );
        expect(on.next).toHaveBeenCalledWith();
        const off = run(createUserSubdomainNotFound(selfHosted), req());
        expectNotFound(off.next);
    });
});

// -- Claimed subdomains ---------------------------------------------

describe('createUserSubdomainNotFound with claimed subdomains', () => {
    const config = {
        domain: 'puter.com',
        static_hosting_domain: 'puter.site',
    } as IConfig;

    // Express derives these with the root domain's labels already dropped.
    const hostReq = (host: string, subdomains: string[]) =>
        ({
            subdomains,
            protocol: 'https',
            originalUrl: '/',
            headers: { host },
        }) as unknown as Request;

    const lookup =
        (claims: Record<string, ResolvedClaim>) =>
        (name: string): ResolvedClaim | undefined =>
            claims[name];

    const allow = () => true;

    /** Resolves with whatever the middleware hands to the global `next`. */
    const runClaimed = (
        middleware: RequestHandler,
        req: Request,
        res: Response = {} as Response,
    ): Promise<unknown[]> =>
        new Promise((resolve) => {
            middleware(req, res, ((...args: unknown[]) =>
                resolve(args)) as NextFunction);
        });

    const unclaimedError = async () => {
        const [err] = await runClaimed(
            createUserSubdomainNotFound(config),
            hostReq('foo.puter.com', ['foo']),
        );
        return err as HttpError;
    };

    const expectUnclaimed404 = async (err: unknown) => {
        const expected = await unclaimedError();
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(expected.statusCode);
        expect((err as HttpError).message).toBe(expected.message);
        expect((err as HttpError).legacyCode).toBe(expected.legacyCode);
    };

    it('hands an authorized request for the exact claimed host to its routes', async () => {
        const authorize = vi.fn(allow);
        const handler = vi.fn((_req, res: Response) => {
            (res as unknown as { handled: boolean }).handled = true;
        });
        const next = vi.fn();
        const res = {} as Response;
        const req = hostReq('portal.puter.com', ['portal']);
        createUserSubdomainNotFound(
            config,
            lookup({ portal: { authorize, handler } }),
        )(req, res, next);
        await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
        expect(authorize).toHaveBeenCalledWith(req, res);
        expect((res as unknown as { handled: boolean }).handled).toBe(true);
        expect(next).not.toHaveBeenCalled();
    });

    it('answers an unauthorized request with the unclaimed-subdomain 404', async () => {
        for (const authorize of [
            () => false,
            async () => false,
            () => 'yes' as unknown as boolean,
        ]) {
            const handler = vi.fn();
            const [err] = await runClaimed(
                createUserSubdomainNotFound(
                    config,
                    lookup({ portal: { authorize, handler } }),
                ),
                hostReq('portal.puter.com', ['portal']),
            );
            expect(handler).not.toHaveBeenCalled();
            await expectUnclaimed404(err);
        }
    });

    it('treats an authorize that throws as unauthorized', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (const authorize of [
                () => {
                    throw new Error('store down');
                },
                async () => {
                    throw new Error('store down');
                },
            ]) {
                const [err] = await runClaimed(
                    createUserSubdomainNotFound(
                        config,
                        lookup({ portal: { authorize, handler: vi.fn() } }),
                    ),
                    hostReq('portal.puter.com', ['portal']),
                );
                await expectUnclaimed404(err);
            }
        } finally {
            warn.mockRestore();
        }
    });

    it('sends an HttpError thrown by authorize as is', async () => {
        const forbidden = new HttpError(403, 'Forbidden');
        const [err] = await runClaimed(
            createUserSubdomainNotFound(
                config,
                lookup({
                    portal: {
                        authorize: () => {
                            throw forbidden;
                        },
                        handler: vi.fn(),
                    },
                }),
            ),
            hostReq('portal.puter.com', ['portal']),
        );
        expect(err).toBe(forbidden);
    });

    it('404s an authorized request when the claim has no routes', async () => {
        const [err] = await runClaimed(
            createUserSubdomainNotFound(
                config,
                lookup({ portal: { authorize: allow } }),
            ),
            hostReq('portal.puter.com', ['portal']),
        );
        await expectUnclaimed404(err);
    });

    it('turns an unanswered request into the unclaimed-subdomain 404', async () => {
        for (const signal of [undefined, 'route', 'router'] as const) {
            const [err] = await runClaimed(
                createUserSubdomainNotFound(
                    config,
                    lookup({
                        portal: {
                            authorize: allow,
                            handler: (_req, _res, next) =>
                                signal ? next(signal) : next(),
                        },
                    }),
                ),
                hostReq('portal.puter.com', ['portal']),
            );
            await expectUnclaimed404(err);
        }
    });

    it("passes an error from the claim's routes through unchanged", async () => {
        const boom = new HttpError(418, 'teapot');
        const thrown = new Error('async failure');
        for (const [handler, expected] of [
            [((_req, _res, next) => next(boom)) as RequestHandler, boom],
            [
                (async () => {
                    throw thrown;
                }) as RequestHandler,
                thrown,
            ],
        ] as const) {
            const [err] = await runClaimed(
                createUserSubdomainNotFound(
                    config,
                    lookup({ portal: { authorize: allow, handler } }),
                ),
                hostReq('portal.puter.com', ['portal']),
            );
            expect(err).toBe(expected);
        }
    });

    it('stays silent when a route already answered and then calls next()', async () => {
        const next = vi.fn();
        createUserSubdomainNotFound(
            config,
            lookup({
                portal: {
                    authorize: allow,
                    handler: (_req, _res, n) => n(),
                },
            }),
        )(
            hostReq('portal.puter.com', ['portal']),
            { headersSent: true } as Response,
            next,
        );
        await new Promise((r) => setTimeout(r, 0));
        expect(next).not.toHaveBeenCalled();
    });

    it('does not consult the claim for a deeper host under its label', async () => {
        const authorize = vi.fn(allow);
        const [err] = await runClaimed(
            createUserSubdomainNotFound(
                config,
                lookup({ portal: { authorize, handler: vi.fn() } }),
            ),
            hostReq('portal.x.puter.com', ['x', 'portal']),
        );
        expect(authorize).not.toHaveBeenCalled();
        expect((err as HttpError).statusCode).toBe(404);
    });

    it('does not consult the claim when the Host header and the derived subdomain disagree', async () => {
        const authorize = vi.fn(allow);
        const [err] = await runClaimed(
            createUserSubdomainNotFound(
                config,
                lookup({ portal: { authorize, handler: vi.fn() } }),
            ),
            hostReq('foo.puter.com', ['portal']),
        );
        expect(authorize).not.toHaveBeenCalled();
        expect((err as HttpError).statusCode).toBe(404);
    });

    it('dispatches the claimed host when it carries a port', async () => {
        const handler = vi.fn((_req, _res, next: NextFunction) => next());
        const [err] = await runClaimed(
            createUserSubdomainNotFound(
                config,
                lookup({ portal: { authorize: allow, handler } }),
            ),
            hostReq('portal.puter.com:4100', ['portal']),
        );
        expect(handler).toHaveBeenCalledTimes(1);
        expect((err as HttpError).statusCode).toBe(404);
    });

    it('never shadows a hosting domain that shares the label', async () => {
        const selfHosted = {
            domain: 'puter.localhost',
            static_hosting_domain: 'site.puter.localhost',
        } as IConfig;
        const authorize = vi.fn(allow);
        const args = await runClaimed(
            createUserSubdomainNotFound(
                selfHosted,
                lookup({ site: { authorize, handler: vi.fn() } }),
            ),
            hostReq('site.puter.localhost', ['site']),
        );
        expect(authorize).not.toHaveBeenCalled();
        expect(args).toEqual([]);
    });

    it('looks the claim up on every request', async () => {
        const claims: Record<string, ResolvedClaim> = {};
        const middleware = createUserSubdomainNotFound(config, lookup(claims));
        const handler = vi.fn((_req, _res, next: NextFunction) => next());
        claims.late = { authorize: allow, handler };
        await runClaimed(middleware, hostReq('late.puter.com', ['late']));
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('addClaimedSubdomain', () => {
    const claim: SubdomainClaim = { authorize: () => true };

    it('records a valid label', () => {
        const claims = new Map<string, SubdomainClaim>();
        addClaimedSubdomain(claims, 'portal-2', claim);
        expect(claims.get('portal-2')?.authorize).toBe(claim.authorize);
    });

    it('rejects malformed labels', () => {
        for (const name of [
            '',
            'Portal',
            'a.b',
            '-a',
            'a-',
            'a_b',
            'a b',
            'x'.repeat(64),
        ]) {
            expect(() => addClaimedSubdomain(new Map(), name, claim)).toThrow(
                /Invalid subdomain label/,
            );
        }
    });

    it('rejects subdomains core already handles', () => {
        for (const name of ['www', 'api', 'js', 'dav', 'docs', 'onlyoffice']) {
            expect(() => addClaimedSubdomain(new Map(), name, claim)).toThrow(
                /reserved/,
            );
        }
    });

    it('rejects a second claim on the same name', () => {
        const claims = new Map<string, SubdomainClaim>();
        addClaimedSubdomain(claims, 'portal', claim);
        expect(() =>
            addClaimedSubdomain(claims, 'portal', { authorize: () => false }),
        ).toThrow(/already claimed/);
        expect(claims.get('portal')?.authorize).toBe(claim.authorize);
    });

    it('keeps checkRoute, and rejects one that is not a function', () => {
        const checkRoute = () => undefined;
        const claims = new Map<string, SubdomainClaim>();
        addClaimedSubdomain(claims, 'portal', { ...claim, checkRoute });
        expect(claims.get('portal')?.checkRoute).toBe(checkRoute);
        expect(() =>
            addClaimedSubdomain(new Map(), 'portal', {
                ...claim,
                checkRoute: 'no' as unknown as typeof checkRoute,
            }),
        ).toThrow(/invalid checkRoute/);
    });

    it('rejects a claim without authorize', () => {
        for (const bad of [undefined, {}, { authorize: true }]) {
            expect(() =>
                addClaimedSubdomain(
                    new Map(),
                    'portal',
                    bad as unknown as SubdomainClaim,
                ),
            ).toThrow(/without authorize/);
        }
    });
});

// ── createNativeAppStatic ───────────────────────────────────────────

describe('createNativeAppStatic', () => {
    let root: string;

    // Express's `res.sendFile` is the only piece we stand in for — the
    // middleware's contract with it is "path relative to `root`".
    interface StaticRes {
        sent?: { path: string; root: string };
        redirectArgs?: unknown[];
    }

    const makeStaticRes = (sendFileError?: Error) => {
        const out: StaticRes = {};
        const res = {
            redirect(...args: unknown[]) {
                out.redirectArgs = args;
            },
            sendFile(
                path: string,
                options: { root: string },
                cb: (err?: Error) => void,
            ) {
                out.sent = { path, root: options.root };
                cb(sendFileError);
            },
        } as unknown as Response;
        return { res, out };
    };

    const staticReq = (init: {
        subdomains?: string[];
        path?: string;
        originalUrl?: string;
    }): Request =>
        ({
            subdomains: init.subdomains ?? [],
            path: init.path ?? '/',
            originalUrl: init.originalUrl ?? init.path ?? '/',
            headers: {},
        }) as unknown as Request;

    const runStatic = async (
        middleware: ReturnType<typeof createNativeAppStatic>,
        req: Request,
        sendFileError?: Error,
    ) => {
        const { res, out } = makeStaticRes(sendFileError);
        const next = vi.fn();
        await (
            middleware as unknown as (
                q: Request,
                s: Response,
                n: () => void,
            ) => Promise<void>
        )(req, res, next);
        return { out, next };
    };

    beforeAll(() => {
        root = mkdtempSync(nodePath.join(tmpdir(), 'native-apps-'));
        mkdirSync(nodePath.join(root, 'editor', 'assets'), { recursive: true });
        writeFileSync(
            nodePath.join(root, 'editor', 'index.html'),
            '<h1>editor</h1>',
        );
        writeFileSync(
            nodePath.join(root, 'editor', 'assets', 'app.js'),
            'console.log(1);',
        );
        mkdirSync(nodePath.join(root, 'docs', 'dist'), { recursive: true });
        writeFileSync(
            nodePath.join(root, 'docs', 'dist', 'index.html'),
            '<h1>docs</h1>',
        );
        // A `docs/index.html` outside `dist` must NOT be what gets served.
        writeFileSync(nodePath.join(root, 'docs', 'index.html'), 'WRONG');
    });

    afterAll(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const config = { native_apps_root: '' } as unknown as IConfig;
    const withRoot = () =>
        createNativeAppStatic({ native_apps_root: root } as unknown as IConfig);

    it('is a no-op when native_apps_root is unset', async () => {
        const { out, next } = await runStatic(
            createNativeAppStatic(config),
            staticReq({
                subdomains: ['localhost', 'puter', 'editor'],
                path: '/index.html',
            }),
        );
        expect(out.sent).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes through subdomains that are not native apps', async () => {
        const { out, next } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'api'],
                path: '/index.html',
            }),
        );
        expect(out.sent).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes through when there is no subdomain at all', async () => {
        const { next } = await runStatic(
            withRoot(),
            staticReq({ subdomains: [], path: '/index.html' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('serves a file from <root>/<app> for a plain native app', async () => {
        const { out, next } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'editor'],
                path: '/index.html',
            }),
        );
        expect(out.sent).toEqual({
            path: '/index.html',
            root: nodePath.join(root, 'editor'),
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('matches the subdomain case-insensitively', async () => {
        const { out } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'EDITOR'],
                path: '/index.html',
            }),
        );
        expect(out.sent?.root).toBe(nodePath.join(root, 'editor'));
    });

    it('serves docs out of its dist/ subdirectory, not the app root', async () => {
        const { out } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'docs'],
                path: '/index.html',
            }),
        );
        expect(out.sent).toEqual({
            path: '/index.html',
            root: nodePath.join(root, 'docs', 'dist'),
        });
    });

    it('307s a directory request without a trailing slash, preserving the query', async () => {
        const { out, next } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'editor'],
                path: '/assets',
                originalUrl: '/assets?v=2',
            }),
        );
        expect(out.redirectArgs).toEqual([307, '/assets/?v=2']);
        expect(out.sent).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('serves a directory request that already has the trailing slash', async () => {
        // `stat` resolves the directory, but with the slash present the
        // middleware hands it to sendFile (which serves index.html).
        const { out } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'editor'],
                path: '/assets/',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(out.sent?.path).toBe('/assets/');
    });

    it('falls through when the requested file does not exist', async () => {
        const { out, next } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'editor'],
                path: '/nope.html',
            }),
        );
        expect(out.sent).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('falls through when sendFile reports an error', async () => {
        const { next } = await runStatic(
            withRoot(),
            staticReq({
                subdomains: ['localhost', 'puter', 'editor'],
                path: '/index.html',
            }),
            new Error('send failed'),
        );
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects a traversal path before it can touch the filesystem', async () => {
        await expect(
            runStatic(
                withRoot(),
                staticReq({
                    subdomains: ['localhost', 'puter', 'editor'],
                    path: '/../../etc/passwd',
                }),
            ),
        ).rejects.toThrow();
    });
});
