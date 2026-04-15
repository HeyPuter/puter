import { HttpError } from '../../core/http/HttpError.js';
import { driversContainers } from '../../exports.js';
import { PuterController } from '../types.js';

/**
 * REST endpoints for app management.
 *
 * Delegates to AppDriver for the actual CRUD + permission logic —
 * these routes are just thin shape adapters that translate REST
 * conventions into driver calls.
 */
export class AppController extends PuterController {

    get appStore () {
        return this.stores.app;
    }

    get appDriver () {
        // Drivers are wired into the shared driversContainers export by
        // PuterServer at boot. Controllers get them lazily via this getter
        // since they're instantiated before drivers in the boot order.
        const d = driversContainers.apps;
        if ( ! d ) throw new Error('AppDriver not registered yet');
        return d;
    }

    registerRoutes (router) {
        // GET /apps — list apps owned by the current user
        router.get('/apps', {
            subdomain: 'api',
            requireUserActor: true,
        }, async (req, res) => {
            const apps = await this.appDriver.select({ predicate: ['user-can-edit'] });
            res.json(apps);
        });

        // GET /apps/nameAvailable?name=foo
        router.get('/apps/nameAvailable', {
            subdomain: 'api',
            requireUserActor: true,
        }, async (req, res) => {
            const name = req.query?.name;
            if ( !name || typeof name !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `name` query param');
            }
            const available = await this.appDriver.isNameAvailable(name);
            res.json({ name, available });
        });

        // POST /rao — record a recent app open
        router.post('/rao', {
            subdomain: 'api',
            requireAuth: true,
        }, async (req, res) => {
            const { app_uid } = req.body ?? {};
            if ( !app_uid || typeof app_uid !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `app_uid`');
            }

            const app = await this.appStore.getByUid(app_uid);
            if ( ! app ) throw new HttpError(404, 'App not found');

            // Persist open record
            try {
                await this.clients.db.write(
                    'INSERT INTO `app_opens` (`app_uid`, `user_id`, `ts`) VALUES (?, ?, ?)',
                    [app_uid, req.actor.user.id, Math.floor(Date.now() / 1000)],
                );
            } catch (e) {
                console.warn('[rao] insert failed:', e);
            }

            try {
                this.clients.event?.emit('app.opened', {
                    app_uid,
                    user_id: req.actor.user.id,
                }, {});
            } catch {
                // event emission best-effort
            }

            res.json({});
        });

        // GET /apps/:name — returns the app(s) by name.
        // Supports pipe-separated names for batch lookup: /apps/foo|bar|baz
        router.get('/apps/:name', {
            subdomain: 'api',
            requireUserActor: true,
        }, async (req, res) => {
            const raw = req.params.name;
            const names = raw.split('|').filter(Boolean);

            const results = await Promise.all(names.map(async (name) => {
                const app = await this.appStore.getByName(name);
                if ( ! app ) return null;
                try {
                    return await this.appDriver.read({ uid: app.uid });
                } catch {
                    return null;
                }
            }));

            // Single-name requests return the app directly; batch returns an array
            if ( names.length === 1 ) {
                const single = results[0];
                if ( ! single ) throw new HttpError(404, 'App not found');
                return res.json(single);
            }
            res.json(results);
        });
    }

    onServerStart () {
    }
    onServerPrepareShutdown () {
    }
    onServerShutdown () {
    }
}
