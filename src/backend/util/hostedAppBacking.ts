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

import { isIP } from 'node:net';
import type { EventClient } from '../clients/event/EventClient';
import type { EventMetadata } from '../clients/event/types';
import { HttpError } from '../core/http/HttpError';
import type { SubdomainStore } from '../stores/subdomain/SubdomainStore';
import {
    getPuterHostedDomains,
    type HostedDomainConfig as HostingDomainKeys,
} from './hosts';
import type { PrivateLaunchDecision } from './privateLaunchAccess';

/**
 * Launch-safety checks for puter-hosted `index_url`s.
 *
 * A hosted subdomain (`*.<hosting-domain>`) can be deleted by its owner, but
 * the app row keeps the stale URL — nothing rewrites it on subdomain deletion.
 * Any producer of launchable app metadata must therefore re-check the backing
 * before handing an `index_url` to the GUI launcher, which appends
 * `puter.auth.token` to it.
 *
 * The other half of the rule lives on the write side: `SubdomainDriver.create`
 * refuses a name that an app still points at
 * (`buildHostedSubdomainIndexUrlCandidates`), so a freed name can't be
 * re-registered under someone else's launch origin. Only the app's own owner
 * may re-create it, which restores their app, and not through an unrelated app
 * of theirs: the launch check below compares users, so it can't tell those
 * apart.
 *
 * This module is the single home for both checks. `AppDriver` was the first
 * caller; `SuggestedAppsService` and `/get-launch-apps` build their own
 * summaries and need the same guard, so keep the logic here rather than
 * re-deriving it per producer.
 */

const HOSTED_BACKING_UNAVAILABLE_REASON = 'hosted_backing_unavailable';

/** Inside some owner's top-level Trash, which is where Delete puts things. */
export const isTrashedPath = (path: string): boolean =>
    /^\/[^/]+\/Trash(\/|$)/u.test(path);

interface HostedDomainConfig extends HostingDomainKeys {
    protocol?: unknown;
}

interface AppBackingRow {
    index_url?: unknown;
    owner_user_id?: unknown;
}

interface BackingRow {
    user_id?: unknown;
    root_dir_id?: unknown;
}

type TrashLookup = Partial<Pick<SubdomainStore, 'trashedRootDirIds'>>;

/**
 * Every `index_url` string that resolves to `subdomain` on one of our hosting
 * domains — protocol, port and trailing-path variants included.
 *
 * `apps.index_url` is matched by exact string, so a caller asking "does any app
 * still point at this name?" has to enumerate the same shapes the app write
 * path accepts.
 */
export function buildHostedSubdomainIndexUrlCandidates(
    subdomain: unknown,
    config: HostedDomainConfig | undefined | null,
): string[] {
    const name =
        typeof subdomain === 'string' ? subdomain.trim().toLowerCase() : '';
    if (!name) return [];

    const hosts = getPuterHostedDomains(config, { withPorts: true }).map(
        (domain) => `${name}.${domain}`,
    );
    if (hosts.length === 0) return [];

    const configuredProtocol =
        typeof config?.protocol === 'string'
            ? config.protocol.trim().replace(/:$/, '')
            : '';
    const protocols = [
        ...new Set([configuredProtocol, 'https', 'http'].filter(Boolean)),
    ];

    const candidates = new Set<string>();
    for (const host of hosts) {
        for (const protocol of protocols) {
            const base = `${protocol}://${host}`;
            candidates.add(base);
            candidates.add(`${base}/`);
            candidates.add(`${base}/index.html`);
        }
    }
    return [...candidates];
}

/**
 * Returns the subdomain label when `indexUrl` is hosted on one of our
 * configured hosting domains, else null (a developer's own external domain, or
 * a builtin — we don't manage their DNS and can't reason about ownership).
 */
export function extractPuterHostedSubdomain(
    indexUrl: unknown,
    config: HostedDomainConfig | undefined | null,
): string | null {
    if (typeof indexUrl !== 'string' || !indexUrl) return null;

    let hostname: string;
    try {
        hostname = new URL(indexUrl).hostname.toLowerCase();
    } catch {
        return null;
    }

    // Sort longest-first so `foo.puter.app` matches `puter.app` (not a
    // shorter `app` if it ever appeared in the configured list).
    const hostedDomains = getPuterHostedDomains(config).sort(
        (a, b) => b.length - a.length,
    );

    for (const hostedDomain of hostedDomains) {
        const suffix = `.${hostedDomain}`;
        if (hostname.endsWith(suffix)) {
            const subdomain = hostname.slice(
                0,
                hostname.length - suffix.length,
            );
            return subdomain || null;
        }
    }

    return null;
}

/**
 * The site name a host outside our hosting domains serves, as
 * `site.resolveHost` listeners report it. Null without a listener, when custom
 * domains are off, or when nothing claims the host. Throws when a listener
 * failed, so an outage doesn't read as an unclaimed (external) host.
 */
