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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import type { RouteDescriptor } from '../../core/http/types.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { StaticAssetsController } from './StaticAssetsController.js';

// ── Test harness ────────────────────────────────────────────────────
//
// StaticAssetsController is config-gated: each branch
// (`client_libs_root`, `puterjs_root`, `gui_assets_root`,
// `builtin_apps`) is enabled by setting that root + having the right
// files on disk. Tests boot one real PuterServer to wire up the
// clients/stores/services that controller construction expects, then
// instantiate StaticAssetsController with per-test config overrides
// and inspect the routes it registers onto a fresh PuterRouter.
//
// Real temp directories are seeded with the files each branch
// expects, so the controller's `fs.existsSync` calls see real state
// instead of a mocked module.

let server: PuterServer;
let tmpRoots: string[] = [];

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    tmpRoots = [];
});

afterEach(() => {
    for (const root of tmpRoots) {
        try {
            rmSync(root, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup.
        }
    }
});

const makeTempDir = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'puter-static-test-'));
    tmpRoots.push(dir);
    return dir;
};

const buildController = (configOverrides: Partial<IConfig> = {}) => {
    // Reuse the live wired clients/stores/services/drivers from the
    // booted test server — only the config differs per test.
    const controller = new StaticAssetsController(
        { ...configOverrides } as IConfig,
        server.clients,
        server.stores,
        server.services,
        server.drivers,
    );
    const router = new PuterRouter();
    controller.registerRoutes(router);
    return router;
};

const findRoute = (
    router: PuterRouter,
    method: string,
    routePath: string,
): RouteDescriptor | undefined =>
    router.routes.find((r) => r.method === method && r.path === routePath);

const findUseRoute = (
    router: PuterRouter,
    routePath: string,
): RouteDescriptor | undefined =>
    router.routes.find((r) => r.method === 'use' && r.path === routePath);

const callGetHandler = async (
    router: PuterRouter,
    routePath: string,
): Promise<{ filename?: string; root?: string }> => {
    const route = findRoute(router, 'get', routePath);
    if (!route) throw new Error(`No GET ${routePath} registered`);
    let captured: { filename?: string; root?: string } = {};
    const req = {} as Request;
    const res = {
        sendFile: vi.fn((filename: string, opts: { root: string }) => {
            captured = { filename, root: opts.root };
        }),
    } as unknown as Response;
    await route.handler(req, res, () => {
        throw new Error('handler called next() unexpectedly');
    });
    return captured;
};

// ── client_libs_root ────────────────────────────────────────────────

describe('StaticAssetsController client_libs_root', () => {
    it('registers /puter.js/v1, /v2, /putility/v1 on the right subdomains', async () => {
        const root = makeTempDir();
        const router = buildController({ client_libs_root: root });

        const v1Wild = findRoute(router, 'get', '/puter.js/v1');
        const v2Wild = findRoute(router, 'get', '/puter.js/v2');
        const v1Js = findRoute(router, 'get', '/v1');
        const v2Js = findRoute(router, 'get', '/v2');
        const putilityJs = findRoute(router, 'get', '/putility/v1');

        // /puter.js/* routes are wildcard-subdomain (any host).
        expect(v1Wild?.options.subdomain).toBe('*');
        expect(v2Wild?.options.subdomain).toBe('*');
        // Bare-version routes live on the `js` subdomain.
        expect(v1Js?.options.subdomain).toBe('js');
        expect(v2Js?.options.subdomain).toBe('js');
        expect(putilityJs?.options.subdomain).toBe('js');

        // The handler should hand off the right relative file path.
        const sent = await callGetHandler(router, '/puter.js/v1');
        expect(sent).toEqual({ filename: 'puter.js/v1.js', root });

        const sent2 = await callGetHandler(router, '/v2');
        expect(sent2).toEqual({ filename: 'puter.js/v2.js', root });

        const sentPutility = await callGetHandler(router, '/putility/v1');
        expect(sentPutility).toEqual({ filename: 'putility.js/v1.js', root });
    });

    it('does not register the client_libs routes when the root is unset', () => {
        const router = buildController({});
        expect(findRoute(router, 'get', '/puter.js/v1')).toBeUndefined();
        expect(findRoute(router, 'get', '/v1')).toBeUndefined();
        expect(findRoute(router, 'get', '/putility/v1')).toBeUndefined();
    });
});

// ── puterjs_root ────────────────────────────────────────────────────

