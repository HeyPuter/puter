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

import { isAccessTokenActor, isAppActor } from '../../core/actor.js';
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
 * Delegates to AppDriver for the actual CRUD + permission logic — these routes
 * are just thin shape adapters that translate REST conventions into driver
 * calls.
 */
/**
 * Desktop boot reads the app list and individual app records repeatedly, so the
 * ceiling is set well above normal boot traffic and exists to catch a runaway
 * client rather than to pace one.
 *
 * "Repeatedly" is the operative word: an app record is read on launch, on
 * permission checks, and again by anything resolving an app by name, so these
 * accumulate against whatever else a session is doing rather than arriving on
 * their own. Sized for a session working hard, not for a person clicking.
 */
const APP_READ_LIMIT = {
    scope: 'app-read',
    limit: 1_800,
    window: 60_000,
    key: 'user',
};

/**
 * Unauthenticated icon serving; no actor to key on, so the bucket is the
 * address — and an address is a NAT, a campus or a carrier gateway that can
 * hold hundreds of desktops. Each desktop boot pulls the taskbar's icons at
 * once, so a single burst from one network is already thousands of requests.
 * Responses are publicly cacheable and usually a redirect, so the ceiling is
 * not protecting bandwidth; it is there so a client looping on a broken icon
 * can't spin unbounded.
 */
const APP_ICON_LIMIT = {
    scope: 'app-icon',
    limit: 12_000,
    window: 60_000,
    key: 'ip',
};

export class AppController extends PuterController {
    get appStore() {
        return this.stores.app;
    }

    // In-flight background app-open writes. Tracked only so tests and
    // shutdown can wait for them — the request path never does.
    #pendingOpenWrites = new Set();

    /**
     * Record an app open. `app_opens` is analytics: it backs the recent-apps
     * list and the open counters, and no response field is derived from it. The
     * client posts this without awaiting and updates its own recent list
     * optimistically, so holding a response open for a primary write only added
     * latency to the launch that write is measuring.
     *
     * Failures are logged, never surfaced — a dropped stat must not turn into a
     * failed app open.
     *
     * @param {string} appUid
     * @param {number} userId
     * @returns {Promise<void>} Settles when the write and event emit finish
     */
    #recordAppOpen(appUid, userId) {
        const ts = Math.floor(Date.now() / 1000);
        const work = (async () => {
            try {
                await this.clients.db.write(
                    'INSERT INTO `app_opens` (`app_uid`, `user_id`, `ts`) VALUES (?, ?, ?)',
                    [appUid, userId, ts],
                );
            } catch (e) {
                console.warn('[rao] insert failed:', e);
            }

            try {
                this.clients.event?.emitAndWait(
                    'app.opened',
                    { app_uid: appUid, user_id: userId, ts },
                    {},
                );
            } catch {
                // event emission best-effort
            }
        })();

        this.#pendingOpenWrites.add(work);
        work.finally(() => this.#pendingOpenWrites.delete(work));
        return work;
    }