export async function resolveCustomHostSubdomain(
    host: unknown,
    config: { custom_domains_enabled?: unknown } | undefined | null,
    events:
        | Pick<EventClient, 'emitAndWait' | 'hasListeners'>
        | undefined
        | null,
): Promise<string | null> {
    if (!config?.custom_domains_enabled || !events) return null;
    if (!events.hasListeners('site.resolveHost')) return null;
    if (typeof host !== 'string') return null;
    const normalized = host.trim().toLowerCase().replace(/\.+$/, '');
    // A custom domain is a registrable name: never an IP or a single label.
    if (!normalized.includes('.') || isIP(normalized) !== 0) return null;

    const event = {
        host: normalized,
        result: { subdomain: null as string | null },
    };
    const meta: EventMetadata = {};
    await events.emitAndWait('site.resolveHost', event, meta);
    if (meta.listener_failed) {
        throw new HttpError(503, 'Could not resolve the site for this host', {
            code: 'site_host_unresolved',
        });
    }
    const subdomain = event.result.subdomain;
    return typeof subdomain === 'string' && subdomain ? subdomain : null;
}

/**
 * True when `row` (the subdomain backing `app`'s hosted index_url, or null)
 * means the app's launch is unsafe: gone, or reclaimed by a different owner.
 */
function backingRowIsUnavailable(
    app: AppBackingRow,
    row: BackingRow | null,
): boolean {
    if (!row) return true; // subdomain no longer exists → dangling

    const appOwnerId = Number(app.owner_user_id);
    const subdomainOwnerId = Number(row.user_id);
    if (!Number.isInteger(appOwnerId) || !Number.isInteger(subdomainOwnerId)) {
        return true;
    }
    return subdomainOwnerId !== appOwnerId;
}

/**
 * Root dir ids of `rows` that are in Trash, where the site 404s. Best-effort:
 * the owner's own site is no token risk, so a failed lookup counts as served.
 */
async function trashedRootsOf(
    rows: Array<BackingRow | null>,
    subdomainStore: TrashLookup,
): Promise<Set<number>> {
    if (!subdomainStore.trashedRootDirIds) return new Set();
    const ids = [
        ...new Set(
            rows
                .map((row) => Number(row?.root_dir_id ?? NaN))
                .filter((id) => Number.isInteger(id)),
        ),
    ];
    if (ids.length === 0) return new Set();
    try {
        return await subdomainStore.trashedRootDirIds(ids);
    } catch {
        return new Set();
    }
}

const rootIsTrashed = (row: BackingRow | null, trashed: Set<number>) =>
    row?.root_dir_id != null && trashed.has(Number(row.root_dir_id));

/**
 * Per app, whether its puter-hosted subdomain is missing, is now owned by a
 * different user than the app's owner (it was reclaimed: launching would leak
 * the token to the new owner), or is rooted in Trash. Non-hosted index_urls are
 * false. One `getBySubdomains` call, plus one primary follow-up for names still
 * missing and not negative-cached (a fresh site may not have reached a replica
 * yet). Results are in input order.
 */
export async function hostedIndexUrlBackingsAreUnavailable({
    apps,
    subdomainStore,
    config,
}: {
    apps: AppBackingRow[];
    subdomainStore: Pick<SubdomainStore, 'getBySubdomains'> & TrashLookup;
    config: HostedDomainConfig | undefined | null;
}): Promise<boolean[]> {
    const subdomains = apps.map((app) =>
        extractPuterHostedSubdomain(app.index_url, config),
    );
    const names = [
        ...new Set(subdomains.filter((s): s is string => s !== null)),
    ];
    if (names.length === 0) return apps.map(() => false);

    const cachedMisses = new Set<string>();
    let rowsByName = await subdomainStore.getBySubdomains(names, {
        cachedMisses,
    });
    const missing = names.filter(
        (name) => !rowsByName.has(name) && !cachedMisses.has(name),
    );
    if (missing.length > 0) {
        const primaryRows = await subdomainStore.getBySubdomains(missing, {
            primary: true,
        });
        rowsByName = new Map([...rowsByName, ...primaryRows]);
    }

    const rows = apps.map((app, i) => {
        const subdomain = subdomains[i];
        if (!subdomain) return null;
        const row = rowsByName.get(subdomain) ?? null;
        return backingRowIsUnavailable(app, row) ? null : row;
    });
    const trashed = await trashedRootsOf(rows, subdomainStore);

    return subdomains.map((subdomain, i) => {
        if (!subdomain) return false;
        const row = rows[i] ?? null;
        return !row || rootIsTrashed(row, trashed);
    });
}

/**
 * The denial attached to launch metadata when the hosted backing is gone.
 *
 * Empty `fallbackAppName` keeps the launcher from redirecting to app-center —
 * this isn't an entitlement problem, the backing is simply unavailable.
 */
export function buildHostedBackingDenial(): PrivateLaunchDecision {
    return {
        hasAccess: false,
        fallbackAppName: '',
        reason: HOSTED_BACKING_UNAVAILABLE_REASON,
        checkedBy: 'core/hosted-subdomain-guard',
    };
}
