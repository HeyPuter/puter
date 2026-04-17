import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PuterController } from '../types.js';
import type { PuterRouter } from '../../core/http/PuterRouter';

/**
 * Static asset routes lifted out of v1's routers/_default.js catch-all.
 *
 *   /puter.js/v1, /puter.js/v2          → any subdomain
 *   /v1, /v2, /putility/v1              → js subdomain
 *   /dist/*, /src/*, /assets/*          → root subdomain
 *
 * Each block depends on its config root (`client_libs_root`,
 * `gui_assets_root`). When unset, that block is skipped — deployments that
 * don't ship the libs or the GUI just don't get those routes.
 */
export class StaticAssetsController extends PuterController {

    registerRoutes (router: PuterRouter) {
        if ( this.config.client_libs_root ) {
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

        if ( this.config.gui_assets_root ) {
            const root = this.config.gui_assets_root;

            router.use('/dist', { subdomain: '' }, express.static(path.join(root, 'dist')));
            router.use('/src', { subdomain: '' }, express.static(path.join(root, 'src')));

            const publicDir = path.join(root, 'public');
            if ( existsSync(publicDir) ) {
                router.use('/assets', { subdomain: '' }, express.static(publicDir));
            }
        }
    }
}
