import type { RequestHandler } from 'express';
import { contentType as contentTypeFromMime } from 'mime-types';
import { posix as pathPosix } from 'node:path';
import type { puterClients } from '../../../clients';
import type { puterServices } from '../../../services';
import type { puterStores } from '../../../stores';
import type { IConfig, LayerInstances } from '../../../types';

/**
 * Serves user-hosted static sites on the hosting domains (`*.puter.site`,
 * `*.puter.app`, and their alt variants). Must run after the auth probe so
 * `req.actor` is populated for the private-app gate, but before controller
 * routes so site hosts don't accidentally hit the API/GUI routers.
 *
 * Scope (v1 port — puterSiteMiddleware.js):
 *   - subdomain → site row (SubdomainStore) → file under site root
 *   - 404 for unknown subdomain / missing file / suspended owner
 *   - private-app gate via `app.privateAccess.check` — marketplace extension
 *     decides; default is denied + redirect to `app-center`
 *   - Range / ETag / Last-Modified passthrough via `fsEntry.readContent`
 *
 * Deferred (needs follow-up ports):
 *   - Protected sites with `puter.site.token` (needs `SiteActorType` which
 *     doesn't exist in v2 yet). Any site with `protected=1` serves public for
 *     now — mirror the v1 ACL error path once SiteActorType lands.
 *   - `.at` username-based sites (UUIDv5-keyed `/user/Public`).
 *   - `.puter_site_config` error rules (custom status-code → file mapping).
 *   - Private-host redirect chain (public hosting domain → private hosting
 *     domain for private apps) — currently skipped; clients land on the
 *     static domain and the gate decides.
 *   - Private-login bootstrap HTML (the sign-in-with-Puter shim) — denial
 *     just redirects to app-center for now.
 *   - Custom domains (subdomains table `domain` column) — requires host
 *     validation to allow arbitrary hostnames first.
 */

interface SubdomainRow {
    id: number;
    uuid: string;
    subdomain: string;
    user_id: number | null;
    root_dir_id: number | null;
    associated_app_id: number | null;
    domain?: string | null;
    protected?: number | null;
}

interface AppRow {
    id: number;
    uid: string;
    name?: string;
    is_private?: number | null;
    owner_user_id?: number;
}

interface UserRow {
    id: number;
    username: string;
    suspended?: number | null;
}

interface Layers {
    clients: LayerInstances<typeof puterClients>;
    stores: LayerInstances<typeof puterStores>;
    services: LayerInstances<typeof puterServices>;
}

function normalizeHost (value: string | undefined | null): string | null {
    if ( typeof value !== 'string' ) return null;
    const trimmed = value.trim().toLowerCase().replace(/^\./, '');
    if ( ! trimmed ) return null;
    return trimmed.split(':')[0] || null;
}

