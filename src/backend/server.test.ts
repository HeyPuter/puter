/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import http from 'node:http';
import net from 'node:net';
import type { Request, RequestHandler, Response } from 'express';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { Controller, Get } from './core/http/decorators.ts';
import { HttpError } from './core/http/HttpError.ts';
import { extension, extensionStore } from './extensions.ts';
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
    method = 'GET',
    body?: string,
): Promise<RawResponse> =>
    new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port, path, method, headers },
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
        req.end(body);
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

    const request = (
        path: string,
        headers: Record<string, string> = {},
        method = 'GET',
    ) => rawRequest(port, path, headers, method);

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

    it('lets the dav subdomain answer its own OPTIONS', async () => {
        // A DAV client opens a mount with OPTIONS and reads `DAV:` to decide
        // the host speaks WebDAV at all. The blanket preflight reply is a bare
        // 200 with no such header, which makes macOS abandon the mount before
        // it ever sends credentials — so this request has to reach the
        // controller instead.
        const res = await request(
            '/some-user',
            { host: `dav.puter.localhost:${port}` },
            'OPTIONS',
        );
        expect(res.headers['dav']).toContain('1');
        expect(res.headers['dav']).toContain('2');
    });

    // The DAV controller declares one route per verb, so these check what only
    // a real server can: that express materializes the WebDAV verbs, that the
    // catch-all matches the root collection as well as deep paths, and that it
    // stays on the `dav` subdomain.
    it('routes every WebDAV verb on the dav subdomain, root included', async () => {
        const dav = { host: `dav.puter.localhost:${port}` };
        for (const [method, path] of [
            ['PROPFIND', '/'],
            ['PROPFIND', '/some-user/Documents'],
            ['PROPPATCH', '/some-user/a.txt'],
            ['MKCOL', '/some-user/new-folder'],
            ['LOCK', '/some-user/a.txt'],
            // Not a verb the controller implements; the catch-all that answers
            // 405 has to authenticate first, like every other route.
            ['SEARCH', '/some-user'],
        ] as const) {
            const res = await request(path, dav, method);
            // Unauthenticated, so the reply is the auth challenge — what
            // matters is that it came from the DAV controller and not from the
            // 404 handler.
            expect(res.status, `${method} ${path}`).toBe(401);
            expect(res.headers['www-authenticate']).toContain('Basic');
        }
    });

    it('leaves WebDAV verbs on other hosts alone', async () => {
        // The DAV catch-all matches any path, so the subdomain gate is the only
        // thing keeping it off the main domain.
        const res = await request(
            '/',
            { host: `puter.localhost:${port}` },
            'PROPFIND',
        );
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(405);
        expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it('answers a browser CORS preflight on the dav subdomain', async () => {
        // Browsers send this credential-less probe before any cross-origin DAV
        // verb and abandon the request unless it comes back 2xx.
        const res = await request(
            '/some-user/.vscode/settings.json',
            {
                host: `dav.puter.localhost:${port}`,
                origin: 'https://code.puter.localhost',
                'access-control-request-method': 'PROPFIND',
                'access-control-request-headers': 'authorization,depth',
            },
            'OPTIONS',
        );
        expect(res.status).toBe(200);
        expect(res.headers['dav']).toContain('1');
        expect(res.headers['access-control-max-age']).toBe('86400');
        expect(String(res.headers['access-control-allow-headers'])).toContain(
            'Depth',
        );
        expect(res.headers['access-control-allow-origin']).toBe(
            'https://code.puter.localhost',
        );
        // A browser client reads ETags and lock tokens off the reply, so they
        // have to be exposed to it.
        expect(String(res.headers['access-control-expose-headers'])).toContain(
            'ETag',
        );
    });

    it('still short-circuits OPTIONS preflight off the dav subdomain', async () => {
        const res = await request(
            '/some-path',
            { host: `api.puter.localhost:${port}` },
            'OPTIONS',
        );
        expect(res.status).toBe(200);
        expect(res.headers['dav']).toBeUndefined();
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

/**
 * Express reads subdomains relative to a fixed label count, so a root domain
 * deeper than two labels is the case that breaks: `puter` reads as an active
 * subdomain of the root origin itself, which bounces every root request into
 * the user-subdomain 404.
 */
describe('PuterServer subdomain routing on a multi-label root domain', () => {
    let server: PuterServer;
    let port: number;

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.example.localhost',
                origin: `http://puter.example.localhost:${port}`,
                api_base_url: `http://api.puter.example.localhost:${port}`,
                static_hosting_domain: 'site.puter.example.localhost',
                static_hosting_domain_alt: 'host.puter.example.localhost',
                private_app_hosting_domain: 'app.puter.example.localhost',
                private_app_hosting_domain_alt: 'dev.puter.example.localhost',
            } as unknown as IConfig,
            { listen: true },
        );
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // Host headers here carry no port: the gate under test compares the
    // host against `domain`, which is how it arrives from a proxy in practice.
    it('serves the root origin instead of treating it as a user subdomain', async () => {
        const res = await rawRequest(port, '/', {
            host: 'puter.example.localhost',
        });
        expect(res.status).not.toBe(404);
        expect(res.headers.location).toBeUndefined();
    });

    it('still 404s a user subdomain of that domain', async () => {
        const res = await rawRequest(port, '/some/path', {
            host: 'alice.puter.example.localhost',
        });
        expect(res.status).toBe(404);
        expect(res.headers.location).toBeUndefined();
    });

    it('still recognizes reserved subdomains of that domain', async () => {
        const res = await rawRequest(port, '/healthcheck', {
            host: 'api.puter.example.localhost',
            origin: 'https://third-party.example',
        });
        expect(res.headers.location).toBeUndefined();
        expect(res.headers['access-control-allow-credentials']).toBe('true');
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
 * A claimed subdomain answers where an unclaimed one 404s, ahead of everything
 * after that point in the global stack, and only past its `authorize`. Driven
 * end to end because the blanket OPTIONS responder, CORS and `subdomain: '*'`
 * routes only exist on the app.
 */
describe('PuterServer claimed subdomains', () => {
    let server: PuterServer;
    let port: number;
    const seen: string[] = [];

    // Everything except what varies per connection or per second.
    const comparable = (res: RawResponse) => {
        const headers = { ...res.headers };
        delete headers.date;
        delete headers.connection;
        delete headers['keep-alive'];
        return { status: res.status, headers, body: res.body };
    };

    @Controller('/ctl')
    class ClaimTestController {
        @Get('/hello', { subdomain: 'claimtest' })
        hello(_req: Request, res: Response) {
            res.send('from controller');
        }

        @Get('/teapot', { subdomain: 'claimtest' })
        teapot() {
            throw new HttpError(418, 'Short and stout');
        }
    }

    const routeCount = { before: 0 };

    beforeAll(async () => {
        extension.claimSubdomain('claimtest', {
            authorize: (req) => {
                seen.push(`${req.method} ${req.path}`);
                if (req.headers['x-test'] === 'deny') return false;
                if (req.headers['x-test'] === 'crash') {
                    throw new Error('store down');
                }
                if (req.headers['x-test'] === 'forbid') {
                    throw new HttpError(403, 'Not you');
                }
                return true;
            },
        });
        extension.registerController('claimTest', ClaimTestController as never);
        routeCount.before = extensionStore.routeHandlers.length;
        extension.get(
            '/hello',
            { subdomain: 'claimtest' },
            (_req: Request, res: Response) => {
                res.send('from extension');
            },
        );
        extension.get('/everywhere', { subdomain: '*' }, (_req, res) => {
            res.send('everywhere');
        });
        extension.get('/hello', (_req: Request, res: Response) => {
            res.send('root hello');
        });
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${port}`,
                static_hosting_domain: 'site.puter.localhost',
            } as unknown as IConfig,
            { listen: true },
        );
    });

    afterAll(async () => {
        extensionStore.claimedSubdomains.delete('claimtest');
        delete (extensionStore.controllers as Record<string, unknown>)
            .claimTest;
        extensionStore.routeHandlers.length = routeCount.before;
        await server?.shutdown();
    });

    afterEach(() => {
        seen.length = 0;
    });

    const claimed = (
        path: string,
        headers: Record<string, string> = {},
        method = 'GET',
    ) =>
        rawRequest(
            port,
            path,
            { ...headers, host: 'claimtest.puter.localhost' },
            method,
        );

    const expectHidden = async (
        path: string,
        headers: Record<string, string> = {},
        method = 'GET',
    ) => {
        const res = await claimed(path, headers, method);
        const unclaimed = await rawRequest(
            port,
            path,
            { ...headers, host: 'unclaimed.puter.localhost' },
            method,
        );
        expect(res.status).toBe(404);
        expect(comparable(res)).toEqual(comparable(unclaimed));
    };

    it('serves decorated and extension routes once authorized, before CORS', async () => {
        const fromController = await claimed('/ctl/hello', {
            origin: 'https://elsewhere.example',
        });
        expect(fromController.status).toBe(200);
        expect(fromController.body).toBe('from controller');
        expect(
            fromController.headers['access-control-allow-origin'],
        ).toBeUndefined();

        const fromExtension = await claimed('/hello');
        expect(fromExtension.body).toBe('from extension');
        expect(seen).toEqual(['GET /ctl/hello', 'GET /hello']);
    });

    it('answers an unauthorized request exactly like an unclaimed subdomain', async () => {
        for (const path of ['/hello', '/ctl/hello', '/', '/healthcheck']) {
            await expectHidden(path, { 'x-test': 'deny' });
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await expectHidden('/hello', { 'x-test': 'crash' });
        } finally {
            warn.mockRestore();
        }
    });

    it('sends an HttpError from authorize through the error handler', async () => {
        const res = await claimed('/hello', { 'x-test': 'forbid' });
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body)).toMatchObject({ message: 'Not you' });
    });

    it("never serves the main app's routes, even when authorized", async () => {
        for (const path of [
            '/everywhere',
            '/healthcheck',
            '/version',
            '/nope',
        ]) {
            await expectHidden(path);
        }
        expect(seen).toContain('GET /everywhere');
        const elsewhere = await rawRequest(port, '/everywhere', {
            host: 'puter.localhost',
        });
        expect(elsewhere.body).toBe('everywhere');
    });

    it("keeps the claim's routes off every other host", async () => {
        const root = await rawRequest(port, '/hello', {
            host: 'puter.localhost',
        });
        expect(root.body).toBe('root hello');
        for (const host of [
            'api.puter.localhost',
            'unclaimed.puter.localhost',
        ]) {
            for (const path of ['/hello', '/ctl/hello']) {
                const res = await rawRequest(port, path, { host });
                expect(res.status, `${host}${path}`).toBe(404);
            }
        }
        const rootController = await rawRequest(port, '/ctl/hello', {
            host: 'puter.localhost',
        });
        expect(rootController.body).not.toBe('from controller');
    });

    it('routes OPTIONS through authorize instead of the blanket 200', async () => {
        await expectHidden('/hello', { 'x-test': 'deny' }, 'OPTIONS');
        const res = await claimed('/hello', {}, 'OPTIONS');
        expect(res.headers.allow).toBe('GET, HEAD');
        expect(seen).toContain('OPTIONS /hello');
    });

    it("sends a route's error through the error handler", async () => {
        const res = await claimed('/ctl/teapot');
        expect(res.status).toBe(418);
        expect(JSON.parse(res.body)).toMatchObject({
            message: 'Short and stout',
        });
    });

    it('treats a host carrying a port like the same host without one', async () => {
        const ported = await rawRequest(port, '/hello', {
            host: `claimtest.puter.localhost:${port}`,
        });
        expect(ported.body).toBe('from extension');

        const unclaimed = await rawRequest(port, '/healthcheck', {
            host: `unclaimed.puter.localhost:${port}`,
        });
        expect(unclaimed.status).toBe(404);
        expect(
            unclaimed.headers['access-control-allow-origin'],
        ).toBeUndefined();
    });

    it('leaves a deeper host under the claimed label alone', async () => {
        const res = await rawRequest(port, '/hello', {
            host: 'claimtest.x.puter.localhost',
        });
        const unclaimed = await rawRequest(port, '/hello', {
            host: 'unclaimed.x.puter.localhost',
        });
        expect(seen).toEqual([]);
        expect(comparable(res)).toEqual(comparable(unclaimed));
    });
});

describe('PuterServer claimed subdomain route options', () => {
    const noop = ((_req: Request, res: Response) =>
        res.end()) as unknown as RequestHandler;

    beforeEach(() => {
        extension.claimSubdomain('bootcheck', { authorize: () => true });
    });

    afterEach(() => {
        extensionStore.claimedSubdomains.delete('bootcheck');
        extensionStore.routeHandlers.length = 0;
    });

    it('refuses options that need the main pipeline', async () => {
        for (const [option, value] of [
            ['requireAuth', true],
            ['requireUserActor', true],
            ['allowAccessToken', true],
            ['guiOriginOnly', true],
            ['antiCsrf', true],
            ['captcha', true],
            ['requireCredits', true],
            ['requireVerified', true],
            ['noUserSession', true],
        ] as const) {
            extensionStore.routeHandlers.length = 0;
            extensionStore.routeHandlers.push({
                method: 'get',
                path: '/gated',
                options: { subdomain: 'bootcheck', [option]: value },
                handler: noop,
            });
            await expect(setupTestServer()).rejects.toThrow(
                `route GET /gated: '${option}' is not available on a claimed subdomain`,
            );
        }
    });

    it('hands each claimed route to checkRoute and fails the boot when it throws', async () => {
        const seenRoutes: string[] = [];
        extensionStore.claimedSubdomains.delete('bootcheck');
        extension.claimSubdomain('bootcheck', {
            authorize: () => true,
            checkRoute: (options, label) => {
                seenRoutes.push(`${label} ${String(options.subdomain)}`);
                if (!options.middleware?.length) {
                    throw new Error('needs a gate');
                }
            },
        });
        extensionStore.routeHandlers.push({
            method: 'get',
            path: '/gated',
            options: {
                subdomain: 'bootcheck',
                middleware: [(_req, _res, next) => next()],
            },
            handler: noop,
        });
        const server = await setupTestServer();
        await server.shutdown();
        expect(seenRoutes).toEqual(['route GET /gated bootcheck']);

        extensionStore.routeHandlers.push({
            method: 'get',
            path: '/open',
            options: { subdomain: 'bootcheck' },
            handler: noop,
        });
        await expect(setupTestServer()).rejects.toThrow(
            'route GET /open: needs a gate',
        );
    });

    it('refuses a claimed label written in another case', async () => {
        for (const subdomain of ['BootCheck', ['api', 'BOOTCHECK']]) {
            extensionStore.routeHandlers.length = 0;
            extensionStore.routeHandlers.push({
                method: 'get',
                path: '/cased',
                options: { subdomain },
                handler: noop,
            });
            await expect(setupTestServer()).rejects.toThrow(
                "route GET /cased: claimed subdomain 'bootcheck' must be written in lowercase",
            );
        }
    });

    it('refuses a claimed subdomain mixed with others', async () => {
        extensionStore.routeHandlers.push({
            method: 'get',
            path: '/mixed',
            options: { subdomain: ['bootcheck', 'api'] },
            handler: noop,
        });
        await expect(setupTestServer()).rejects.toThrow(
            /route GET \/mixed: claimed subdomain 'bootcheck' must be the route's only subdomain/,
        );
    });

    it('refuses limits keyed on anything but the IP', async () => {
        for (const options of [
            { rateLimit: { limit: 1, window: 1000 } },
            { rateLimit: { limit: 1, window: 1000, key: 'user' as const } },
            { concurrent: { limit: 1, key: 'fingerprint' as const } },
        ]) {
            extensionStore.routeHandlers.length = 0;
            extensionStore.routeHandlers.push({
                method: 'get',
                path: '/limited',
                options: { subdomain: 'bootcheck', ...options },
                handler: noop,
            });
            await expect(setupTestServer()).rejects.toThrow(
                /limits on a claimed subdomain must key on 'ip'/,
            );
        }
    });

    it('boots with the options a claimed host supports', async () => {
        extensionStore.routeHandlers.push({
            method: 'post',
            path: '/fine',
            options: {
                subdomain: 'bootcheck',
                bodyJson: { limit: '1kb' },
                rateLimit: { limit: 5, window: 1000, key: 'ip' },
                concurrent: { limit: 2, key: 'ip' },
                middleware: [(_req, _res, next) => next()],
                requireAuth: false,
            },
            handler: noop,
        });
        const server = await setupTestServer();
        await server.shutdown();
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

    it('refuses to boot on a requireReputation that names no tier', async () => {
        extensionStore.routeHandlers.push({
            method: 'get',
            path: '/reputation-gated',
            options: { requireReputation: '  ' },
            handler: noop,
        });

        await expect(setupTestServer()).rejects.toThrow(
            /route GET \/reputation-gated: requireReputation: expected a non-empty tier name/,
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

/**
 * Dedup and repeat throttling mean a responder sees only an alarm's latest
 * occurrence, so what a thrower attached in `fields` has to travel with each
 * one — and a plain Error has to keep raising the same alarm without it.
 */
describe('PuterServer HTTP alarm gate', () => {
    let server: PuterServer;
    let port: number;

    const attempts = [
        { model: 'm', provider: 'a', error: 'boom' },
        { model: 'm', provider: 'b', status: 502, error: 'bad gateway' },
    ];

    beforeAll(async () => {
        extensionStore.routeHandlers.push(
            {
                method: 'get',
                path: '/explode',
                options: {},
                handler: (() => {
                    throw new HttpError(500, 'All providers failed', {
                        legacyCode: 'internal_error',
                        // Same names as the gate's own fields, which must
                        // stay the HTTP status and the thrown error.
                        fields: { attempts, status: 'theirs', error: 'theirs' },
                    });
                }) as unknown as RequestHandler,
            },
            {
                method: 'post',
                path: '/explode-with-secrets',
                options: {},
                handler: (() => {
                    throw new Error('kaboom');
                }) as unknown as RequestHandler,
            },
            {
                method: 'get',
                path: '/plain',
                options: {},
                handler: (() => {
                    throw new Error('kaboom');
                }) as unknown as RequestHandler,
            },
            {
                method: 'get',
                path: '/credits-exhausted',
                options: {},
                handler: (() => {
                    throw new HttpError(503, 'AI provider out of credits', {
                        legacyCode: 'upstream_credits_exhausted',
                        fields: {
                            attempts: [
                                {
                                    model: 'm',
                                    provider: 'a',
                                    status: 402,
                                    error: 'Insufficient credits.',
                                },
                            ],
                        },
                    });
                }) as unknown as RequestHandler,
            },
        );
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                domain: 'puter.localhost',
                origin: `http://puter.localhost:${port}`,
            } as unknown as IConfig,
            { listen: true },
        );
    });

    afterAll(async () => {
        extensionStore.routeHandlers.length = 0;
        await server?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const raisedFor = async (path: string, status = 500) => {
        const alarm = vi
            .spyOn(server.clients.alarm, 'create')
            .mockImplementation(() => undefined);
        const res = await rawRequest(port, path, { host: 'puter.localhost' });
        expect(res.status).toBe(status);
        const raised = alarm.mock.calls.find((c) =>
            String(c[0]).startsWith(`http_${status}:GET:${path}:`),
        );
        expect(raised).toBeTruthy();
        return {
            id: raised![0] as string,
            fields: raised![2] as Record<string, unknown>,
            severity: raised![3] as string,
        };
    };

    it("attaches an HttpError's fields as `details` without touching its own", async () => {
        const { id, fields } = await raisedFor('/explode');
        expect(id).toBe(
            'http_500:GET:/explode:internal_error:All providers failed',
        );
        expect(fields.details).toEqual({
            attempts,
            status: 'theirs',
            error: 'theirs',
        });
        expect(fields.status).toBe(500);
        expect(fields.error).toBeInstanceOf(HttpError);
    });

    it('raises the same alarm for a plain Error, with no details', async () => {
        const { id, fields } = await raisedFor('/plain');
        expect(id).toBe('http_500:GET:/plain:kaboom');
        expect(fields.status).toBe(500);
        expect(fields.error).toBeInstanceOf(Error);
        expect(fields).not.toHaveProperty('details');
    });

    it('keeps request body values, query values and the user row out of the alarm', async () => {
        const alarm = vi
            .spyOn(server.clients.alarm, 'create')
            .mockImplementation(() => undefined);
        const res = await rawRequest(
            port,
            '/explode-with-secrets?auth_token=query-secret',
            { host: 'puter.localhost', 'content-type': 'application/json' },
            'POST',
            JSON.stringify({ username: 'u', password: 'body-secret' }),
        );
        expect(res.status).toBe(500);
        const raised = alarm.mock.calls.find((c) =>
            String(c[0]).startsWith('http_500:POST:/explode-with-secrets:'),
        );
        expect(raised).toBeTruthy();
        const [, message, fields] = raised! as unknown as [
            string,
            string,
            Record<string, unknown>,
        ];
        const { error: _error, ...rest } = fields;
        const serialized = `${message} ${JSON.stringify(rest)}`;
        expect(serialized).not.toContain('body-secret');
        expect(serialized).not.toContain('query-secret');
        expect(fields).not.toHaveProperty('body');
        expect(fields.path).toBe('/explode-with-secrets');
        expect(fields.bodyKeys).toEqual(['username', 'password']);
        expect(fields.queryKeys).toEqual(['auth_token']);
    });

    it('raises a warning when an upstream account is out of credits', async () => {
        const { id, fields, severity } = await raisedFor(
            '/credits-exhausted',
            503,
        );
        expect(id).toBe(
            'http_503:GET:/credits-exhausted:upstream_credits_exhausted:AI provider out of credits',
        );
        expect(severity).toBe('warning');
        expect(fields.details).toEqual({
            attempts: [
                {
                    model: 'm',
                    provider: 'a',
                    status: 402,
                    error: 'Insufficient credits.',
                },
            ],
        });
    });
});

/**
 * A proxy in front pools upstream connections, so this server closing an idle
 * one first surfaces as a 502 to its clients. Run with a short timeout so the
 * close is observable; what matters is that the configured value reaches the
 * socket at all.
 */
describe('PuterServer keep-alive timeout', () => {
    let server: PuterServer;
    let port: number;

    beforeAll(async () => {
        port = await allocateEphemeralPort();
        server = await setupTestServer(
            { port, keep_alive_timeout: 300 } as unknown as IConfig,
            { listen: true },
        );
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('closes an idle keep-alive connection at the configured timeout', async () => {
        const socket = net.connect(port, '127.0.0.1');
        await new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('error', reject);
        });
        socket.write(
            'GET /healthcheck HTTP/1.1\r\nHost: puter.localhost\r\n\r\n',
        );
        await new Promise<void>((resolve) => socket.once('data', resolve));

        let timer: NodeJS.Timeout;
        const closed = await Promise.race([
            new Promise<boolean>((resolve) =>
                socket.once('close', () => resolve(true)),
            ),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), 3000);
            }),
        ]);
        clearTimeout(timer!);
        socket.destroy();
        expect(closed).toBe(true);
    });
});

describe('PuterServer lifecycle hooks', () => {
    it('runs prepare-shutdown bottom-up, once, before tearing down', async () => {
        const port = await allocateEphemeralPort();
        const server = await setupTestServer({ port } as unknown as IConfig, {
            listen: true,
        });

        const order: string[] = [];
        const probe = (label: string) => ({
            onServerPrepareShutdown: () => {
                order.push(`prepare:${label}`);
            },
            onServerShutdown: () => {
                order.push(`shutdown:${label}`);
            },
        });
        for (const [layer, label] of [
            [server.clients, 'client'],
            [server.stores, 'store'],
            [server.services, 'service'],
            [server.controllers, 'controller'],
            [server.drivers, 'driver'],
        ] as const) {
            (layer as Record<string, unknown>).hookOrderProbe = probe(label);
        }

        await server.prepareShutdown();
        await server.shutdown();

        expect(order).toEqual([
            'prepare:client',
            'prepare:store',
            'prepare:service',
            'prepare:controller',
            'prepare:driver',
            'shutdown:driver',
            'shutdown:controller',
            'shutdown:service',
            'shutdown:store',
            'shutdown:client',
        ]);
    });
});

/**
 * Each layer's `onServerShutdown` has to run while the layers beneath it (the
 * ones it writes through) are still up, so teardown goes top-down: drivers,
 * controllers, services, stores, clients — the reverse of construction order.
 */
describe('PuterServer shutdown order', () => {
    it('tears layers down top-down: drivers, controllers, services, stores, clients', async () => {
        const port = await allocateEphemeralPort();
        const server = await setupTestServer({ port } as unknown as IConfig, {
            listen: true,
        });

        const order: string[] = [];
        const probe = (label: string) => ({
            onServerShutdown: () => {
                order.push(label);
            },
        });
        (server.drivers as Record<string, unknown>).shutdownOrderProbe =
            probe('driver');
        (server.controllers as Record<string, unknown>).shutdownOrderProbe =
            probe('controller');
        (server.services as Record<string, unknown>).shutdownOrderProbe =
            probe('service');
        (server.stores as Record<string, unknown>).shutdownOrderProbe =
            probe('store');
        (server.clients as Record<string, unknown>).shutdownOrderProbe =
            probe('client');

        await server.shutdown();

        expect(order).toEqual([
            'driver',
            'controller',
            'service',
            'store',
            'client',
        ]);
    });

    // close() only drops connections idle at that moment; one mid-request
    // stays open until PuterServer severs it after the prepare hooks.
    it('finishes while a connection is mid-request', async () => {
        const port = await allocateEphemeralPort();
        const server = await setupTestServer({ port } as unknown as IConfig, {
            listen: true,
        });

        const socket = net.connect(port, '127.0.0.1');
        socket.on('error', () => {});
        await new Promise<void>((resolve) => socket.once('connect', resolve));
        socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n');
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
            await server.shutdown();
        } finally {
            socket.destroy();
        }
    }, 15_000);
});
