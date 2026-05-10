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
import type { IConfig } from '../../../types';
import {
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
