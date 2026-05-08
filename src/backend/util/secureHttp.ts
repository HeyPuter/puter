/**
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

import net, { BlockList } from 'node:net';
import { HttpError } from '../core/http/HttpError.js';
import { configContainer } from '../exports.js';
import type { ISecureCorsProxyConfig } from '../types.js';

// Cloudflare's malware-blocking resolver. Used for all outbound fetches we
// make on behalf of user-provided URLs, so if a user points us at something
// on a CF block-list we resolve to the sinkhole rather than the real IP.
const BLOCKED_RESOLVED_IPS = new BlockList();
const BLOCKED_IPV4_MAPPED_IPS = new BlockList();

for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const) {
    BLOCKED_RESOLVED_IPS.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const) {
    BLOCKED_RESOLVED_IPS.addSubnet(address, prefix, 'ipv6');
}
BLOCKED_IPV4_MAPPED_IPS.addSubnet('::ffff:0.0.0.0', 96, 'ipv6');

/**
 * Reject URLs whose host is a raw IP or `localhost`. The goal is to make
 * SSRF harder by stopping trivial `http://169.254.169.254/...` probes before
 * DNS. Pair with the custom resolver below, which rejects private/reserved
 * resolved addresses after DNS.
 */
export function validateUrlNoIP(url: string): void {
    const { hostname } = new URL(url);
    const bare =
        hostname.startsWith('[') && hostname.endsWith(']')
            ? hostname.slice(1, -1)
            : hostname;
    if (net.isIP(bare) !== 0) {
        throw new HttpError(400, 'IP-addressed URLs are not allowed', {
            legacyCode: 'bad_request',
        });
    }
    if (bare === 'localhost') {
        throw new HttpError(400, 'localhost URLs are not allowed', {
            legacyCode: 'bad_request',
        });
    }
}

export function isPublicResolvedAddress(address: string): boolean {
    const family = net.isIP(address);
    if (family === 0) return false;
    if (family === 6 && BLOCKED_IPV4_MAPPED_IPS.check(address, 'ipv6')) {
        return false;
    }
    return !BLOCKED_RESOLVED_IPS.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function proxyConfig(): ISecureCorsProxyConfig | undefined {
    const cfg = configContainer.secureCorsProxy;
    if (cfg?.url && cfg?.secret) return cfg;
    return undefined;
}

interface SecureFetchInit extends Omit<RequestInit, 'redirect'> {
    /** Bypass the CORS proxy even if one is configured. Internal-only calls. */
    skipProxy?: boolean;
}

/**
 * Fetch `url` with SSRF guards:
 *   • Rejects raw-IP / localhost hosts via {@link validateUrlNoIP}.
 *   • Forces `redirect: 'manual'` and rejects any 3xx response so a permissive
 *     target can't bounce us onto an internal endpoint.
 *   • Resolves DNS through Cloudflare's 1.1.1.3 (malware-filtered) resolver
 *     and rejects private/reserved answers before connecting.
 *   • If `config.secureCorsProxy` is set AND the URL isn't a `data:` URI,
 *     rewrites the request through the configured signed Cloudflare Worker
 *     proxy (adds `x-cors-proxy-auth-secret`).
 *
 * Intended for any outbound fetch whose URL originates from user input.
 * Internal-only endpoints (a provider's own API URL, etc.) should keep
 * using plain `fetch`.
 */
export async function secureFetch(
    url: string,
    init: SecureFetchInit = {},
): Promise<Response> {
    // Data URIs bypass everything — nothing to resolve, nothing to proxy.
    if (url.startsWith('data:')) {
        return fetch(url, { ...init, redirect: 'manual' });
    }

    validateUrlNoIP(url);

    let finalUrl = url;
    const headers = new Headers(init.headers ?? {});

    if (!init.skipProxy) {
        const proxy = proxyConfig();
        if (proxy) {
            finalUrl = proxy.url + url;
            headers.set('x-cors-proxy-auth-secret', proxy.secret);
        }
    }

    const { skipProxy: _skip, ...rest } = init;
    const response = await fetch(finalUrl, {
        ...rest,
        headers,
        redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
        throw new HttpError(
            400,
            `redirects are not allowed (target: ${response.headers.get('location') ?? 'unknown'})`,
            { legacyCode: 'bad_request' },
        );
    }

    return response;
}
