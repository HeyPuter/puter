import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PuterController } from '../types.js';
import type { PuterRouter } from '../../core/http/PuterRouter';

/**
 * Static asset routes.
 *
 *   /puter.js/v1, /puter.js/v2          → any subdomain
 *   /v1, /v2, /putility/v1              → js subdomain
 *   /sdk/*                              → root subdomain — puter-js bundle
 *   /dist/*, /src/*, /assets/*          → root subdomain
 *
 * Each block depends on its config root (`client_libs_root`,
 * `gui_assets_root`, `puterjs_root`). When unset, that block is skipped —
 * deployments that don't ship the libs or the GUI just don't get those
 * routes.
 */
export class StaticAssetsController extends PuterController {
    registerRoutes(router: PuterRouter) {
        if (this.config.client_libs_root) {
            const root = this.config.client_libs_root;

            router.get('/puter.js/v1', { subdomain: '*' }, (_req, res) => {
                res.sendFile('puter.js/v1.js', { root });
            });
            router.get('/puter.js/v2', { subdomain: '*' }, (_req, res) => {
                res.sendFile('puter.js/v2.js', { root });
            });

            router.get('/v1', { subdomain: 'js' }, (_req, res) => {
                res.sendFile('puter.js/v1.js', { root });
            });
            router.get('/v2', { subdomain: 'js' }, (_req, res) => {
                res.sendFile('puter.js/v2.js', { root });
            });
            router.get('/putility/v1', { subdomain: 'js' }, (_req, res) => {
                res.sendFile('putility.js/v1.js', { root });
            });
        }

        // puter-js SDK mount. GUI loads it at `/sdk/puter.dev.js`; the
        // webpack dev build writes that filename, but the OSS repo ships
        // `puter.js` (minified) as the built artifact. Fall back to
        // `puter.js` when `.dev.js` isn't present so `yarn start` works
        // out of the box without running the dev-mode webpack build.
        const puterjsRoot = this.config.puterjs_root;
        if (puterjsRoot) {
            const hasDev = existsSync(path.join(puterjsRoot, 'puter.dev.js'));
            if (!hasDev && existsSync(path.join(puterjsRoot, 'puter.js'))) {
                router.get(
                    '/sdk/puter.dev.js',
                    { subdomain: '' },
                    (_req, res) => {
                        res.sendFile('puter.js', { root: puterjsRoot });
                    },
                );
            }
            router.use('/sdk', { subdomain: '' }, express.static(puterjsRoot));

            // Third-party apps (dev-center, emulator, …) load puter-js via
            // `/puter.js/v{1,2}` — a self-contained single-file endpoint.
            // When `client_libs_root` is configured the block above already
            // owns these routes and wins by registration order; skip to
            // avoid a noisy double-mount.
            if (!this.config.client_libs_root) {
                const puterJsFile = hasDev ? 'puter.dev.js' : 'puter.js';
                router.get('/puter.js/v1', { subdomain: '*' }, (_req, res) => {
                    res.sendFile(puterJsFile, { root: puterjsRoot });
                });
                router.get('/puter.js/v2', { subdomain: '*' }, (_req, res) => {
                    res.sendFile(puterJsFile, { root: puterjsRoot });
                });
                // GUI bundle hard-codes `https://js.puter.com/v{1,2}` as the
                // script source in prod mode. Setups that route `js.puter.com`
                // to a self-hosted instance (DNS flip, host rewrite) need the
                // bare `/v1` and `/v2` paths on the `js` subdomain too — not
                // just the `/puter.js/*` prefix. Serve the same file.
                router.get('/v1', { subdomain: 'js' }, (_req, res) => {
                    res.sendFile(puterJsFile, { root: puterjsRoot });
                });
                router.get('/v2', { subdomain: 'js' }, (_req, res) => {
                    res.sendFile(puterJsFile, { root: puterjsRoot });
                });
            }
        }

        if (this.config.gui_assets_root) {
            const root = this.config.gui_assets_root;

            router.use(
                '/dist',
                { subdomain: '' },
                express.static(path.join(root, 'dist')),
            );
            router.use(
                '/src',
                { subdomain: '' },
                express.static(path.join(root, 'src')),
            );

            const publicDir = path.join(root, 'public');
            if (existsSync(publicDir)) {
                router.use(
                    '/assets',
                    { subdomain: '' },
                    express.static(publicDir),
                );
            }
        }

        // Built-in app mounts. The seed SQL ships apps with
        // `index_url: https://builtins.namespaces.puter.com/<name>`, and
        // `launch_app` rewrites that prefix to `${gui_origin}/builtin/<name>`.
        // Without these static mounts the iframe loads from our own origin
        // and hits the 404 handler. `builtin_apps` maps each wire name to
        // the directory we serve it from.
        const builtinApps = this.config.builtin_apps;
        if (builtinApps) {
            for (const [name, dirPath] of Object.entries(builtinApps)) {
                if (!dirPath || !existsSync(dirPath)) continue;
                router.use(
                    `/builtin/${name}`,
                    { subdomain: '' },
                    express.static(dirPath),
                );
            }
        }
    }
}
