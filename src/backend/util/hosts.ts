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

/** The config keys that name the domains user sites are hosted on. */
export interface HostedDomainConfig {
    static_hosting_domain?: unknown;
    static_hosting_domain_alt?: unknown;
    private_app_hosting_domain?: unknown;
    private_app_hosting_domain_alt?: unknown;
}

/**
 * A host or configured domain trimmed, lowercased, without a leading dot and,
 * unless `keepPort`, without its `:port`. Null for a non-string or empty
 * value.
 */
export function normalizeHost(
    value: unknown,
    { keepPort = false }: { keepPort?: boolean } = {},
): string | null {
    if (typeof value !== 'string') return null;
    const host = value.trim().toLowerCase().replace(/^\./, '');
    if (!host) return null;
    return keepPort ? host : host.split(':')[0] || null;
}

/**
 * The configured hosting domains, normalized and deduped. `withPorts` also
 * keeps each domain as configured with its port, since stored URLs exist in
 * both shapes when a dev config carries one.
 */
export function getPuterHostedDomains(
    config: HostedDomainConfig | undefined | null,
    { withPorts = false }: { withPorts?: boolean } = {},
): string[] {
    const cfg = config ?? {};
    const configured = [
        cfg.static_hosting_domain,
        cfg.static_hosting_domain_alt,
        cfg.private_app_hosting_domain,
        cfg.private_app_hosting_domain_alt,
    ];
    const domains = new Set<string>();
    for (const value of configured) {
        if (withPorts) {
            const raw = normalizeHost(value, { keepPort: true });
            if (raw) domains.add(raw);
        }
        const bare = normalizeHost(value);
        if (bare) domains.add(bare);
    }
    return [...domains];
}
