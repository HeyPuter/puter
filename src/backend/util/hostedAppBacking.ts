/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import type { SubdomainStore } from '../stores/subdomain/SubdomainStore';
import type { PrivateLaunchDecision } from './privateLaunchAccess';

/**
 * Launch-safety checks for puter-hosted `index_url`s.
 *
 * A hosted subdomain (`*.<hosting-domain>`) can be deleted by its owner and
 * then re-registered by anyone else, but the app row keeps the stale URL —
 * nothing rewrites it on subdomain deletion. Any producer of launchable app
 * metadata must therefore re-check the backing before handing an `index_url` to
 * the GUI launcher, which appends `puter.auth.token` to it.
 *
 * This module is the single home for that check. `AppDriver` was the first
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
}

interface AppBackingRow {
    index_url?: unknown;
    owner_user_id?: unknown;
}

function normalizeConfiguredHostedDomain(domainValue: unknown): string | null {
    if (typeof domainValue !== 'string') return null;
    const normalizedDomain = domainValue
        .trim()
        .toLowerCase()
        .replace(/^\./, '');
    if (!normalizedDomain) return null;
    return normalizedDomain.split(':')[0] || null;
}

export function getPuterHostedDomains(
    config: HostedDomainConfig | undefined | null,
): string[] {
    const domains = new Set<string>();
    const cfg = config ?? {};
    for (const configuredDomain of [
        cfg.static_hosting_domain,
        cfg.static_hosting_domain_alt,
        cfg.private_app_hosting_domain,
        cfg.private_app_hosting_domain_alt,
    ]) {
        const normalized = normalizeConfiguredHostedDomain(configuredDomain);
        if (normalized) domains.add(normalized);
    }
    return [...domains];
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
    if (!row) return true; // subdomain no longer exists → dangling

    const appOwnerId = Number(app.owner_user_id);
    const subdomainOwnerId = Number(row.user_id);
    if (!Number.isInteger(appOwnerId) || !Number.isInteger(subdomainOwnerId)) {
        return true;
    }
    return subdomainOwnerId !== appOwnerId;
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
