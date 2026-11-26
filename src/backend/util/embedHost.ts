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

import {
    isReservedSubdomain,
    subdomainLabelOf,
} from '../core/http/middleware/hostRedirects.js';
import type { IConfig } from '../types.js';

export type EmbedFramingConfig = Pick<
    IConfig,
    | 'origin'
    | 'domain'
    | 'api_base_url'
    | 'static_hosting_domain'
    | 'static_hosting_domain_alt'
    | 'private_app_hosting_domain'
    | 'private_app_hosting_domain_alt'
>;

/**
 * The origin of a first-party page that may frame an `/embed/*` page, named
 * exactly from the request's referrer, or null. A wildcard over `*.<domain>`
 * would also admit user-hosted sites whenever the hosting domains sit under it,
 * so only a single label under `<domain>` qualifies, and not one this server
 * answers itself (the API, WebDAV, SDK and native-app hosts).
 */
export function embedHostOrigin(
    config: EmbedFramingConfig,
    referer: string | undefined,
): string | null {
    const gui = new URL(config.origin ?? `https://${config.domain}`);
    let parent: URL;
    try {
        parent = new URL(referer ?? '');
    } catch {
        return null;
    }
    const host = parent.hostname.toLowerCase();
    const label = subdomainLabelOf(host, config.domain);
    const hostingDomains = [
        config.static_hosting_domain,
        config.static_hosting_domain_alt,
        config.private_app_hosting_domain,
        config.private_app_hosting_domain_alt,
    ]
        .map((d) => (d ?? '').toLowerCase().split(':')[0])
        .filter(Boolean);
    const allowed =
        parent.protocol === gui.protocol &&
        parent.port === gui.port &&
        label !== undefined &&
        !isReservedSubdomain(label) &&
        host !== new URL(config.api_base_url).hostname &&
        !hostingDomains.some((d) => host === d || host.endsWith(`.${d}`));
    return allowed ? parent.origin : null;
}
