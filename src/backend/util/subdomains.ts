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

/** Express's own default, used when `domain` is missing or unusable. */
const DEFAULT_SUBDOMAIN_OFFSET = 2;

/**
 * How many labels express must drop from the right of a hostname before what's
 * left counts as a subdomain. Express defaults to 2, which only holds for a
 * two-label root domain — on `puter.example.com` it would report `puter` as an
 * active subdomain of every root request, sending the root origin through the
 * user-site redirect instead of the routes that serve it.
 */
export function subdomainOffsetForDomain(
    domain: string | undefined | null,
): number {
    if (typeof domain !== 'string') return DEFAULT_SUBDOMAIN_OFFSET;
    const labels = domain
        .trim()
        .toLowerCase()
        .split(':')[0]
        .split('.')
        .filter(Boolean);
    return labels.length > 0 ? labels.length : DEFAULT_SUBDOMAIN_OFFSET;
}

/**
 * The subdomain a request is addressed to, or `''` for the root domain.
 * `req.subdomains` is reverse-of-URL order, so the active one is last.
 */
export function activeSubdomain(req: { subdomains?: string[] }): string {
    const subdomains = req.subdomains;
    if (!subdomains?.length) return '';
    return subdomains[subdomains.length - 1] ?? '';
}