export const createPuterSiteMiddleware = (
    config: IConfig,
    layers: Layers,
): RequestHandler => {
    const domain = normalizeHost(config.domain);
    const hostingDomains = [
        normalizeHost(config.static_hosting_domain),
        normalizeHost(config.static_hosting_domain_alt),
        normalizeHost(config.private_app_hosting_domain),
        normalizeHost(config.private_app_hosting_domain_alt),
    ].filter((d): d is string => !!d);

    if ( hostingDomains.length === 0 ) {
        return (_req, _res, next) => next();
    }

    // Longest-first so `foo.bar.puter.site` matches `bar.puter.site` before
    // falling back to `puter.site`.
    const sortedHostingDomains = [...hostingDomains].sort((a, b) => b.length - a.length);

    const matchHostingDomain = (host: string): string | null => {
        for ( const d of sortedHostingDomains ) {
            if ( host === d ) return d;
            if ( host.endsWith(`.${d}`) ) return d;
        }
        return null;
    };

    return async (req, res, next) => {
        const host = normalizeHost(req.hostname);
        if ( !host ) return next();

        const matched = matchHostingDomain(host);
        if ( ! matched ) return next();

        // Bare hosting domain (e.g. `puter.site`) → redirect to the main site.
        if ( host === matched ) {
            if ( domain ) {
                res.redirect(302, `${req.protocol}://${domain}`);
                return;
            }
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        // `host` is `<prefix>.<matched>`; subdomain is the left-most label.
        const prefix = host.slice(0, host.length - matched.length - 1);
        const subdomain = prefix.split('.')[0] || '';

        if ( ! subdomain || subdomain === 'www' ) {
            if ( domain ) {
                res.redirect(302, `${req.protocol}://${domain}`);
                return;
            }
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        const site = await layers.stores.subdomain.getBySubdomain(subdomain) as unknown as SubdomainRow | null;
        if ( ! site || site.user_id === null || site.user_id === undefined ) {
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        // Suspended owner 404s — don't leak the suspension reason.
        const owner = await layers.stores.user.getById(site.user_id) as unknown as UserRow | null;
        if ( ! owner || owner.suspended ) {
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        // Private-app gate. Marketplace extension listens on
        // `app.privateAccess.check` and flips `result.allowed` when the
        // actor owns a valid entitlement.
        let associatedApp: AppRow | null = null;
        if ( site.associated_app_id !== null && site.associated_app_id !== undefined ) {
            associatedApp = await layers.stores.app.getById(site.associated_app_id) as unknown as AppRow | null;
        }
        if ( associatedApp?.is_private ) {
            const userUid = (req as { actor?: { user?: { uuid?: string } } }).actor?.user?.uuid ?? null;
            const checkEvent = {
                appUid: associatedApp.uid,
                userUid,
                requestHost: host,
                requestPath: req.path,
                result: {
                    allowed: false,
                } as { allowed: boolean; reason?: string; redirectUrl?: string; checkedBy?: string },
            };
            try {
                await layers.clients.event.emitAndWait('app.privateAccess.check', checkEvent, {});
            } catch ( e ) {
                console.error('[puter-site] privateAccess.check threw', e);
            }
            if ( ! checkEvent.result.allowed ) {
                const fallback = domain
                    ? `${req.protocol}://${domain}/app/app-center/?item=${encodeURIComponent(associatedApp.uid)}`
                    : '/';
                res.redirect(302, checkEvent.result.redirectUrl || fallback);
                return;
            }
        }

        if ( site.root_dir_id === null || site.root_dir_id === undefined ) {
            res.status(502).type('text/plain').send('Subdomain is not pointing to a directory');
            return;
        }

        const rootEntry = await layers.stores.fsEntry.getEntryById(site.root_dir_id);
        if ( ! rootEntry ) {
            res.status(502).type('text/plain').send('Subdomain is pointing to deleted directory');
            return;
        }
        if ( ! rootEntry.isDir ) {
            res.status(502).type('text/plain').send('Subdomain is pointing to non-directory');
            return;
        }

        // Resolve URL path → absolute FS path under the site root.
        let urlPath = req.path || '/';
        if ( urlPath.endsWith('/') ) urlPath += 'index.html';
        const decoded = decodeURIComponent(urlPath);
        // pathPosix.normalize strips `..` segments; the join with '/' anchors
        // it so traversal can't escape the site root.
        const resolvedUrlPath = pathPosix.normalize(pathPosix.join('/', decoded));
        const rootPath = rootEntry.path.replace(/\/+$/, '');
        if ( ! rootPath || rootPath === '/' ) {
            res.status(403).type('text/plain').send('Forbidden');
            return;
        }
        const filePath = rootPath + resolvedUrlPath;

        const entry = await layers.stores.fsEntry.getEntryByPath(filePath);
        if ( ! entry || entry.isDir ) {
            res.status(404).type('text/html; charset=UTF-8').send('<h1>404</h1><p>Not Found</p>');
            return;
        }

        // Stream the file. `fsEntry.readContent` honours Range + emits
        // ETag/Last-Modified when the S3 layer returns them.
        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        let download;
        try {
            download = await layers.services.fsEntry.readContent(entry, { range });
        } catch ( e ) {
            console.error('[puter-site] readContent failed', e);
            return next(e);
        }

        const mime = contentTypeFromMime(entry.name) || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        if ( download.contentLength !== null ) {
            res.setHeader('Content-Length', String(download.contentLength));
        }
        if ( download.contentRange ) res.setHeader('Content-Range', download.contentRange);
        if ( download.etag ) res.setHeader('ETag', download.etag);
        if ( download.lastModified ) res.setHeader('Last-Modified', download.lastModified.toUTCString());
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(range ? 206 : 200);

        req.on('close', () => download.body.destroy());
        download.body.on('error', (err) => res.destroy(err));
        download.body.pipe(res);
    };
};
