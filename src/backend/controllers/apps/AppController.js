import { HttpError } from '../../core/http/HttpError.js';
import { driversContainers } from '../../exports.js';
import { resolvePrivateLaunchAccess } from '../../util/privateLaunchAccess.js';
import { PuterController } from '../types.js';

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

        // POST /rao — record a recent app open
        router.post(
            '/rao',
            {
                subdomain: 'api',
                requireAuth: true,
            },
            async (req, res) => {
                const { app_uid } = req.body ?? {};
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
        // Batch query app metadata by name or UID.

        router.post(
            '/query/app',
            {
                subdomain: 'api',
                requireAuth: true,
            },
            async (req, res) => {
                const appList = Array.isArray(req.body) ? req.body : [];
                const results = [];

                for (const selector of appList) {
                    if (typeof selector !== 'string') continue;
                    const isUid = selector.startsWith('app-');
                    const app = isUid
                        ? await this.appStore.getByUid(selector)
                        : await this.appStore.getByName(selector);
                    if (!app) continue;

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
        const DEFAULT_ICON_B64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

            // If the icon has been processed into PNGs on the hosting
            // subdomain, redirect there. AppIconService rewrites the `icon`
            // column to a non-`data:` value after processing, so anything
            // still sitting as a `data:` URL or bare base64 means the PNG
            // variant doesn't exist yet — don't redirect or we'll bounce to a
            // 404. Unknown-icon apps skip the redirect too and fall through
            // to the default-icon branch below.
            const isInline =
                typeof icon === 'string' &&
                (icon.startsWith('data:') || !/^https?:\/\//i.test(icon));
            if (icon && !isInline) {
                const redirectUrl = this.services.appIcon?.getIconUrl?.(
                    appUid,
                    size,
                );
                if (redirectUrl) {
                    res.set('Cache-Control', 'public, max-age=900');
                    return res.redirect(302, redirectUrl);
                }
            }

            if (!icon) {
                res.set('Content-Type', 'image/png');
                res.set('Cache-Control', 'public, max-age=3600');
                res.send(Buffer.from(DEFAULT_ICON_B64, 'base64'));
                return;
            }

            // Data URL — decode and serve directly
            if (icon.startsWith('data:')) {
                const commaIdx = icon.indexOf(',');
                if (commaIdx === -1) {
                    res.set('Content-Type', 'image/png');
                    res.send(Buffer.from(DEFAULT_ICON_B64, 'base64'));
                    return;
                }
                const mime = icon.slice(5, icon.indexOf(';')) || 'image/png';
                res.set('Content-Type', mime);
                res.set('Cache-Control', 'public, max-age=60');
                res.send(Buffer.from(icon.slice(commaIdx + 1), 'base64'));

                // Trigger background generation so next request hits S3
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

            // HTTP URL — redirect
            if (icon.startsWith('http://') || icon.startsWith('https://')) {
                res.set('Cache-Control', 'public, max-age=900');
                res.redirect(302, icon);
                return;
            }

            // Fallback
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=3600');
            res.send(Buffer.from(DEFAULT_ICON_B64, 'base64'));
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
