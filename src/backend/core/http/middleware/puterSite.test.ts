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
import { PuterServer } from '../../../server';
import { setupTestServer } from '../../../testUtil';
import type { IConfig } from '../../../types';
import { createPuterSiteMiddleware } from './puterSite';

// ── Harness ─────────────────────────────────────────────────────────
//
// puterSite is a single big handler that either writes a response or
// calls next(). We capture status / body / redirect / cookies / headers
// — enough to assert each branch without standing up the express stack.
//
// File-serving paths (Range, ETag, S3 streaming) aren't exercised here:
// they need real filesystem entries + S3 reads, which is a much bigger
// fixture setup. The early-out branches (config gating, unknown subdomain,
// suspended owner, missing root dir, private-host refusal) are the ones
// security-sensitive enough to be worth pinning.

interface CapturedRes {
    statusCode?: number;
    body?: unknown;
    contentType?: string;
    redirected?: { status?: number; url: string };
    headers: Record<string, string>;
}

const makeRes = () => {
    const out: CapturedRes = { headers: {} };
    const res = {
        status(code: number) {
            out.statusCode = code;
            return this;
        },
        type(ct: string) {
            out.contentType = ct;
            return this;
        },
        send(payload: unknown) {
            out.body = payload;
            return this;
        },
        redirect(...args: unknown[]) {
            if (typeof args[0] === 'number') {
                out.redirected = {
                    status: args[0] as number,
                    url: String(args[1]),
                };
            } else {
                out.redirected = { url: String(args[0]) };
            }
            return this;
        },
        cookie() {
            return this;
        },
        set(name: string, value: string) {
            out.headers[name] = value;
            return this;
        },
        setHeader(name: string, value: string) {
            out.headers[name] = value;
            return this;
        },
    } as unknown as Response;
    return { res, out };
};

const makeReq = (init: {
    hostname: string;
    path?: string;
    protocol?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
}): Request =>
    ({
        hostname: init.hostname,
        path: init.path ?? '/',
        protocol: init.protocol ?? 'http',
        headers: init.headers ?? {},
        cookies: init.cookies ?? {},
        query: {},
    }) as unknown as Request;

const runMiddleware = async (
    mw: ReturnType<typeof createPuterSiteMiddleware>,
    req: Request,
) => {
    const { res, out } = makeRes();
    const next = vi.fn();
    await mw(req, res, next);
    return { out, next };
};

// ── Server setup ────────────────────────────────────────────────────

let server: PuterServer;
const hostingConfig: IConfig = {
    domain: 'puter.localhost',
    static_hosting_domain: 'site.puter.localhost',
    static_hosting_domain_alt: null,
    private_app_hosting_domain: 'app.puter.localhost',
    private_app_hosting_domain_alt: null,
    protocol: 'http',
} as unknown as IConfig;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const buildMiddleware = (configOverride?: Partial<IConfig>) =>
    createPuterSiteMiddleware(
        { ...hostingConfig, ...configOverride } as IConfig,
        {
            clients: server.clients,
            stores: server.stores,
            services: server.services,
        },
    );

