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

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { IConfig } from '../../../types';
import type { RouteOptions } from '../types';
import { assertNormalized } from '../../../services/fs/resolveNode.js';
import { HttpError, isHttpError } from '../HttpError';
import { isLocalWorkerHost } from './localWorkerProxy';

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
 * Subdomains that v2 serves itself. Anything NOT in this set that lives on the
 * root domain is treated as a user-defined site and rejected with a 404.
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
 * Decides whether a request to a claimed subdomain is answered at all. `false`
 * gets the unclaimed-subdomain 404, so it must not touch `res` first; a thrown
 * `HttpError` is sent as is, any other throw counts as `false`.
 */
export type ClaimAuthorize = (
    req: Request,
    res: Response,
) => boolean | Promise<boolean>;

export interface SubdomainClaim {
    authorize: ClaimAuthorize;
    /**
     * Vets each route declared for the claim as the server builds it; a throw
     * fails the boot, naming the route.
     */
    checkRoute?: (options: RouteOptions, label: string) => void;
}

/** A claim as dispatch sees it: its gate, plus the routes served behind it. */
export interface ResolvedClaim {
    authorize: ClaimAuthorize;
    handler?: RequestHandler;
}

export type ClaimLookup = (name: string) => ResolvedClaim | undefined;

const SUBDOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Record a claim on `<name>.<domain>`. Throws on a malformed or uppercase
 * label, a subdomain core already handles, or a name that is already claimed.
 */
export const addClaimedSubdomain = (
    claims: Map<string, SubdomainClaim>,
    name: string,
    claim: SubdomainClaim,
): void => {
    if (typeof name !== 'string' || !SUBDOMAIN_LABEL.test(name)) {
        throw new Error(`Invalid subdomain label: ${JSON.stringify(name)}`);
    }
    if (name === 'www' || RESERVED_SUBDOMAINS.has(name)) {
        throw new Error(`Subdomain '${name}' is reserved`);
    }
    if (claims.has(name)) {
        throw new Error(`Subdomain '${name}' is already claimed`);
    }
    if (typeof claim?.authorize !== 'function') {
        throw new Error(`Subdomain '${name}' claimed without authorize`);
    }
    if (
        claim.checkRoute !== undefined &&
        typeof claim.checkRoute !== 'function'
    ) {
        throw new Error(
            `Subdomain '${name}' claimed with an invalid checkRoute`,
        );
    }
    claims.set(name, {
        authorize: claim.authorize,
        ...(claim.checkRoute ? { checkRoute: claim.checkRoute } : {}),
    });
};

const subdomainNotFound = () =>
    new HttpError(404, 'Not Found', { legacyCode: 'not_found' });

/**
 * Ends the global chain at a claim: unauthorized or unanswered requests get the
 * unclaimed-subdomain 404, and errors reach the error handler.
 */
const dispatchClaimed = async (
    claim: ResolvedClaim,
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    let allowed = false;
    try {
        allowed = (await claim.authorize(req, res)) === true;
    } catch (err) {
        if (isHttpError(err)) {
            next(err);
            return;
        }
        console.warn(
            `[subdomain-claim] authorize failed: ${(err as Error)?.message}`,
        );
    }
    if (!allowed || !claim.handler) {
        if (!res.headersSent) next(subdomainNotFound());
        return;
    }

    let finished = false;
    const done = ((err?: unknown) => {
        if (finished) return;
        finished = true;
        if (err && err !== 'route' && err !== 'router') {
            next(err);
            return;
        }
        if (res.headersSent) return;
        next(subdomainNotFound());
    }) as NextFunction;
    try {
        await claim.handler(req, res, done);
    } catch (err) {
        done(err);
    }
};

/** Redirects `www.<domain>` → `<domain>` (dropping the path). */
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
 * Rejects user-defined subdomains on the main domain with a 404
 * (`foo.puter.com/...`). User sites are served only from the static hosting
 * domain; the main domain must not act as an alias for them.
 *
 * Passes through when:
 *
 * - No active subdomain (root)
 * - Active subdomain is reserved (api, js, native apps, …)
 * - Host is on one of the hosting domains (they may nest under `config.domain`)
 * - Host is a local worker host and the local worker server is on
 * - Host isn't under `config.domain` (custom domains, other hosts)
 * - `static_hosting_domain` isn't configured (no separate hosting domain)
 *
 * Hosts compare without their port, so `foo.<domain>:<port>` is treated like
 * `foo.<domain>`. A host that is exactly `<name>.<domain>` for a claimed `name`
 * goes to that claim instead of the 404; claims are looked up per request.
 */
export const createUserSubdomainNotFound = (
    config: IConfig,
    lookupClaim: ClaimLookup = () => undefined,
): RequestHandler => {
    const domain = (config.domain ?? '').toLowerCase().split(':')[0];
    if (!domain || !config.static_hosting_domain) {
        return (_req, _res, next) => next();
    }
    const localWorkers = Boolean(config.workers?.localServer);

    const hostingDomains = [
        config.static_hosting_domain,
        config.static_hosting_domain_alt,
        config.private_app_hosting_domain,
        config.private_app_hosting_domain_alt,
    ]
        .map((d) => (d ?? '').toLowerCase().split(':')[0])
        .filter((d) => d.length > 0);
    return (req, res, next) => {
        const active = (
            req.subdomains?.[req.subdomains.length - 1] ?? ''
        ).toLowerCase();
        if (active === '' || RESERVED_SUBDOMAINS.has(active)) return next();

        const hostName = (req.headers.host ?? '').toLowerCase().split(':')[0];
        if (
            hostingDomains.some(
                (d) => hostName === d || hostName.endsWith(`.${d}`),
            )
        ) {
            return next();
        }
        if (localWorkers && isLocalWorkerHost(hostName)) return next();
        if (!hostName.endsWith(`.${domain}`)) return next();

        // The claim replaces this 404, so it runs before CORS, the OPTIONS
        // responder, body parsing, auth and every route, `subdomain: '*'` ones
        // included. One label deep only: `<name>.x.<domain>` is not the claim.
        const claimed =
            req.subdomains?.length === 1 && hostName === `${active}.${domain}`
                ? lookupClaim(active)
                : undefined;
        if (claimed) {
            void dispatchClaimed(claimed, req, res, next);
            return;
        }

        next(subdomainNotFound());
    };
};

/**
 * Serves static files from native-app bundles for the reserved app subdomains
 * (`editor.*`, `docs.*`, …). `docs` and `developer` resolve under a `/dist`
 * subdir — everything else maps directly to `<root>/<app>`.
 *
 * When the requested path is a directory without a trailing slash, responds
 * with 307 so relative asset URLs resolve correctly.
 *
 * Pass-through when `native_apps_root` is unset so self-hosted deployments that
 * don't ship the apps don't trip on 404s.
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

        const requested = req.path;
        assertNormalized(requested);
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