describe('StaticAssetsController puterjs_root', () => {
    it('serves puter.js when puter.dev.js is missing (OSS-built repo)', async () => {
        const root = makeTempDir();
        // OSS repo ships only puter.js — no puter.dev.js artifact.
        writeFileSync(path.join(root, 'puter.js'), '/* mock */');
        const router = buildController({ puterjs_root: root });

        // `/sdk/puter.dev.js` aliases to puter.js in this configuration.
        const aliased = await callGetHandler(router, '/sdk/puter.dev.js');
        expect(aliased.filename).toBe('puter.js');
        expect(aliased.root).toBe(root);

        // /sdk static mount must be registered on the empty subdomain.
        const sdkUse = findUseRoute(router, '/sdk');
        expect(sdkUse?.options.subdomain).toBe('');

        // Without client_libs_root, /puter.js/v1 / /v1 routes also point
        // at puterjs_root and serve puter.js.
        const v1 = await callGetHandler(router, '/puter.js/v1');
        expect(v1.filename).toBe('puter.js');
        expect(v1.root).toBe(root);
        const bareV1 = await callGetHandler(router, '/v1');
        expect(bareV1.filename).toBe('puter.js');
    });

    it('serves puter.dev.js when present (dev webpack build)', async () => {
        const root = makeTempDir();
        writeFileSync(path.join(root, 'puter.dev.js'), '/* dev */');
        // puter.js may also exist; presence of dev wins.
        writeFileSync(path.join(root, 'puter.js'), '/* prod */');
        const router = buildController({ puterjs_root: root });

        const v1 = await callGetHandler(router, '/puter.js/v1');
        expect(v1.filename).toBe('puter.dev.js');

        // The /sdk/puter.dev.js alias is NOT registered in this case
        // because express.static below it serves the file natively.
        const aliasRoute = findRoute(router, 'get', '/sdk/puter.dev.js');
        expect(aliasRoute).toBeUndefined();
    });

    it('skips bare /v1, /v2, /puter.js/* when client_libs_root is also set', async () => {
        const libRoot = makeTempDir();
        const sdkRoot = makeTempDir();
        writeFileSync(path.join(sdkRoot, 'puter.js'), '/* mock */');
        const router = buildController({
            client_libs_root: libRoot,
            puterjs_root: sdkRoot,
        });
        // The /puter.js/v1 handler routes through client_libs_root
        // (registered first; PuterRouter is order-preserving). Verify
        // by confirming the file the handler resolves comes from libRoot.
        const sent = await callGetHandler(router, '/puter.js/v1');
        expect(sent.root).toBe(libRoot);
        // The /sdk mount should still be present from puterjs_root.
        expect(findUseRoute(router, '/sdk')).toBeDefined();
    });

    it('does not register /sdk when puterjs_root is unset', () => {
        const router = buildController({});
        expect(findUseRoute(router, '/sdk')).toBeUndefined();
    });
});

// ── gui_assets_root ─────────────────────────────────────────────────

describe('StaticAssetsController gui_assets_root', () => {
    it('mounts /dist and /src on the empty subdomain', () => {
        const root = makeTempDir();
        // /assets requires public/ to also exist; create only dist+src here.
        mkdirSync(path.join(root, 'dist'));
        mkdirSync(path.join(root, 'src'));
        const router = buildController({ gui_assets_root: root });

        const distMount = findUseRoute(router, '/dist');
        const srcMount = findUseRoute(router, '/src');
        expect(distMount?.options.subdomain).toBe('');
        expect(srcMount?.options.subdomain).toBe('');
    });

    it('mounts /assets only when public/ exists', () => {
        const root = makeTempDir();
        mkdirSync(path.join(root, 'dist'));
        mkdirSync(path.join(root, 'src'));
        // No public/ → /assets should NOT be registered.
        const router = buildController({ gui_assets_root: root });
        expect(findUseRoute(router, '/assets')).toBeUndefined();
    });

    it('mounts /assets when public/ exists', () => {
        const root = makeTempDir();
        mkdirSync(path.join(root, 'dist'));
        mkdirSync(path.join(root, 'src'));
        mkdirSync(path.join(root, 'public'));
        const router = buildController({ gui_assets_root: root });
        const assetsMount = findUseRoute(router, '/assets');
        expect(assetsMount?.options.subdomain).toBe('');
    });
});

// ── builtin_apps ────────────────────────────────────────────────────

describe('StaticAssetsController builtin_apps', () => {
    it('registers a /builtin/<name> mount per existing dir', () => {
        const editorRoot = makeTempDir();
        const browserRoot = makeTempDir();
        const router = buildController({
            builtin_apps: {
                editor: editorRoot,
                browser: browserRoot,
            } as unknown as IConfig['builtin_apps'],
        });

        expect(findUseRoute(router, '/builtin/editor')).toBeDefined();
        expect(findUseRoute(router, '/builtin/browser')).toBeDefined();
    });

    it('skips entries whose dirPath is empty / nonexistent', () => {
        const realRoot = makeTempDir();
        const router = buildController({
            builtin_apps: {
                editor: realRoot,
                missing: '/nonexistent/path',
                empty: '',
            } as unknown as IConfig['builtin_apps'],
        });

        expect(findUseRoute(router, '/builtin/editor')).toBeDefined();
        expect(findUseRoute(router, '/builtin/missing')).toBeUndefined();
        expect(findUseRoute(router, '/builtin/empty')).toBeUndefined();
    });

    it('does not register any /builtin mounts when builtin_apps is undefined', () => {
        const router = buildController({});
        for (const route of router.routes) {
            expect(route.path).not.toMatch(/^\/builtin\//);
        }
    });
});

// ── No-config (everything off) ──────────────────────────────────────

describe('StaticAssetsController with no roots configured', () => {
    it('registers no routes', () => {
        const router = buildController({});
        expect(router.routes).toHaveLength(0);
    });
});
