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

import { HttpError } from '../../core/http/HttpError.js';
import { driversContainers } from '../../exports.js';
import {
    ICON_DATA_URL_MIME_ALLOWLIST,
    isTrustedIconHost,
} from '../../util/appIcon.js';
import { resolvePrivateLaunchAccess } from '../../util/privateLaunchAccess.js';
import { PuterController } from '../types.js';
import DEFAULT_APP_ICON from './default-app-icon.js';

/**
 * REST endpoints for app management.
 *
 * Delegates to AppDriver for the actual CRUD + permission logic —
 * these routes are just thin shape adapters that translate REST
 * conventions into driver calls.
 */
export class AppController extends PuterController {
    get appStore() {
        return this.stores.app;
    }

    get appDriver() {
        // Drivers are wired into the shared driversContainers export by
        // PuterServer at boot. Controllers get them lazily via this getter
        // since they're instantiated before drivers in the boot order.
        const d = driversContainers.apps;
        if (!d) throw new Error('AppDriver not registered yet');
        return d;
    }

    registerRoutes(router) {
        // GET /apps — list apps owned by the current user
        router.get(
            '/apps',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const apps = await this.appDriver.select({
                    predicate: ['user-can-edit'],
                });
                res.json(apps);
            },
        );

        // GET /apps/nameAvailable?name=foo
        router.get(
            '/apps/nameAvailable',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const name = req.query?.name;
                if (!name || typeof name !== 'string') {
                    throw new HttpError(
                        400,
                        'Missing or invalid `name` query param',
                    );
                }
                const available = await this.appDriver.isNameAvailable(name);
                res.json({ name, available });
            },
        );

        // POST /rao — record a recent app open. When an app-under-user
        // actor calls this, the app id is already on the token — clients
        // don't re-send it in the body. Fall back to `actor.app.uid`
        // before 400-ing for a missing body field.
        router.post(
            '/rao',
            {
                subdomain: 'api',
                requireAuth: true,
            },
            async (req, res) => {
                const bodyAppUid = req.body?.app_uid;
                const actorAppUid = req.actor?.app?.uid;
                const app_uid =
                    typeof bodyAppUid === 'string' && bodyAppUid.length > 0
                        ? bodyAppUid
                        : actorAppUid;
                if (!app_uid || typeof app_uid !== 'string') {
                    throw new HttpError(400, 'Missing or invalid `app_uid`');
                }

                const app = await this.appStore.getByUid(app_uid);
                if (!app) throw new HttpError(404, 'App not found');

                // Persist open record
                try {
                    await this.clients.db.write(
                        'INSERT INTO `app_opens` (`app_uid`, `user_id`, `ts`) VALUES (?, ?, ?)',
                        [
                            app_uid,
                            req.actor.user.id,
                            Math.floor(Date.now() / 1000),
                        ],
                    );
                } catch (e) {
                    console.warn('[rao] insert failed:', e);
                }

                try {
                    this.clients.event?.emit(
                        'app.opened',
                        {
                            app_uid,
                            user_id: req.actor.user.id,
                            ts: Math.floor(Date.now() / 1000),
                        },
                        {},
                    );
                } catch {
                    // event emission best-effort
                }

                res.json({});
            },
        );

        // GET /apps/:name — returns the app(s) by name.
        // Supports pipe-separated names for batch lookup: /apps/foo|bar|baz
        router.get(
            '/apps/:name',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const raw = req.params.name;
                const names = raw.split('|').filter(Boolean);

                const userUid = req.actor?.user?.uuid ?? null;

                const results = await Promise.all(
                    names.map(async (name) => {
                        const app = await this.appStore.getByName(name);
                        if (!app) return null;
                        let shaped;
                        try {
                            shaped = await this.appDriver.read({
                                uid: app.uid,
                            });
                        } catch {
                            return null;
                        }
                        const privateAccess = await resolvePrivateLaunchAccess({
                            app: shaped,
                            eventClient: this.clients.event,
                            userUid,
                            source: 'appsRoute',
                            args: req.query ?? {},
                        });
                        return { ...shaped, privateAccess };
                    }),
                );

                // Single-name requests return the app directly; batch returns an array
                if (names.length === 1) {
                    const single = results[0];
                    if (!single) throw new HttpError(404, 'App not found');
                    return res.json(single);
                }
                res.json(results);
            },
        );

        // ── POST /query/app ────────────────────────────────────────
        // Batch marketplace-style lookup by name or UID.
        //
        // Access rules: only apps the caller has a legitimate reason to
        // see are returned — public (`approved_for_listing`), owned by
        // the caller, or explicitly accessible via AppDriver.read (for
        // protected apps with a granted permission). Everything else is
        // silently skipped so the endpoint can't be used to enumerate
        // existence of private / unapproved apps by guessing names.
        //
        // Response shape is intentionally narrow and mirrors v1 — no
        // internal identifiers (mysql `id`, `owner_user_id`), no
        // `index_url`, no admin flags. Developer `metadata` is
        // included for public/owned apps only, consistent with
        // marketplace semantics.

        const QUERY_APP_MAX_ENTRIES = 200;
        const QUERY_APP_MAX_SELECTOR_LEN = 200;

        router.post(
            '/query/app',
            {
                subdomain: 'api',
                requireAuth: true,
            },
            async (req, res) => {
                const appList = Array.isArray(req.body) ? req.body : [];
                if (appList.length > QUERY_APP_MAX_ENTRIES) {
                    throw new HttpError(
                        400,
                        `request body must contain at most ${QUERY_APP_MAX_ENTRIES} selectors`,
                    );
                }

                const actorUserId = req.actor?.user?.id ?? null;
                const results = [];

                for (const selector of appList) {
                    if (
                        typeof selector !== 'string' ||
                        selector.length === 0 ||
                        selector.length > QUERY_APP_MAX_SELECTOR_LEN
                    ) {
                        continue;
                    }
                    const isUid = selector.startsWith('app-');
                    const app = isUid
                        ? await this.appStore.getByUid(selector)
                        : await this.appStore.getByName(selector);
                    if (!app) continue;

                    const isOwner =
                        actorUserId !== null &&
                        app.owner_user_id === actorUserId;
                    const isApproved = Boolean(app.approved_for_listing);

                    if (!isOwner && !isApproved) {
                        // Unapproved, non-owned — only surface if the
                        // caller has an explicit grant (purchased /
                        // permissioned). AppDriver.read enforces that
                        // via #canReadApp; a thrown 403 means "not
                        // accessible" and we treat it as "not found".
                        try {
                            const shaped = await this.appDriver.read({
                                uid: app.uid,
                            });
                            if (!shaped) continue;
                        } catch {
                            continue;
                        }
                    }

                    const assocRows = await this.clients.db.read(
                        'SELECT `type` FROM `app_filetype_association` WHERE `app_id` = ?',
                        [app.id],
                    );

                    results.push({
                        uuid: app.uid,
                        name: app.name,
                        title: app.title,
                        description: app.description,
                        metadata: app.metadata,
                        tags:
                            typeof app.tags === 'string'
                                ? app.tags.split(',')
                                : [],
                        created: app.timestamp,
                        associations: assocRows.map((r) => r.type),
                    });
                }

                res.json(results);
            },
        );

        // ── GET /app-icon/:app_uid(/:size) ─────────────────────────
        // Serve app icon — data URL decoded inline, HTTP URL redirected.
        //
        // ⚠ FLAG: Missing sharp-based resize pipeline; serves the original.

        const ICON_SIZES = [16, 32, 64, 128, 256, 512];

        // Neutering headers for any response that echoes an icon byte
        // stream on the main origin. `image/svg+xml` is in our MIME
        // allow-list — it's a legitimate image format, and our own
        // default icon is SVG — but SVGs can carry `<script>` tags
        // that execute when the response is loaded as a top-level
        // document (e.g. victim clicks a phishing link pointing at
        // `/app-icon/app-<uid>`). `nosniff` only blocks MIME sniffing;
        // an honestly-declared `image/svg+xml` still renders + runs.
        //
        // `Content-Security-Policy: sandbox` drops the response into an
        // opaque sandboxed browsing context: no scripts, no same-origin,
        // no forms — regardless of the declared type. `<img src>` loads
        // are unaffected because image decoding happens in a restricted
        // mode that already ignores embedded scripts.
        const setIconSecurityHeaders = (res) => {
            res.set('X-Content-Type-Options', 'nosniff');
            res.set('Content-Security-Policy', "default-src 'none'; sandbox;");
        };

        // Serves the default app icon data URL by decoding its base64 body
        // and responding with the declared MIME type (SVG).
        const serveDefaultIcon = (res) => {
            const commaIdx = DEFAULT_APP_ICON.indexOf(',');
            const mime =
                DEFAULT_APP_ICON.slice(5, DEFAULT_APP_ICON.indexOf(';')) ||
                'image/png';
            setIconSecurityHeaders(res);
            res.set('Content-Type', mime);
            res.set('Cache-Control', 'public, max-age=3600');
            res.send(
                Buffer.from(DEFAULT_APP_ICON.slice(commaIdx + 1), 'base64'),
            );
        };

        const serveIcon = async (req, res) => {
            let appUid = String(req.params.app_uid ?? '');
            const size = Number(req.params.size ?? 128);
            if (!appUid) {
                res.status(400).send('Missing app_uid');
                return;
            }
            if (!ICON_SIZES.includes(size)) {
                res.status(400).send('Invalid size');
                return;
            }
            if (!appUid.startsWith('app-')) appUid = `app-${appUid}`;

            const app = await this.appStore.getByUid(appUid);
            const icon = app?.icon;

            // If the icon isn't an inline data URL, try to serve it from the
            // `/system/app_icons/` directory on the hosting subdomain. The
            // resolver picks the sized variant when it exists and falls back
            // to the un-resized original, so apps that only have the original
            // PNG (common for rows imported with a pre-existing HTTP icon
            // URL) don't 404 on `<uid>-<size>.png`.
            const isInline =
                typeof icon === 'string' &&
                (icon.startsWith('data:') || !/^https?:\/\//i.test(icon));
            if (!isInline) {
                const redirectUrl =
                    await this.services.appIcon?.resolveIconRedirectUrl?.(
                        appUid,
                        size,
                    );
                if (redirectUrl) {
                    res.set('Cache-Control', 'public, max-age=900');
                    return res.redirect(302, redirectUrl);
                }
                // No local file — fall back to the raw `icon` column URL
                if (
                    typeof icon === 'string' &&
                    /^https?:\/\//i.test(icon) &&
                    isTrustedIconHost(icon, this.config)
                ) {
                    res.set('Cache-Control', 'public, max-age=900');
                    return res.redirect(302, icon);
                }
            }

            if (!icon) {
                serveDefaultIcon(res);
                return;
            }

            // Data URL — decode and serve directly
            if (icon.startsWith('data:')) {
                const commaIdx = icon.indexOf(',');
                if (commaIdx === -1) {
                    serveDefaultIcon(res);
                    return;
                }
                const semiIdx = icon.indexOf(';');
                const mimeEnd =
                    semiIdx !== -1 && semiIdx < commaIdx ? semiIdx : commaIdx;
                const mime = icon.slice(5, mimeEnd).toLowerCase();
                if (!ICON_DATA_URL_MIME_ALLOWLIST.includes(mime)) {
                    serveDefaultIcon(res);
                    return;
                }
                setIconSecurityHeaders(res);
                res.set('Content-Type', mime);
                res.set('Cache-Control', 'public, max-age=60');
                res.send(Buffer.from(icon.slice(commaIdx + 1), 'base64'));

                // Trigger background generation so next request hits the CDN
                this.clients.event.emit(
                    'app.new-icon',
                    {
                        app_uid: appUid,
                        data_url: icon,
                    },
                    {},
                );
                return;
            }

            // Fallback
            serveDefaultIcon(res);
        };

        // Icons are <img src> targets from the GUI (root) AND resolved via
        // api_base_url in taskbar payloads. Register on both so either origin
        // works without a cross-subdomain redirect.
        router.get('/app-icon/:app_uid', { subdomain: ['api', ''] }, serveIcon);
        router.get(
            '/app-icon/:app_uid/:size',
            { subdomain: ['api', ''] },
            serveIcon,
        );
    }

    onServerStart() {}
    onServerPrepareShutdown() {}
    onServerShutdown() {}
}
