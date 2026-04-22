import type { RequestHandler } from 'express';
import { contentType as contentTypeFromMime } from 'mime-types';
import { posix as pathPosix } from 'node:path';
import type { puterClients } from '../../../clients';
import type { puterServices } from '../../../services';
import type { puterStores } from '../../../stores';
import type { IConfig, LayerInstances } from '../../../types';
import {
    buildAppCenterFallback,
    buildHostingConfig,
    buildPrivateHostRedirect,
    hostMatchesPrivateDomain,
    renderLoginBootstrapHtml,
    resolvePrivateAppForHostedSite,
    resolvePrivateIdentity,
    resolvePublicHostedIdentity,
} from './privateAppGate';

/**
 * Serves user-hosted static sites on the hosting domains (`*.puter.site`,
 * `*.puter.app`, and their alt variants). Must run after the auth probe so
 * `req.actor` is populated for the private-app gate, but before controller
 * routes so site hosts don't accidentally hit the API/GUI routers.
 *
 * Scope:
 *   - subdomain → site row (SubdomainStore) → file under site root
 *   - 404 for unknown subdomain / missing file / suspended owner
 *   - private-app gate via `app.privateAccess.check` — marketplace extension
 *     decides; default is denied + redirect to `app-center`
 *   - Range / ETag / Last-Modified passthrough via `fsEntry.readContent`
 *
 * Deferred (not yet implemented):
 *   - Protected sites with `puter.site.token` (needs a `SiteActorType` that
 *     doesn't exist yet). Any site with `protected=1` serves public for now.
 *   - `.at` username-based sites (UUIDv5-keyed `/user/Public`).
 *   - `.puter_site_config` error rules (custom status-code → file mapping).
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
    uuid: string;
    username: string;
    suspended?: number | null;
}

interface Layers {
    clients: LayerInstances<typeof puterClients>;
    stores: LayerInstances<typeof puterStores>;
    services: LayerInstances<typeof puterServices>;
}

function normalizeHost(value: string | undefined | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase().replace(/^\./, '');
    if (!trimmed) return null;
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

    // The private-app hosting domains are the only ones where unowned,
    // unentitled access should be rejected outright — used below to
    // default-deny when a subdomain row on these hosts has no associated
    // app (or the app lookup fails).
    const privateHostingDomains = new Set(
        [
            normalizeHost(config.private_app_hosting_domain),
            normalizeHost(config.private_app_hosting_domain_alt),
        ].filter((d): d is string => !!d),
    );

    if (hostingDomains.length === 0) {
        return (_req, _res, next) => next();
    }

    // Longest-first so `foo.bar.puter.site` matches `bar.puter.site` before
    // falling back to `puter.site`.
    const sortedHostingDomains = [...hostingDomains].sort(
        (a, b) => b.length - a.length,
    );

    const matchHostingDomain = (host: string): string | null => {
        for (const d of sortedHostingDomains) {
            if (host === d) return d;
            if (host.endsWith(`.${d}`)) return d;
        }
        return null;
    };

    return async (req, res, next) => {
        const host = normalizeHost(req.hostname);
        if (!host) return next();

        const matched = matchHostingDomain(host);
        if (!matched) return next();

        // Bare hosting domain (e.g. `puter.site`) → redirect to the main site.
        if (host === matched) {
            if (domain) {
                res.redirect(302, `${req.protocol}://${domain}`);
                return;
            }
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        // `host` is `<prefix>.<matched>`; subdomain is the left-most label.
        const prefix = host.slice(0, host.length - matched.length - 1);
        const subdomain = prefix.split('.')[0] || '';

        if (!subdomain || subdomain === 'www') {
            if (domain) {
                res.redirect(302, `${req.protocol}://${domain}`);
                return;
            }
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        const site = (await layers.stores.subdomain.getBySubdomain(
            subdomain,
        )) as unknown as SubdomainRow | null;
        if (!site || site.user_id === null || site.user_id === undefined) {
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        // Suspended owner 404s — don't leak the suspension reason.
        const owner = (await layers.stores.user.getById(
            site.user_id,
        )) as unknown as UserRow | null;
        if (!owner || owner.suspended) {
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        }

        const hostingCfg = buildHostingConfig(config);

        let associatedApp: AppRow | null = null;
        if (
            site.associated_app_id !== null &&
            site.associated_app_id !== undefined
        ) {
            associatedApp = (await layers.stores.app.getById(
                site.associated_app_id,
            )) as unknown as AppRow | null;
        }

        const privateApp = (await resolvePrivateAppForHostedSite({
            req,
            site: {
                user_id: site.user_id,
                associated_app_id: site.associated_app_id,
            },
            associatedApp,
            db: layers.clients.db,
            config: hostingCfg,
            matchedHostingDomain: matched,
        })) as AppRow | null;

        const isPrivateApp = Boolean(privateApp?.is_private);

        if (isPrivateApp) {
            // Private apps must run on the private hosting domain. If a
            // visitor arrives via the public domain (puter.site), redirect
            // them to the equivalent private-host URL so the cookie scope
            // and gate run on the right origin.
            if (!hostMatchesPrivateDomain(host, hostingCfg.privateDomains)) {
                const redirectUrl = buildPrivateHostRedirect(
                    req,
                    privateApp as never,
                    hostingCfg,
                );
                if (redirectUrl) {
                    res.redirect(302, redirectUrl);
                    return;
                }
                // No private host configured — refuse rather than leak.
                res.status(403)
                    .type('text/plain')
                    .send('Private app host mismatch');
                return;
            }

            // Resolve identity. Lookup order: sticky private-asset
            // cookie → req.actor → session cookie → bootstrap token.
            const identity = await resolvePrivateIdentity({
                req,
                authService: layers.services.auth,
                sessionCookieName:
                    typeof config.cookie_name === 'string'
                        ? config.cookie_name
                        : undefined,
                expectedAppUid: privateApp!.uid,
                expectedSubdomain: subdomain,
                expectedPrivateHost: host,
            });

            if (!identity.userUid) {
                // No identity yet — render the sign-in bootstrap so the
                // browser can call `puter.auth.signIn()` and retry with a
                // token in the query string.
                res.status(200)
                    .set('Cache-Control', 'no-store')
                    .set('X-Robots-Tag', 'noindex, nofollow')
                    .set('Referrer-Policy', 'no-referrer')
                    .type('text/html; charset=UTF-8')
                    .send(
                        renderLoginBootstrapHtml(
                            privateApp as unknown as {
                                uid?: string;
                                name?: string;
                                title?: string;
                            },
                        ),
                    );
                return;
            }

            // Entitlement check runs on every request — matching v1. The
            // sticky cookie is an identity shortcut, not an access cache;
            // the marketplace extension already caches access decisions
            // in Redis so repeat checks are cheap. This guarantees that
            // if entitlement is revoked (refund, grant removed) the very
            // next request stops serving content.
            const checkEvent = {
                appUid: privateApp!.uid,
                userUid: identity.userUid,
                requestHost: host,
                requestPath: req.path,
                result: {
                    allowed: false,
                } as {
                    allowed: boolean;
                    reason?: string;
                    redirectUrl?: string;
                    checkedBy?: string;
                },
            };
            try {
                await layers.clients.event.emitAndWait(
                    'app.privateAccess.check',
                    checkEvent,
                    {},
                );
            } catch (e) {
                console.error('[puter-site] privateAccess.check threw', e);
            }
            if (!checkEvent.result.allowed) {
                const fallback = buildAppCenterFallback(
                    privateApp as unknown as {
                        name?: string;
                        uid?: string;
                    },
                    hostingCfg,
                );
                res.redirect(302, checkEvent.result.redirectUrl || fallback);
                return;
            }

            // Mint the sticky cookie only when we don't already have a
            // valid one — keeps Set-Cookie off of the hot path for repeat
            // visitors but still refreshes after rotation/expiry.
            if (!identity.hasValidPrivateCookie) {
                try {
                    const token = layers.services.auth.createPrivateAssetToken({
                        appUid: privateApp!.uid,
                        userUid: identity.userUid,
                        sessionUuid: identity.sessionUuid,
                        subdomain,
                        privateHost: host,
                    });
                    res.cookie(
                        layers.services.auth.getPrivateAssetCookieName(),
                        token,
                        layers.services.auth.getPrivateAssetCookieOptions({
                            requestHostname: host,
                        }),
                    );
                } catch (e) {
                    console.warn(
                        '[puter-site] failed to mint private asset cookie',
                        e,
                    );
                }
            }

            // Referrer-policy hardening — don't leak private-host URLs to
            // third-party resources loaded from the app.
            res.setHeader('Referrer-Policy', 'no-referrer');
        } else if (privateHostingDomains.has(matched)) {
            // Private host with no private app → refuse. Prevents a
            // public-app subdomain from leaking via the private host.
            res.status(404).type('text/plain').send('Subdomain not found');
            return;
        } else {
            // Public hosted site. Mint the public hosted-actor cookie if
            // we can identify the visitor — lets the hosted page make
            // cross-origin requests as the actor without needing a
            // host-scoped main session cookie. No-op for anonymous
            // visitors.
            try {
                const identity = await resolvePublicHostedIdentity({
                    req,
                    authService: layers.services.auth,
                    sessionCookieName:
                        typeof config.cookie_name === 'string'
                            ? config.cookie_name
                            : undefined,
                    expectedAppUid: associatedApp?.uid,
                    expectedSubdomain: subdomain,
                    expectedHost: host,
                });
                if (
                    identity.userUid &&
                    !(identity as { hasValidPublicCookie?: boolean })
                        .hasValidPublicCookie &&
                    associatedApp?.uid
                ) {
                    const token =
                        layers.services.auth.createPublicHostedActorToken({
                            appUid: associatedApp.uid,
                            userUid: identity.userUid,
                            sessionUuid: identity.sessionUuid,
                            subdomain,
                            host,
                        });
                    res.cookie(
                        layers.services.auth.getPublicHostedActorCookieName(),
                        token,
                        layers.services.auth.getPublicHostedActorCookieOptions({
                            requestHostname: host,
                        }),
                    );
                }
            } catch (e) {
                // Best-effort — don't block the public file serve.
                console.warn(
                    '[puter-site] public hosted actor resolve failed',
                    e,
                );
            }
        }

        if (site.root_dir_id === null || site.root_dir_id === undefined) {
            res.status(502)
                .type('text/plain')
                .send('Subdomain is not pointing to a directory');
            return;
        }

        const rootEntry = await layers.stores.fsEntry.getEntryById(
            site.root_dir_id,
        );
        if (!rootEntry) {
            res.status(502)
                .type('text/plain')
                .send('Subdomain is pointing to deleted directory');
            return;
        }
        if (!rootEntry.isDir) {
            res.status(502)
                .type('text/plain')
                .send('Subdomain is pointing to non-directory');
            return;
        }

        // Resolve URL path → absolute FS path under the site root.
        let urlPath = req.path || '/';
        if (urlPath.endsWith('/')) urlPath += 'index.html';
        const decoded = decodeURIComponent(urlPath);
        // pathPosix.normalize strips `..` segments; the join with '/' anchors
        // it so traversal can't escape the site root.
        const resolvedUrlPath = pathPosix.normalize(
            pathPosix.join('/', decoded),
        );
        const rootPath = rootEntry.path.replace(/\/+$/, '');
        if (!rootPath || rootPath === '/') {
            res.status(403).type('text/plain').send('Forbidden');
            return;
        }
        const filePath = rootPath + resolvedUrlPath;

        const entry = await layers.stores.fsEntry.getEntryByPath(filePath);
        if (!entry || entry.isDir) {
            res.status(404)
                .type('text/html; charset=UTF-8')
                .send('<h1>404</h1><p>Not Found</p>');
            return;
        }

        // Stream the file. `fsEntry.readContent` honours Range + emits
        // ETag/Last-Modified when the S3 layer returns them.
        const range =
            typeof req.headers.range === 'string'
                ? req.headers.range
                : undefined;
        let download;
        try {
            download = await layers.services.fsEntry.readContent(entry, {
                range,
            });
        } catch (e) {
            console.error('[puter-site] readContent failed', e);
            return next(e);
        }

        const mime =
            contentTypeFromMime(entry.name) || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        if (download.contentLength !== null) {
            res.setHeader('Content-Length', String(download.contentLength));
        }
        if (download.contentRange)
            res.setHeader('Content-Range', download.contentRange);
        if (download.etag) res.setHeader('ETag', download.etag);
        if (download.lastModified)
            res.setHeader('Last-Modified', download.lastModified.toUTCString());
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(range ? 206 : 200);

        // Best-effort egress metering against the site owner. The request
        // itself is unauthenticated (public site visitor), so we can't use
        // req.actor — charge the account that hosts the file. Same cost
        // key as FS read egress (`filesystem:egress:bytes`). Fires once
        // the body stream ends so we only meter bytes actually delivered
        // (not aborted mid-stream).
        const metering = layers.services.metering as unknown as
            | {
                  batchIncrementUsages?: (
                      actor: unknown,
                      entries: unknown[],
                  ) => void;
              }
            | undefined;
        if (metering?.batchIncrementUsages && download.contentLength) {
            const ownerActor = {
                user: {
                    uuid: owner.uuid,
                    id: owner.id,
                    username: owner.username,
                    suspended: !!owner.suspended,
                },
            };
            download.body.once('end', () => {
                try {
                    metering.batchIncrementUsages!(ownerActor, [
                        {
                            usageType: 'filesystem:egress:bytes',
                            usageAmount: download.contentLength!,
                        },
                    ]);
                } catch {
                    // ignore — non-critical.
                }
            });
        }

        req.on('close', () => download.body.destroy());
        download.body.on('error', (err) => res.destroy(err));
        download.body.pipe(res);
    };
};
