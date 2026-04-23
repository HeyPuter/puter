import type { RequestHandler } from 'express';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { IConfig } from '../../../types';

/** Native-app subdomains served via `nativeAppStatic`. */
const NATIVE_APP_SUBDOMAINS = [
    'about',
    'developer',
    'docs',
    'editor',
    'markus',
    'pdf',
    'apps',
] as const;

/** Subset served out of a `dist/` subdirectory rather than the app root. */
const NATIVE_APPS_WITH_DIST = new Set(['docs', 'developer']);

/**
 * Subdomains that v2 serves itself. Anything NOT in this set that lives on
 * the root domain is treated as a user-defined site and redirected to the
 * static hosting domain.
 *
 * Kept as a plain Set so `has()` is O(1); order doesn't matter.
 */
const RESERVED_SUBDOMAINS = new Set<string>([
    'api',
    'js',
    'dav',
    // Native apps (reserved here regardless of whether nativeAppStatic is
    // currently installed — the redirect should still skip them).
    ...NATIVE_APP_SUBDOMAINS,
    // App-icon serving subdomain.
    'puter-app-icons',
    // Extension-owned subdomains.
    'onlyoffice',
]);

/**
 * Redirects `www.<domain>` → `<domain>` (dropping the path).
 */
export const createWwwRedirect = (config: IConfig): RequestHandler => {
    const domain = (config.domain ?? '').toLowerCase();
    return (req, res, next) => {
        const active = req.subdomains?.[req.subdomains.length - 1] ?? '';
        if (active !== 'www') return next();
        if (!domain) return next();
        res.redirect(`${req.protocol}://${domain}`);
    };
};

/**
 * Redirects user-defined subdomains on the main domain to the static hosting
 * domain. `foo.puter.com/bar?x=1` → `302 foo.puter.site/bar?x=1`.
 *
 * Passes through when:
 *   - no active subdomain (root)
 *   - active subdomain is reserved (api, js, native apps, …)
 *   - host doesn't end in `config.domain` (custom domains, other hosts)
 *   - `static_hosting_domain` isn't configured
 */
export const createUserSubdomainRedirect = (
    config: IConfig,
): RequestHandler => {
    const domain = (config.domain ?? '').toLowerCase();
    const target = (config.static_hosting_domain ?? '').toLowerCase();
    if (!domain || !target) {
        return (_req, _res, next) => next();
    }
    return (req, res, next) => {
        const active = (
            req.subdomains?.[req.subdomains.length - 1] ?? ''
        ).toLowerCase();
        if (active === '' || RESERVED_SUBDOMAINS.has(active)) return next();

        const host = (req.headers.host ?? '').toLowerCase();
        if (!host.endsWith(domain)) return next();

        // host ends in domain — swap the domain suffix for the hosting one,
        // preserving the subdomain prefix and any port.
        const newHost = host.slice(0, host.length - domain.length) + target;
        res.redirect(302, `${req.protocol}://${newHost}${req.originalUrl}`);
    };
};

/**
 * Serves static files from native-app bundles for the reserved app
 * subdomains (`editor.*`, `docs.*`, …). `docs` and `developer` resolve
 * under a `/dist` subdir — everything else maps directly to `<root>/<app>`.
 *
 * When the requested path is a directory without a trailing slash, responds
 * with 307 so relative asset URLs resolve correctly.
 *
 * Pass-through when `native_apps_root` is unset so self-hosted deployments
 * that don't ship the apps don't trip on 404s.
 */
export const createNativeAppStatic = (config: IConfig): RequestHandler => {
    const root = config.native_apps_root;
    const apps = new Set<string>(NATIVE_APP_SUBDOMAINS);
    if (!root) {
        return (_req, _res, next) => next();
    }
    return async (req, res, next) => {
        const active = (
            req.subdomains?.[req.subdomains.length - 1] ?? ''
        ).toLowerCase();
        if (!apps.has(active)) return next();

        const appRoot = NATIVE_APPS_WITH_DIST.has(active)
            ? path.join(root, active, 'dist')
            : path.join(root, active);

        // req.path is already url-decoded by express; normalize strips any
        // `..` segments before sendFile's `root` option enforces its own
        // traversal guard.
        const requested = path.normalize(req.path);
        const absolute = path.join(appRoot, requested);

        try {
            const info = await stat(absolute);
            if (info.isDirectory() && !req.path.endsWith('/')) {
                const search = req.originalUrl.slice(req.path.length);
                res.redirect(307, `${req.path}/${search}`);
                return;
            }
        } catch {
            return next();
        }

        res.sendFile(requested, { root: appRoot }, (err) => {
            if (err) next();
        });
    };
};
