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

import { encode } from 'html-entities';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import { PuterService } from '../types.js';
import type { Actor } from '../../core/actor';

interface Manifest {
    css_paths?: string[];
    js_paths?: string[];
    lib_paths?: string[];
    index?: string;
    [k: string]: unknown;
}

export interface PageMeta {
    title: string;
    description?: string;
    short_description?: string;
    company?: string;
    canonical_url?: string;
    social_media_image?: string;
    icon?: string;
    app?: { name?: string; [k: string]: unknown } | null;
}

export interface LaunchOptions {
    on_initialized?: Array<Record<string, unknown>>;
}

interface PuterGuiAddonsEvent {
    req: Request;
    path: string;
    logged_in_user: Actor['user'] | null;
    guiParams: Record<string, unknown>;
    /** Extensions may append to these — rendered into the shell HTML. */
    bodyContent: string;
    headContent: string;
    prependHeadContent: string;
    /**
     * Scripts/markup that must run BEFORE the `gui(...)` bootstrap. Useful
     * for loading jQuery or third-party SDKs (Stripe.js) that the GUI code
     * expects to be present on window.
     */
    prependBodyContent: string;
}

/**
 * Serves the root HTML shell that bootstraps the Puter GUI.
 *
 * Extensions contribute by:
 *   - `registerScript(url)` — adds a `<script type="module" src=...>` tag
 *     after the GUI init script.
 *   - `setGuiParam(key, value)` — injects a value into the client-side
 *     `gui()` call.
 *   - Listening for `puter.gui.addons` — mutate the event object's
 *     `bodyContent` / `headContent` / `prependHeadContent` strings to
 *     splice arbitrary markup into the shell.
 */
export class PuterHomepageService extends PuterService {
    #manifest: Manifest | null = null;
    #serviceScripts: string[] = [];
    #guiParams: Record<string, unknown> = {};

    override async onServerStart(): Promise<void> {
        const root = this.config.gui_assets_root;
        if (!root) return;
        try {
            const raw = await readFile(
                path.join(root, 'puter-gui.json'),
                'utf8',
            );
            const parsed = JSON.parse(raw) as Record<string, Manifest>;
            const profile = this.config.gui_profile ?? 'development';
            this.#manifest = parsed[profile] ?? null;
            if (!this.#manifest) {
                console.warn(
                    `[homepage] puter-gui.json has no profile "${profile}"`,
                );
            }
        } catch (e) {
            console.warn('[homepage] failed to load puter-gui.json:', e);
        }
    }

    registerScript(url: string): void {
        this.#serviceScripts.push(url);
    }

    setGuiParam(key: string, val: unknown): void {
        this.#guiParams[key] = val;
    }

    /**
     * Render and send the shell HTML. Returns the rendered string so callers
     * that want to cache or post-process can opt in; `res.send` is already
     * called on the happy path.
     */
    async send(
        ctx: { req: Request; res: Response; actor?: Actor | null },
        meta: PageMeta,
        launchOptions: LaunchOptions = {},
    ): Promise<void> {
        const { req, res, actor } = ctx;

        // Easter egg: puter-in-puter detection → render error page instead.
        if (
            req.query['puter.app_instance_id'] ||
            req.query['error_from_within_iframe']
        ) {
            const eggs = [
                'puter in puter?',
                'Infinite recursion!',
                "what'chu cookin'?",
            ];
            const msg =
                (typeof req.query.message === 'string' && req.query.message) ||
                eggs[Math.floor(Math.random() * eggs.length)];
            res.send(this.#renderError(msg));
            return;
        }

        const html = await this.#renderShell(
            { req, actor: actor ?? null },
            meta,
            launchOptions,
        );
        res.send(html);
    }

    // ── Internals ────────────────────────────────────────────────────