    /** Await every in-flight app-open write. */
    async drainPendingAppOpens() {
        await Promise.allSettled([...this.#pendingOpenWrites]);
    }

    get appDriver() {
        // Drivers are wired into the shared driversContainers export by
        // PuterServer at boot. Controllers get them lazily via this getter
        // since they're instantiated before drivers in the boot order.
        const d = driversContainers.apps;
        if (!d) throw new Error('AppDriver not registered yet');
        return d;
    }

    registerRoutes(
        /** @type {import('../../core/http/PuterRouter').PuterRouter} */ router,
    ) {
        // GET /apps — list apps owned by the current user
        router.get(
            '/apps',
            {
                subdomain: 'api',
                requireUserActor: true,
                allowFullAccessToken: true,
                rateLimit: APP_READ_LIMIT,
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
                requireAuth: true,
                // Answers "does this name exist?" for any name, so it is a
                // name-enumeration oracle however cheap it is to serve.
                // Mirrors the `isNameAvailable` budget on AppDriver.
                rateLimit: {
                    scope: 'app-name-available',
                    limit: 60,
                    window: 60_000,
                    key: 'user',
                },
            },
            async (req, res) => {
                const name = req.query?.name;
                if (!name || typeof name !== 'string') {
                    throw new HttpError(
                        400,
                        'Missing or invalid `name` query param',
                        { legacyCode: 'bad_request' },
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
        //
        // Authorization: only two callers are trusted to report opens —
        //   1. a root user actor (plain session, no `.app` and no access
        //      token), e.g. the GUI launching apps on behalf of the user;
        //   2. the app-under-user actor for the app being reported, i.e.
        //      `actor.app.uid === app_uid`.
        // Everything else — access tokens (regardless of issuer), asset
        // tokens, app actors reporting for a *different* app — is denied,
        // otherwise any authenticated party could inflate another app's
        // open count.
        router.post(
            '/rao',
            {
                subdomain: 'api',
                requireAuth: true,
                rateLimit: APP_READ_LIMIT,
            },
            async (req, res) => {
                const actor = req.actor;
                const bodyAppUid = req.body?.app_uid;
                const actorAppUid = actor?.app?.uid;
                const app_uid =
                    typeof bodyAppUid === 'string' && bodyAppUid.length > 0
                        ? bodyAppUid
                        : actorAppUid;
                if (!app_uid || typeof app_uid !== 'string') {
                    throw new HttpError(400, 'Missing or invalid `app_uid`', {
                        legacyCode: 'bad_request',
                    });
                }

                // Access tokens (and any other non-user/non-app identity,
                // e.g. asset tokens) are not allowed to report opens —
                // they're shared / scoped credentials and shouldn't drive
                // analytics counters.
                if (isAccessTokenActor(actor)) {
                    throw new HttpError(
                        403,
                        'Access tokens cannot report app opens',
                        { legacyCode: 'forbidden' },
                    );
                }

                if (isAppActor(actor) && app_uid !== actorAppUid) {
                    throw new HttpError(
                        403,
                        'App actors can only report opens for their own app',
                        { legacyCode: 'forbidden' },
                    );
                }

                const app = await this.appStore.getByUid(app_uid);
                if (!app)
                    throw new HttpError(404, 'App not found', {
                        legacyCode: 'not_found',
                    });

                // Validation and authorization are settled by this point, so
                // the caller learns the outcome now and the stats write lands
                // on its own. See `#recordAppOpen`.
                this.#recordAppOpen(app_uid, req.actor.user.id);

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
                allowFullAccessToken: true,
                rateLimit: APP_READ_LIMIT,
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
                        return {
                            ...shaped,
                            privateAccess:
                                shaped.privateAccess?.hasAccess === false
                                    ? shaped.privateAccess
                                    : privateAccess,
                        };
                    }),
                );

                // Single-name requests return the app directly; batch returns an array
                if (names.length === 1) {
                    const single = results[0];
                    if (!single)
                        throw new HttpError(404, 'App not found', {
                            legacyCode: 'not_found',
                        });
                    return res.json(single);
                }
                res.json(results);
            },
        );

        // -- POST /query/app ----------------------------------------
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
                rateLimit: APP_READ_LIMIT,
            },
            async (req, res) => {
                const appList = Array.isArray(req.body) ? req.body : [];
                if (appList.length > QUERY_APP_MAX_ENTRIES) {
                    throw new HttpError(
                        400,
                        `request body must contain at most ${QUERY_APP_MAX_ENTRIES} selectors`,
                        { legacyCode: 'bad_request' },
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

        // -- GET /app-icon/:app_uid(/:size) -------------------------
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
                // Same freshness as the redirect path above — this is the
                // same resource, just served inline because no CDN file
                // exists yet. A 60s TTL made every app launch re-fetch the
                // icon over a connection the launch itself is competing for.
                res.set('Cache-Control', 'public, max-age=900');
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
        router.get(
            '/app-icon/:app_uid',
            { subdomain: ['api', ''], rateLimit: APP_ICON_LIMIT },
            serveIcon,
        );
        router.get(
            '/app-icon/:app_uid/:size',
            { subdomain: ['api', ''], rateLimit: APP_ICON_LIMIT },
            serveIcon,
        );
    }

    onServerStart() {}
    /**
     * Let outstanding stats writes finish before the process goes away —
     * otherwise a deploy silently drops every open recorded in the seconds
     * before it.
     */
    async onServerPrepareShutdown() {
        await this.drainPendingAppOpens();
    }

    onServerShutdown() {}
}
