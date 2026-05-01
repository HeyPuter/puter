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

import express from 'express';
import path from 'node:path';
import { PuterController } from '../types.js';
import type { PuterRouter } from '../../core/http/PuterRouter';
import type {
    PuterHomepageService,
    PageMeta,
    LaunchOptions,
} from '../../services/homepage/PuterHomepageService';

/**
 * Routes that render the Puter GUI shell, plus a catch-all static fallback
 * under `<gui_assets_root>/src` for non-dist/src paths (images, fonts, lib
 * files referenced from the shell).
 *
 * All root-subdomain-only. Registered last in the controller list so the
 * static catch-all doesn't shadow specific API routes.
 */
export class HomepageController extends PuterController {
    registerRoutes(router: PuterRouter) {
        const homepage = this.services
            .homepage as unknown as PuterHomepageService;
        if (!homepage) return;

        const defaultMeta = (req: express.Request): PageMeta => ({
            title: String(this.config.gui_params?.title ?? 'Puter'),
            description: String(
                this.config.gui_params?.short_description ?? '',
            ),
            short_description: String(
                this.config.gui_params?.short_description ?? '',
            ),
            company: 'Puter Technologies Inc.',
            canonical_url: `${req.protocol}://${this.config.domain ?? req.hostname}${req.path}`,
            social_media_image: String(
                this.config.gui_params?.social_media_image ?? '',
            ),
        });

        const sendShell = async (
            req: express.Request,
            res: express.Response,
            metaOverrides: Partial<PageMeta> = {},
            launch: LaunchOptions = {},
        ) => {
            const meta = { ...defaultMeta(req), ...metaOverrides };
            const actor =
                (
                    req as express.Request & {
                        actor?: Parameters<typeof homepage.send>[0]['actor'];
                    }
                ).actor ?? null;
            await homepage.send({ req, res, actor }, meta, launch);
        };

        // ── Root + path-aliased shell routes ────────────────────────

        router.get('/', {}, (req, res) => sendShell(req, res));

        router.get('/settings', {}, (req, res) => sendShell(req, res));
        router.get('/settings/*splat', {}, (req, res) => sendShell(req, res));

        router.get('/dashboard', {}, (req, res) => sendShell(req, res));
        router.get('/dashboard/', {}, (req, res) => sendShell(req, res));

        router.get('/action/*splat', {}, (req, res) => sendShell(req, res));

        router.get('/@:username', {}, (req, res) => sendShell(req, res));

        // ── /app/:name ─ app metadata baked into the shell ──────────

        router.get('/app/:name', {}, async (req, res) => {
            const name = String(req.params.name ?? '');
            const app = name ? await this.stores.app.getByName(name) : null;

            if (app) {
                const metadata =
                    (typeof app.metadata === 'string'
                        ? safeJsonParse(app.metadata)
                        : (app.metadata as Record<string, unknown> | null)) ??
                    {};
                await sendShell(req, res, {
                    title: String(app.title ?? name),
                    description: String(app.description ?? ''),
                    short_description: String(app.description ?? ''),
                    icon: typeof app.icon === 'string' ? app.icon : undefined,
                    social_media_image:
                        typeof metadata.social_image === 'string'
                            ? metadata.social_image
                            : undefined,
                    app: app as Record<string, unknown>,
                });
                return;
            }

            // App not found — return 404 but still render the shell so the
            // client-side router can decide what to display.
            res.status(404);
            await sendShell(req, res, {
                title: name
                    ? name.charAt(0).toUpperCase() + name.slice(1)
                    : 'Puter',
            });
        });

        // ── /show/* ─ launch explorer with the requested file path ──

        router.get('/show/*splat', {}, (req, res) => {
            const filePath = req.path.slice('/show'.length);
            const launch: LaunchOptions = {
                on_initialized: [
                    {
                        $: 'window-call',
                        fn_name: 'launch_app',
                        args: [{ name: 'explorer', path: filePath }],
                    },
                ],
            };
            return sendShell(req, res, {}, launch);
        });

        // ── Fallback static mount ───────────────────────────────────
        // Serves lingering GUI assets (images, fonts, lib files, etc.)
        // out of <gui_assets_root>/src. Falls through to the 404 handler
        // when the file doesn't exist.
        if (this.config.gui_assets_root) {
            router.use(
                '/',
                { subdomain: '' },
                express.static(path.join(this.config.gui_assets_root, 'src')),
            );
        }
    }
}

const safeJsonParse = (s: string): Record<string, unknown> | null => {
    try {
        const parsed = JSON.parse(s);
        return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};
