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

import type { SubdomainStore } from '../stores/subdomain/SubdomainStore';
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

export const HOSTED_BACKING_UNAVAILABLE_REASON = 'hosted_backing_unavailable';

interface HostedDomainConfig {
    static_hosting_domain?: unknown;
    static_hosting_domain_alt?: unknown;
    private_app_hosting_domain?: unknown;
    private_app_hosting_domain_alt?: unknown;
    protocol?: unknown;
}

interface AppBackingRow {
    index_url?: unknown;
    owner_user_id?: unknown;
}

function normalizeHostedDomainValue(domainValue: unknown): string | null {
    if (typeof domainValue !== 'string') return null;
    const normalizedDomain = domainValue
        .trim()
        .toLowerCase()
        .replace(/^\./, '');
    return normalizedDomain || null;
}

function normalizeConfiguredHostedDomain(domainValue: unknown): string | null {
    const normalizedDomain = normalizeHostedDomainValue(domainValue);
    if (!normalizedDomain) return null;
    return normalizedDomain.split(':')[0] || null;
}

function configuredHostedDomainValues(
    config: HostedDomainConfig | undefined | null,
): unknown[] {
    const cfg = config ?? {};
    return [
        cfg.static_hosting_domain,
        cfg.static_hosting_domain_alt,
        cfg.private_app_hosting_domain,
        cfg.private_app_hosting_domain_alt,
    ];
}

export function getPuterHostedDomains(
    config: HostedDomainConfig | undefined | null,
): string[] {
    const domains = new Set<string>();
    for (const configuredDomain of configuredHostedDomainValues(config)) {
        const normalized = normalizeConfiguredHostedDomain(configuredDomain);
        if (normalized) domains.add(normalized);
    }
    return [...domains];
}

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

    const hosts = new Set<string>();
    for (const configuredDomain of configuredHostedDomainValues(config)) {
        // Keep the configured form and a port-stripped one: dev configs carry
        // a `:4100`-style port and stored index_urls exist in both shapes.
        const withPort = normalizeHostedDomainValue(configuredDomain);
        if (withPort) hosts.add(`${name}.${withPort}`);
        const bare = normalizeConfiguredHostedDomain(configuredDomain);
        if (bare) hosts.add(`${name}.${bare}`);
    }
    if (hosts.size === 0) return [];

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
 * True when `row` (the subdomain backing `app`'s hosted index_url, or null)
 * means the app's launch is unsafe: gone, or reclaimed by a different owner.
 */
function backingRowIsUnavailable(
    app: AppBackingRow,
    row: { user_id?: unknown } | null,
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
 * True when the app's puter-hosted subdomain is missing, or is currently owned
 * by a different user than the app's owner (it was reclaimed — launching would
 * leak the token to the new owner). Non-hosted index_urls return false.
 */
export async function hostedIndexUrlBackingIsUnavailable({
    app,
    subdomainStore,
    config,
}: {
    app: AppBackingRow;
    subdomainStore: Pick<SubdomainStore, 'getBySubdomain'>;
    config: HostedDomainConfig | undefined | null;
}): Promise<boolean> {
    const subdomain = extractPuterHostedSubdomain(app.index_url, config);
    if (!subdomain) return false;

    let row = await subdomainStore.getBySubdomain(subdomain);
    if (!row) {
        // A freshly-created subdomain may not have reached a replica or the
        // local cache yet; confirm against the primary before treating the
        // backing as gone (mirrors the create/update ownership check in
        // `AppDriver#ensurePuterSiteSubdomainIsOwned`).
        row = await subdomainStore.getBySubdomain(subdomain, {
            primary: true,
        });
    }
    return backingRowIsUnavailable(app, row);
}

/**
 * Batched sibling of {@link hostedIndexUrlBackingIsUnavailable} — one
 * `getBySubdomains` call (plus a single primary follow-up for whatever's still
 * missing) instead of per-app round trips. Returns a boolean per `apps` entry,
 * in input order, with the same semantics as the single-app function above.
 */
export async function hostedIndexUrlBackingsAreUnavailable({
    apps,
    subdomainStore,
    config,
}: {
    apps: AppBackingRow[];
    subdomainStore: Pick<SubdomainStore, 'getBySubdomains'>;
    config: HostedDomainConfig | undefined | null;
}): Promise<boolean[]> {
    const subdomains = apps.map((app) =>
        extractPuterHostedSubdomain(app.index_url, config),
    );
    const names = [
        ...new Set(subdomains.filter((s): s is string => s !== null)),
    ];
    if (names.length === 0) return apps.map(() => false);

    let rowsByName = await subdomainStore.getBySubdomains(names);
    const missing = names.filter((name) => !rowsByName.has(name));
    if (missing.length > 0) {
        const primaryRows = await subdomainStore.getBySubdomains(missing, {
            primary: true,
        });
        rowsByName = new Map([...rowsByName, ...primaryRows]);
    }

    return apps.map((app, i) => {
        const subdomain = subdomains[i];
        if (!subdomain) return false;
        return backingRowIsUnavailable(app, rowsByName.get(subdomain) ?? null);
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
