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

import http from 'node:http';
import type { Request, RequestHandler, Response } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { extensionStore } from './extensions.ts';
import { PuterServer } from './server.ts';
import { allocateEphemeralPort, setupTestServer } from './testUtil.ts';
import type { IConfig } from './types';

/**
 * `fetch` refuses to set a `Host` header (it is a forbidden header name), and
 * the gates under test key on exactly that — so drive them with the raw http
 * client instead.
 */
interface RawResponse {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

const rawRequest = (
    port: number,
    path: string,
    headers: Record<string, string> = {},
): Promise<RawResponse> =>
    new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port, path, method: 'GET', headers },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.end();
    });

/**
 * These run against a real listening server so the always-on middleware stack
 * (host validation, CORS, IP gate) is exercised end to end — those gates are
 * installed imperatively on the express app and have no other entry point.
 */
describe('PuterServer host header validation', () => {
    let server: PuterServer;
    let port: number;

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${port}`,
                api_base_url: `http://api.puter.localhost:${port}`,
                // The gate under test is skipped entirely when hosts are
                // unrestricted (the OSS default).
                allow_all_host_values: false,
                allow_no_host_header: false,
                custom_domains_enabled: false,
                enable_ip_validation: true,
            } as unknown as IConfig,
            { listen: true },
        );
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const request = (path: string, headers: Record<string, string> = {}) =>
        rawRequest(port, path, headers);

    it('accepts the configured main domain and its subdomains', async () => {
        for (const host of [
            `puter.localhost:${port}`,
            `api.puter.localhost:${port}`,
            `anything.puter.localhost:${port}`,
        ]) {
            const res = await request('/healthcheck', { host });
            expect(res.status).not.toBe(400);
        }
    });

    it('accepts the hosting domains and the `at.` alias derived from them', async () => {
        for (const host of [
            `foo.site.puter.localhost:${port}`,
            `foo.host.puter.localhost:${port}`,
            `foo.app.puter.localhost:${port}`,
            `foo.dev.puter.localhost:${port}`,
            `someone.at.site.puter.localhost:${port}`,
        ]) {
            const res = await request('/', { host });
            expect(res.status).not.toBe(400);
        }
    });

    it('rejects a host outside every configured domain', async () => {
        const res = await request('/', { host: 'evil.example.com' });
        expect(res.status).toBe(400);
        expect(res.body).toBe('Invalid Host header.');
    });

    it('rejects a lookalike suffix that only ends with the domain text', async () => {
        const res = await request('/', { host: 'notputer.localhost' });
        expect(res.status).toBe(400);
    });

    it('lets /healthcheck through on any host', async () => {
        const res = await request('/healthcheck', {
            host: 'evil.example.com',
        });
        expect(res.status).toBe(200);
    });

    it('reflects the caller origin and allows credentials only on the api subdomain', async () => {
        const apiRes = await request('/healthcheck', {
            host: `api.puter.localhost:${port}`,
            origin: 'https://third-party.example',
        });
        expect(apiRes.headers['access-control-allow-origin']).toBe(
            'https://third-party.example',
        );
        expect(apiRes.headers['access-control-allow-credentials']).toBe('true');
        expect(String(apiRes.headers.vary).toLowerCase()).toContain('origin');

        const davRes = await request('/healthcheck', {
            host: `dav.puter.localhost:${port}`,
            origin: 'https://third-party.example',
        });
        expect(davRes.headers['access-control-allow-credentials']).toBe(
            'false',
        );
    });

    it('falls back to `*` when the request carries no Origin', async () => {
        const res = await request('/healthcheck', {
            host: `api.puter.localhost:${port}`,
        });
        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('advertises the WebDAV verbs and headers the clients need', async () => {
        const res = await request('/healthcheck', {
            host: `puter.localhost:${port}`,
        });
        const methods = String(
            res.headers['access-control-allow-methods'] ?? '',
        );
        expect(methods).toContain('PROPFIND');
        expect(methods).toContain('MKCOL');
        const headers = String(
            res.headers['access-control-allow-headers'] ?? '',
        );
        expect(headers).toContain('Authorization');
        expect(headers).toContain('Lock-Token');
        expect(res.headers['access-control-allow-private-network']).toBe(
            'true',
        );
    });

    it('pins X-Frame-Options on the main domain only', async () => {
        const main = await request('/healthcheck', {
            host: 'puter.localhost',
        });
        expect(main.headers['x-frame-options']).toBe('SAMEORIGIN');

        const api = await request('/healthcheck', {
            host: `api.puter.localhost:${port}`,
        });
        expect(api.headers['x-frame-options']).toBeUndefined();
    });

    it('blocks a request the ip.validate listeners veto', async () => {
        const handler = (_key: unknown, data: unknown) => {
            (data as { allow: boolean }).allow = false;
        };
        server.clients.event.on('ip.validate', handler as never);
        try {
            const res = await request('/healthcheck', {
                host: `puter.localhost:${port}`,
            });
            expect(res.status).toBe(403);
            expect(res.body).toBe('Forbidden');
        } finally {
            server.clients.event.off('ip.validate', handler as never);
        }
    });
});

describe('PuterServer host header validation — permissive modes', () => {
    let server: PuterServer;
    let port: number;

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${port}`,
                allow_all_host_values: false,
                allow_no_host_header: false,
                custom_domains_enabled: true,
                allow_nipio_domains: true,
            } as unknown as IConfig,
            { listen: true },
        );
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('lets an unknown host through when custom domains are enabled', async () => {
        const res = await rawRequest(port, '/', {
            host: 'my-own-domain.example',
        });
        expect(res.status).not.toBe(400);
    });

    it('accepts nip.io hosts when they are opted in', async () => {
        const res = await rawRequest(port, '/healthcheck', {
            host: '127-0-0-1.nip.io',
        });
        expect(res.status).toBe(200);
    });
});

/**
 * A route option is a declaration, so a malformed one has to be a boot failure
 * naming the route: the alternative is a gate that reads as "subscribers only"
 * to whoever edits the file next while admitting everybody. Extension routes
 * run through the same materializer as controller routes, which makes them the
 * cheap way to drive it.
 */
describe('PuterServer route option validation', () => {
    const noop = (() => undefined) as unknown as RequestHandler;

    afterEach(() => {
        extensionStore.routeHandlers.length = 0;
    });

    it('refuses to boot on a requireSubscription that names nothing', async () => {
        extensionStore.routeHandlers.push({
            method: 'get',
            path: '/plan-gated',
            options: { requireSubscription: [] },
            handler: noop,
        });

        await expect(setupTestServer()).rejects.toThrow(
            /route GET \/plan-gated: requireSubscription: expected at least one subscription id/,
        );
    });

    it('boots with the requirement switched off, and leaves the route open', async () => {
        extensionStore.routeHandlers.push({
            method: 'get',
            path: '/plan-open',
            options: { requireSubscription: false },
            handler: ((_req: Request, res: Response) =>
                res.json({ ok: true })) as unknown as RequestHandler,
        });

        const listenPort = await allocateEphemeralPort();
        const server = await setupTestServer(
            {
                port: listenPort,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${listenPort}`,
            } as unknown as IConfig,
            { listen: true },
        );
        try {
            // `false` declares nothing: no plan gate, and no auth gate
            // dragged in behind it.
            const res = await rawRequest(listenPort, '/plan-open', {
                host: 'puter.localhost',
            });
            expect(res.status).toBe(200);
        } finally {
            await server.shutdown();
        }
    });
});