const makeUser = async (suspended = false) => {
    const username = `ps-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    } as Parameters<typeof server.stores.user.create>[0]);
    if (suspended) {
        // Go through the store's `update` so the user cache gets
        // refreshed — otherwise puterSite's cached `getById` will still
        // see the row as unsuspended.
        await server.stores.user.update(created.id, { suspended: 1 });
    }
    return (await server.stores.user.getById(created.id))!;
};

// ── Config gating ───────────────────────────────────────────────────

describe('createPuterSiteMiddleware — config gating', () => {
    it('returns a no-op when no hosting domains are configured', async () => {
        // Self-hosted deployments without user site hosting shouldn't
        // touch any request, even ones that look like site hostnames.
        const mw = createPuterSiteMiddleware(
            {
                domain: 'puter.localhost',
                static_hosting_domain: null,
                static_hosting_domain_alt: null,
                private_app_hosting_domain: null,
                private_app_hosting_domain_alt: null,
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        const { out, next } = await runMiddleware(
            mw,
            makeReq({ hostname: 'beans.site.puter.localhost' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(out.statusCode).toBeUndefined();
        expect(out.redirected).toBeUndefined();
    });

    it("passes through hosts that aren't one of the configured hosting domains", async () => {
        const mw = buildMiddleware();
        const { out, next } = await runMiddleware(
            mw,
            makeReq({ hostname: 'api.puter.localhost' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(out.statusCode).toBeUndefined();
    });

    it("passes through when the hostname can't be parsed", async () => {
        const mw = buildMiddleware();
        const { out, next } = await runMiddleware(
            mw,
            makeReq({ hostname: '' }),
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(out.statusCode).toBeUndefined();
    });
});

// ── Bare / www on hosting domain ────────────────────────────────────

describe('createPuterSiteMiddleware — bare host and www', () => {
    it('redirects the bare hosting domain to the configured main domain', async () => {
        // Hitting `site.puter.localhost` directly (no subdomain) belongs
        // on the app shell — 302 to the main domain so legacy bookmarks
        // still work.
        const mw = buildMiddleware();
        const { out, next } = await runMiddleware(
            mw,
            makeReq({
                hostname: 'site.puter.localhost',
                protocol: 'http',
            }),
        );
        expect(next).not.toHaveBeenCalled();
        expect(out.redirected).toEqual({
            status: 302,
            url: 'http://puter.localhost',
        });
    });

    it('redirects www.<hosting-domain> the same way (treated as bare)', async () => {
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({
                hostname: 'www.site.puter.localhost',
                protocol: 'http',
            }),
        );
        expect(out.redirected).toEqual({
            status: 302,
            url: 'http://puter.localhost',
        });
    });

    it('404s the bare host when no main domain is configured (no leak)', async () => {
        // Without a main domain to redirect to, we'd otherwise have no
        // landing target. Returning 404 is the safe default.
        const mw = createPuterSiteMiddleware(
            {
                ...hostingConfig,
                domain: null,
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: 'site.puter.localhost' }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
    });
});

// ── Subdomain lookup ────────────────────────────────────────────────

describe('createPuterSiteMiddleware — subdomain lookup', () => {
    it('404s plain-text on an unknown subdomain (does not reveal whether any user owns it)', async () => {
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({
                hostname: `never-exists-${Math.random()
                    .toString(36)
                    .slice(2, 10)}.site.puter.localhost`,
            }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
        // Plain-text body — no HTML rendering at this stage.
        expect(out.contentType).toBe('text/plain');
    });

    it("404s when the owning user is suspended — same 'Subdomain not found' shape as unknown-subdomain (no leak)", async () => {
        // Critical: same status + same body as the unknown-subdomain
        // case. A different response here would leak suspension state.
        const owner = await makeUser(/* suspended */ true);
        const sub = `suspended-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: `${sub}.site.puter.localhost` }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
    });

    it('serves the HTML SUBDOMAIN_404 when the subdomain row has no root_dir_id', async () => {
        // The site exists but the owner never registered a directory —
        // give them the slightly friendlier HTML page rather than the
        // bare text 404 used for unknown subdomains.
        const owner = await makeUser();
        const sub = `noroot-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({ hostname: `${sub}.site.puter.localhost` }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.contentType).toBe('text/html; charset=UTF-8');
        expect(String(out.body)).toContain('404');
    });
});

// ── Private hosting domain refusal ──────────────────────────────────

describe('createPuterSiteMiddleware — private hosting domain', () => {
    it('404s a subdomain on the private host that has no private app (prevents public-site leak via private host)', async () => {
        // Owner exists, subdomain exists, but it has no associated
        // private app. On the *private* host this must refuse, not serve.
        const owner = await makeUser();
        const sub = `leak-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId: owner.id,
            subdomain: sub,
        });
        const mw = buildMiddleware();
        const { out } = await runMiddleware(
            mw,
            makeReq({
                // Note: app.puter.localhost is the *private* hosting domain.
                hostname: `${sub}.app.puter.localhost`,
            }),
        );
        expect(out.statusCode).toBe(404);
        expect(out.body).toBe('Subdomain not found');
    });
});
