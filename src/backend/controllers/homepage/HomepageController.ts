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

import express from 'express';
import path from 'node:path';
import { PuterController } from '../types.js';
import { toAppShellView } from '../../util/appShellView.js';
import type { PuterRouter } from '../../core/http/PuterRouter';
import {
    isReservedSubdomain,
    subdomainLabelOf,
} from '../../core/http/middleware/hostRedirects.js';
import type { IConfig } from '../../types';
import type {
    PuterHomepageService,
    PageMeta,
    LaunchOptions,
    PopupFrame,
} from '../../services/homepage/PuterHomepageService';

/**
 * GUI popups a first-party page can show in a frame at `/embed/<action>`,
 * instead of opening `/action/<action>` in a window, plus the upgrade dialog,
 * which it would otherwise open in a dashboard tab, and the email confirmation,
 * which it otherwise can't show.
 */
export const FRAMED_POPUP_ACTIONS = [
    'sign-in',
    'show-open-file-picker',
    'show-save-file-picker',
    'show-directory-picker',
    'upgrade',
    'request-email-confirmation',
] as const;

/** Longest description/og:description/twitter:description on `/app/<name>`. */
export const APP_META_DESCRIPTION_MAX = 150;

/**
 * Unauthenticated, rendered on every request, so the bucket is the network
 * address rather than an account.
 */
const APP_LANDING_LIMIT = {
    scope: 'app-landing',
    limit: 600,
    window: 60_000,
    key: 'ip' as const,
};

/**
 * App descriptions can run long; search snippets and social cards want a short
 * blurb. Collapses whitespace, then cuts at a word boundary with an ellipsis so
 * the result never exceeds `APP_META_DESCRIPTION_MAX`.
 */
export function appMetaDescription(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= APP_META_DESCRIPTION_MAX) return clean;
    const head = clean.slice(0, APP_META_DESCRIPTION_MAX - 1);
    const wordEnd = head.lastIndexOf(' ');
    const cut = wordEnd > 0 ? head.slice(0, wordEnd) : head;
    return `${cut.replace(/[\s,;:.!?…—-]+$/, '')}…`;
}

type EmbedFramingConfig = Pick<
    IConfig,
    | 'origin'
    | 'domain'
    | 'api_base_url'
    | 'static_hosting_domain'
    | 'static_hosting_domain_alt'
    | 'private_app_hosting_domain'
    | 'private_app_hosting_domain_alt'
>;

/**
 * The origin of a first-party page that may frame an `/embed/*` page, named
 * exactly from the request's referrer, or null. A wildcard over `*.<domain>`
 * would also admit user-hosted sites whenever the hosting domains sit under it,
 * so only a single label under `<domain>` qualifies, and not one this server
 * answers itself (the API, WebDAV, SDK and native-app hosts).
 */
export function embedHostOrigin(
    config: EmbedFramingConfig,
    referer: string | undefined,
): string | null {
    const gui = new URL(config.origin ?? `https://${config.domain}`);
    let parent: URL;
    try {
        parent = new URL(referer ?? '');
    } catch {
        return null;
    }
    const host = parent.hostname.toLowerCase();
    const label = subdomainLabelOf(host, config.domain);
    const hostingDomains = [
        config.static_hosting_domain,
        config.static_hosting_domain_alt,
        config.private_app_hosting_domain,
        config.private_app_hosting_domain_alt,
    ]
        .map((d) => (d ?? '').toLowerCase().split(':')[0])
        .filter(Boolean);
    const allowed =
        parent.protocol === gui.protocol &&
        parent.port === gui.port &&
        label !== undefined &&
        !isReservedSubdomain(label) &&
        host !== new URL(config.api_base_url).hostname &&
        !hostingDomains.some((d) => host === d || host.endsWith(`.${d}`));
    return allowed ? parent.origin : null;
}

/** `frame-ancestors` for an `/embed/*` page: the GUI and {@link embedHostOrigin}. */
export function embedFrameAncestors(
    config: EmbedFramingConfig,
    referer: string | undefined,
): string {
    const host = embedHostOrigin(config, referer);
    return host ? `'self' ${host}` : "'self'";
}

