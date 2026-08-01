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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../../types';
import {
    createNativeAppStatic,
    createUserSubdomainRedirect,
    createWwwRedirect,
} from './hostRedirects';

// ── Tiny harness ────────────────────────────────────────────────────
//
// Each middleware either calls next() (pass-through) or res.redirect(...).
// Capture both so each test can assert against the outcome it cares about.

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

// ── createUserSubdomainRedirect ─────────────────────────────────────

describe('createUserSubdomainRedirect', () => {
    const config = {
        domain: 'puter.com',
        static_hosting_domain: 'puter.site',
    } as IConfig;

    it('redirects user subdomain to the static hosting domain — preserves path + query', () => {
        // foo.puter.com/bar?x=1 → 302 foo.puter.site/bar?x=1
        const { out, next } = run(
            createUserSubdomainRedirect(config),
            makeReq({
                subdomains: ['com', 'puter', 'foo'],
                host: 'foo.puter.com',
                originalUrl: '/bar?x=1',
            }),
        );
        expect(out.redirectArgs).toEqual([
            302,
            'https://foo.puter.site/bar?x=1',
        ]);
        expect(next).not.toHaveBeenCalled();
    });

    it('passes through reserved subdomains (api, js, native apps, etc.)', () => {
        // `api`, `js`, `dav`, `docs`, `developer`, `editor`, `pdf`,
        // `puter-app-icons`, `onlyoffice`, etc. all bypass.
        for (const sub of ['api', 'js', 'docs', 'editor', 'puter-app-icons']) {
            const { out, next } = run(
                createUserSubdomainRedirect(config),
                makeReq({
                    subdomains: ['com', 'puter', sub],
                    host: `${sub}.puter.com`,
                }),
            );
            expect(out.redirectArgs).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        }
    });

    it('passes through when no subdomain is present (root)', () => {
        const { out, next } = run(
            createUserSubdomainRedirect(config),
            makeReq({ subdomains: [], host: 'puter.com' }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it("passes through hosts that don't end in the configured domain (custom domains)", () => {
        const { out, next } = run(
            createUserSubdomainRedirect(config),
            makeReq({
                subdomains: ['com', 'example', 'foo'],
                host: 'foo.example.com',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns a no-op middleware when no static_hosting_domain is configured', () => {
        // Self-hosted deployments without a separate hosting domain
        // shouldn't trip user-subdomain redirects at all.
        const noStatic = { domain: 'puter.com' } as IConfig;
        const { out, next } = run(
            createUserSubdomainRedirect(noStatic),
            makeReq({
                subdomains: ['com', 'puter', 'foo'],
                host: 'foo.puter.com',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns a no-op middleware when no main domain is configured', () => {
        const noDomain = { static_hosting_domain: 'puter.site' } as IConfig;
        const { out, next } = run(
            createUserSubdomainRedirect(noDomain),
            makeReq({
                subdomains: ['com', 'puter', 'foo'],
                host: 'foo.puter.com',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('lowercases the active subdomain when comparing against the reserved set', () => {
        // Reserved-subdomain matching must be case-insensitive — otherwise
        // a request to `API.puter.com` would accidentally redirect.
        const { out, next } = run(
            createUserSubdomainRedirect(config),
            makeReq({
                subdomains: ['com', 'puter', 'API'],
                host: 'API.puter.com',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('preserves the port when swapping domain suffix (port baked into target)', () => {
        // The middleware does a raw `endsWith` on `host` to find the
        // domain suffix, so if production puts a port on `config.domain`,
        // it has to match exactly. Configure both with the port to
        // exercise the suffix-swap with a port preserved.
        const localConfig = {
            domain: 'puter.localhost:4100',
            static_hosting_domain: 'site.puter.localhost:4100',
        } as IConfig;
        const { out } = run(
            createUserSubdomainRedirect(localConfig),
            makeReq({
                subdomains: ['localhost', 'puter', 'foo'],
                host: 'foo.puter.localhost:4100',
                originalUrl: '/x',
                protocol: 'http',
            }),
        );
        expect(out.redirectArgs).toEqual([
            302,
            'http://foo.site.puter.localhost:4100/x',
        ]);
    });

    const selfHosted = {
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_domain_alt: 'host.puter.localhost',
        private_app_hosting_domain: 'app.puter.localhost',
        private_app_hosting_domain_alt: 'dev.puter.localhost',
    } as IConfig;

    it('still redirects a bare subdomain on the main domain to the hosting domain (self-hosted)', () => {
        const { out, next } = run(
            createUserSubdomainRedirect(selfHosted),
            makeReq({
                subdomains: ['localhost', 'puter', 'foo'],
                host: 'foo.puter.localhost',
                originalUrl: '/bar?x=1',
                protocol: 'http',
            }),
        );
        expect(out.redirectArgs).toEqual([
            302,
            'http://foo.site.puter.localhost/bar?x=1',
        ]);
        expect(next).not.toHaveBeenCalled();
    });

    it('passes through hosts already on the static hosting domain (no redirect loop)', () => {
        const { out, next } = run(
            createUserSubdomainRedirect(selfHosted),
            makeReq({
                subdomains: ['localhost', 'puter', 'site', 'foo'],
                host: 'foo.site.puter.localhost',
                originalUrl: '/',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes through hosts on the alt / private-app hosting domains too', () => {
        for (const host of [
            'foo.host.puter.localhost',
            'foo.app.puter.localhost',
            'foo.dev.puter.localhost',
        ]) {
            const { out, next } = run(
                createUserSubdomainRedirect(selfHosted),
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
            expect(out.redirectArgs).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        }
    });

    it('passes through the hosting-domain root itself (exact match, no loop)', () => {
        const { out, next } = run(
            createUserSubdomainRedirect(selfHosted),
            makeReq({
                subdomains: ['localhost', 'puter', 'site'],
                host: 'site.puter.localhost',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it("passes through when the request host has a port the configured domain doesn't", () => {
        // Edge case worth pinning: the suffix check is exact-`endsWith`,
        // so a port mismatch silently bypasses the redirect. Documenting
        // it here so a future refactor doesn't change behavior unawares.
        const portlessConfig = {
            domain: 'puter.localhost',
            static_hosting_domain: 'site.puter.localhost',
        } as IConfig;
        const { out, next } = run(
            createUserSubdomainRedirect(portlessConfig),
            makeReq({
                subdomains: ['localhost', 'puter', 'foo'],
                host: 'foo.puter.localhost:4100',
            }),
        );
        expect(out.redirectArgs).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
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