    async #renderShell(
        ctx: { req: Request; actor: Actor | null },
        meta: PageMeta,
        launchOptions: LaunchOptions,
    ): Promise<string> {
        const { req, actor } = ctx;
        const env = this.config.env ?? 'prod';
        const bundled = env !== 'dev' || this.config.use_bundled_gui === true;
        const assetDir = env === 'dev' ? '/src' : '/dist';

        const captchaEnabled = Boolean(this.config.captcha?.enabled);
        const captchaRequired = {
            login: captchaEnabled,
            signup: captchaEnabled,
        };

        // Payload delivered to the client-side `gui(…)` boot function.
        // Order: extension-registered params → built-in config params →
        // per-request meta (so page-specific values win).
        const guiParams: Record<string, unknown> = {
            ...this.#guiParams,
            ...(this.config.gui_params ?? {}),
            domain: this.config.domain,
            env,
            api_base_url: this.config.api_base_url,
            api_origin: this.config.api_base_url,
            app_origin: this.#originFromRequest(req),
            gui_origin: this.#originFromRequest(req),
            hosting_domain: this.config.static_hosting_domain,
            asset_dir: assetDir,
            captchaRequired,
            ...meta,
            launch_options: launchOptions,
        };

        const event: PuterGuiAddonsEvent = {
            req,
            path: req.path,
            logged_in_user: actor?.user ?? null,
            guiParams: { ...guiParams },
            bodyContent: '',
            headContent: '',
            prependHeadContent: '',
            prependBodyContent: '',
        };

        try {
            // emitAndWait — extensions mutate `bodyContent` / `headContent` /
            // `prependHeadContent` / `prependBodyContent` on `event`, and
            // `#buildHtml` reads those fields below. Plain `emit` would
            // return before the listeners ran.
            await this.clients.event.emitAndWait('puter.gui.addons', event, {});
        } catch (e) {
            console.warn('[homepage] puter.gui.addons emit failed:', e);
        }

        return this.#buildHtml({
            meta,
            assetDir,
            bundled,
            manifest: this.#manifest,
            event,
            guiParams,
        });
    }

    #buildHtml(args: {
        meta: PageMeta;
        assetDir: string;
        bundled: boolean;
        manifest: Manifest | null;
        event: PuterGuiAddonsEvent;
        guiParams: Record<string, unknown>;
    }): string {
        const { meta, assetDir, bundled, manifest, event, guiParams } = args;
        const e = encode;
        const title = meta.title;
        const description = meta.description ?? '';
        const shortDescription = meta.short_description ?? description;
        const company = meta.company ?? 'Puter Technologies Inc.';
        const canonical = meta.canonical_url ?? '';
        const socialImage = this.#validSocialImage(
            meta.social_media_image,
            assetDir,
        );

        const guiBundle = this.config.gui_bundle ?? '/dist/bundle.min.js';
        const guiCss = this.config.gui_css ?? '/dist/bundle.min.css';
        const puterJsBundle =
            this.config.gui_puterjs_bundle ?? 'https://js.puter.com/v2/';

        const manifestCss =
            !bundled && manifest?.css_paths
                ? manifest.css_paths
                      .map((p) => `<link rel="stylesheet" href="${p}">`)
                      .join('\n')
                : '';

        const serviceScriptTags = this.#serviceScripts
            .map((url) => `<script type="module" src="${url}"></script>`)
            .join('\n');

        const guiParamsJson = JSON.stringify(guiParams).replace(
            /</g,
            '\\u003c',
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${e(title)}</title>
    ${event.prependHeadContent}

    <link rel="preload" href="${guiBundle}" as="script" />
    ${bundled ? `<link rel="preload" href="${puterJsBundle}" as="script">` : ''}

    <meta name="author" content="${e(company)}">
    <meta name="description" content="${e(description.replace(/\n/g, ' ').trim())}">
    <meta name="facebook-domain-verification" content="e29w3hjbnnnypf4kzk2cewcdaxym1y" />
    <link rel="canonical" href="${e(canonical)}">

    <meta property="og:url" content="${e(canonical)}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${e(title)}">
    <meta property="og:description" content="${e(shortDescription.replace(/\n/g, ' ').trim())}">
    <meta property="og:image" content="${e(socialImage)}">

    <meta name="twitter:card" content="summary_large_image">
    <meta property="twitter:domain" content="puter.com">
    <meta property="twitter:url" content="${e(canonical)}">
    <meta name="twitter:title" content="${e(title)}">
    <meta name="twitter:description" content="${e(shortDescription.replace(/\n/g, ' ').trim())}">
    <meta name="twitter:image" content="${e(socialImage)}">

    <link rel="apple-touch-icon" sizes="57x57" href="${assetDir}/favicons/apple-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="${assetDir}/favicons/apple-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="${assetDir}/favicons/apple-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="${assetDir}/favicons/apple-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="${assetDir}/favicons/apple-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="${assetDir}/favicons/apple-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="${assetDir}/favicons/apple-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="${assetDir}/favicons/apple-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="${assetDir}/favicons/apple-icon-180x180.png">
    <link rel="icon" type="image/png" sizes="192x192" href="${assetDir}/favicons/android-icon-192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="${assetDir}/favicons/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="${assetDir}/favicons/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="${assetDir}/favicons/favicon-16x16.png">
    <link rel="manifest" href="${assetDir}/manifest.json">
    <meta name="msapplication-TileColor" content="#ffffff">
    <meta name="msapplication-TileImage" content="${assetDir}/favicons/ms-icon-144x144.png">
    <meta name="theme-color" content="#ffffff">
    ${bundled ? `<link rel="stylesheet" href="${guiCss}">` : ''}

    <link rel="preload" as="image" href="https://puter-assets.b-cdn.net/wallpaper.webp">

    <script>
        if ( ! window.service_script ) {
            window.service_script_api_promise = (() => {
                let resolve, reject;
                const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
                promise.resolve = resolve;
                promise.reject = reject;
                return promise;
            })();
            window.service_script = async fn => {
                try { await fn(await window.service_script_api_promise); }
                catch (e) { console.error('service_script(ERROR)', e); }
            };
        }
    </script>

    ${manifestCss}

    ${event.headContent}
</head>
<body>
    ${event.prependBodyContent}
    <script>window.puter_gui_enabled = true;</script>
    ${bundled ? "<script>window.gui_env = 'prod';</script>" : ''}

    <script src="${guiBundle}"></script>
    <script type="module">
    window.addEventListener('load', function() {
        gui(${guiParamsJson});
    });
    </script>
    ${serviceScriptTags}
    <div id="templates" style="display: none;"></div>

    ${event.bodyContent}
</body>
</html>`;
    }

    #renderError(message: string): string {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            box-sizing: border-box;
            margin: 0; height: 100vh; width: 100vw;
            background-color: #2f70ab; color: #f2f7f7;
            font-family: "Inter", "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif;
            display: flex; align-items: center; justify-content: center;
        }
    </style>
</head>
<body>
    <h1>${encode(String(message), { mode: 'nonAsciiPrintable' })}</h1>
</body>
</html>`;
    }

    #originFromRequest(req: Request): string {
        // Prefer the pre-computed `config.origin` (protocol + domain + port).
        // Without it, non-80/443 deployments end up with URLs missing the
        // port, which breaks every self-referential fetch the GUI makes
        // (`/get-gui-token`, `/login`, `/signup`, …).
        if (this.config.origin) return this.config.origin;
        const domain = this.config.domain ?? req.hostname;
        return `${req.protocol}://${domain}`;
    }

    #validSocialImage(raw: string | undefined, assetDir: string): string {
        const fallback = `${assetDir}/images/screenshot.png`;
        if (!raw) return fallback;
        try {
            const url = new URL(raw);
            if (url.protocol !== 'http:' && url.protocol !== 'https:')
                return fallback;
        } catch {
            return fallback;
        }
        if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(raw)) return fallback;
        return raw;
    }
}