/**
 * Routes that render the Puter GUI shell, plus a catch-all static fallback
 * under `<gui_assets_root>/src` for non-dist/src paths (images, fonts, lib
 * files referenced from the shell).
 *
 * All root-subdomain-only. Registered last in the controller list so the static
 * catch-all doesn't shadow specific API routes.
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
            popupFrame?: PopupFrame,
        ) => {
            const meta = { ...defaultMeta(req), ...metaOverrides };
            const actor =
                (
                    req as express.Request & {
                        actor?: Parameters<typeof homepage.send>[0]['actor'];
                    }
                ).actor ?? null;
            await homepage.send({ req, res, actor }, meta, launch, popupFrame);
        };

        // -- Root + path-aliased shell routes ------------------------

        router.get('/', {}, (req, res) => sendShell(req, res));

        /**
         * Headers shared by the `/embed/*` pages; false when the request was
         * redirected instead. SDK bootstrap parameters must not change an
         * embed's account or API origin, so a query string is dropped. Checked
         * on the raw URL; `req.query` drops pairs past the parser's limit.
         */
        const prepareEmbed = (
            req: express.Request,
            res: express.Response,
            path: string,
        ): boolean => {
            if (req.originalUrl.includes('?')) {
                res.redirect(path);
                return false;
            }
            res.removeHeader('X-Frame-Options');
            res.setHeader(
                'Content-Security-Policy',
                `frame-ancestors ${embedFrameAncestors(this.config, req.get('referer'))}`,
            );
            res.setHeader('Cache-Control', 'no-store');
            return true;
        };

        router.get('/embed/apps', {}, async (req, res) => {
            if (!prepareEmbed(req, res, '/embed/apps')) return;
            // Shown to visitors without a session; a signed-in embed fetches
            // its own list, so a failure here only costs signed-out visitors.
            const guestApps = await this.services.recommendedApps
                .getRecommendedApps()
                .catch((): Array<Record<string, unknown>> => []);
            res.send(homepage.renderAppBrowserEmbed({ guestApps }));
        });

        router.get('/embed/feedback', {}, (req, res) => {
            if (!prepareEmbed(req, res, '/embed/feedback')) return;
            // The feedback is recorded against this origin, which
            // frame-ancestors has just pinned to the actual framing page.
            res.send(
                homepage.renderFeedbackEmbed({
                    hostOrigin: embedHostOrigin(
                        this.config,
                        req.get('referer'),
                    ),
                }),
            );
        });

        // The GUI runs the popup's own boot, answering the framing page
        // instead of an opener.
        for (const action of FRAMED_POPUP_ACTIONS) {
            const embedPath = `/embed/${action}`;
            router.get(embedPath, {}, async (req, res) => {
                // Routes match case-insensitively and with a trailing slash,
                // and the shell boots the desktop for any other spelling, so
                // only the exact one may be framed.
                if (req.originalUrl !== embedPath) {
                    res.redirect(embedPath);
                    return;
                }
                if (!prepareEmbed(req, res, embedPath)) return;
                await sendShell(
                    req,
                    res,
                    {},
                    {},
                    {
                        hostOrigin: embedHostOrigin(
                            this.config,
                            req.get('referer'),
                        ),
                    },
                );
            });
        }

        router.get('/settings', {}, (req, res) => sendShell(req, res));
        router.get('/settings/*splat', {}, (req, res) => sendShell(req, res));

        router.get('/dashboard', {}, (req, res) => sendShell(req, res));
        router.get('/dashboard/', {}, (req, res) => sendShell(req, res));

        router.get('/desktop', {}, (req, res) => sendShell(req, res));
        router.get('/desktop/', {}, (req, res) => sendShell(req, res));

        router.get('/action/*splat', {}, (req, res) => sendShell(req, res));

        router.get('/@:username', {}, (req, res) => sendShell(req, res));

        // -- /app/:name - app metadata baked into the shell ----------
        // `/desktop/app/:name` is the same landing booted on the desktop
        // instead of the dashboard; the GUI strips the prefix and treats the
        // rest of the path identically, so both render the same shell.

        const sendAppShell = async (
            req: express.Request,
            res: express.Response,
        ) => {
            const name = String(req.params.name ?? '');
            const app = name ? await this.stores.app.getByName(name) : null;

            if (app) {
                const metadata =
                    (typeof app.metadata === 'string'
                        ? safeJsonParse(app.metadata)
                        : (app.metadata as Record<string, unknown> | null)) ??
                    {};
                // Never bake the raw store row into the shell — it exposes
                // `index_url`, `owner_user_id`, and moderation flags. The
                // shell only needs a preview; the GUI re-reads the app
                // through the apps driver before launching, and that read is
                // where the entitlement gate and hosted-backing guard run.
                const clientApp = toAppShellView(app);
                // Feeds <meta name="description">, og:description and
                // twitter:description; scrapers truncate long blurbs anyway.
                const description = appMetaDescription(
                    String(app.description ?? ''),
                );
                await sendShell(req, res, {
                    title: String(app.title ?? name),
                    description,
                    short_description: description,
                    icon: typeof app.icon === 'string' ? app.icon : undefined,
                    social_media_image:
                        typeof metadata.social_image === 'string'
                            ? metadata.social_image
                            : undefined,
                    app: clientApp as Record<string, unknown>,
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
        };

        router.get(
            '/app/:name',
            { rateLimit: APP_LANDING_LIMIT },
            sendAppShell,
        );
        router.get(
            '/desktop/app/:name',
            { rateLimit: APP_LANDING_LIMIT },
            sendAppShell,
        );

        // -- /show/* - launch explorer with the requested file path --

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

        // -- /sw.js - the service worker, scoped to the whole origin --

        router.get('/sw.js', { subdomain: '' }, async (_req, res) => {
            const source = await homepage.serviceWorkerSource();
            if (source === null) {
                res.status(404).send('Not found');
                return;
            }
            res.set('Content-Type', 'text/javascript; charset=utf-8');
            res.set('Cache-Control', 'no-cache');
            res.set('Service-Worker-Allowed', '/');
            res.send(source);
        });

        // -- Fallback static mount -----------------------------------
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
