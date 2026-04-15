import { HttpError } from '../../core/http/HttpError.js';

/**
 * Site hosting endpoints — create, list, delete subdomains/sites.
 *
 * Create/update require FS root_dir_id resolution which isn't clean
 * in v2 yet. For now, only delete + list are exposed.
 */
export class HostingController {
    constructor (config, clients, stores, services) {
        this.config = config;
        this.clients = clients;
        this.stores = stores;
        this.services = services;
    }

    get subdomainStore () { return this.stores.subdomain; }

    registerRoutes (router) {
        // ── Delete site ─────────────────────────────────────────────

        router.post('/delete-site', {
            subdomain: 'api',
            requireUserActor: true,
        }, async (req, res) => {
            const { site_uuid } = req.body ?? {};
            if ( ! site_uuid || typeof site_uuid !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `site_uuid`');
            }

            const deleted = await this.subdomainStore.deleteByUuid(site_uuid, {
                userId: req.actor.user.id,
            });
            if ( ! deleted ) {
                throw new HttpError(404, 'Site not found or not owned by you');
            }

            res.json({});
        });

        // ── List sites owned by the user ────────────────────────────

        router.get('/sites', {
            subdomain: 'api',
            requireUserActor: true,
        }, async (req, res) => {
            const sites = await this.subdomainStore.listByUserId(req.actor.user.id);
            res.json(sites.map(s => ({
                uuid: s.uuid,
                subdomain: s.subdomain,
                root_dir_id: s.root_dir_id,
                associated_app_id: s.associated_app_id,
                created_at: s.ts,
            })));
        });
    }

    onServerStart () {}
    onServerPrepareShutdown () {}
    onServerShutdown () {}
}
