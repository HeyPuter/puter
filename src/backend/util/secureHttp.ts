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

// Must be imported before 'undici' — see the module comment in the guard.
import './nodeFetchDispatcherGuard.js';

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import net, { BlockList } from 'node:net';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
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

// Connect-time DNS guard: every address a hostname resolves to must be
// public, and the check runs on the resolution the socket actually uses —
// a validate-then-fetch design re-resolves at connect time, so checking
// here (rather than before fetch) is what defeats DNS rebinding.
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
    // `net`'s lookup hook can be handed `options` as either an object or a
    // bare address-family number. Normalize so we can both resolve all
    // addresses and report errors back in the arity the caller expects:
    // `(err, addresses[])` when `all` was requested, `(err, address, family)`
    // otherwise.
    const opts = typeof options === 'number' ? { family: options } : options;
    const wantAll = opts.all === true;
    const fail = (err: Error) => {
        if (wantAll) {
            callback(err, []);
        } else {
            callback(err, '', 0);
        }
    };
    dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) {
            fail(err);
            return;
        }
        const list = addresses as LookupAddress[];
        if (
            list.length === 0 ||
            list.some((a) => !isPublicResolvedAddress(a.address))
        ) {
            fail(
                Object.assign(
                    new Error(
                        `refusing to connect: ${hostname} resolves to a private or reserved address`,
                    ),
                    { code: 'ERR_SSRF_BLOCKED' },
                ),
            );
            return;
        }
        if (wantAll) {
            callback(null, list);
        } else {
            callback(null, list[0].address, list[0].family);
        }
    });
};

const ssrfGuardDispatcher = new UndiciAgent({
    connect: { lookup: guardedLookup },
});

// Proxied requests skip the SSRF lookup guard (the only locally-resolved
// host is the admin-configured proxy itself) but still get an explicit
// dispatcher: undici's fetch would otherwise fall back to the global
// dispatcher slot it shares with Node's built-in fetch.
const proxyDispatcher = new UndiciAgent();

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
 *   • Re-checks DNS at connect time: every address the socket actually
 *     connects to must pass {@link isPublicResolvedAddress}, so a hostname
 *     resolving to a private/reserved address (including via DNS rebinding)
 *     is rejected.
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

    // The connect-time DNS guard only applies to direct fetches. When the
    // request is rewritten through the CORS proxy, the only host resolved
    // locally is the proxy itself — admin-trusted config that may
    // legitimately sit on a private address — and the user-supplied host
    // is resolved by the proxy worker from Cloudflare's network, where
    // this deployment's private ranges aren't reachable.
    const proxied = finalUrl !== url;

    const { skipProxy: _skip, ...rest } = init;
    // lib.dom and undici fetch types are structurally equivalent here but
    // nominally distinct; cast across the boundary.
    const response = (await undiciFetch(finalUrl, {
        ...rest,
        headers,
        redirect: 'manual',
        dispatcher: proxied ? proxyDispatcher : ssrfGuardDispatcher,
    } as unknown as Parameters<typeof undiciFetch>[1])) as unknown as Response;

    if (response.status >= 300 && response.status < 400) {
        throw new HttpError(
            400,
            `redirects are not allowed (target: ${response.headers.get('location') ?? 'unknown'})`,
            { legacyCode: 'bad_request' },
        );
    }

    return response;
}
