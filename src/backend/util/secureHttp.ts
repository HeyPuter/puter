import { Resolver, lookup as defaultLookup } from 'node:dns';
import net from 'node:net';
import { Agent as UndiciAgent } from 'undici';
import type { LookupFunction } from 'node:net';
import { HttpError } from '../core/http/HttpError.js';
import { configContainer } from '../exports.js';
import type { ISecureCorsProxyConfig } from '../types.js';

// Cloudflare's malware-blocking resolver. Used for all outbound fetches we
// make on behalf of user-provided URLs, so if a user points us at something
// on a CF block-list we resolve to the sinkhole rather than the real IP.
const SECURE_DNS_SERVER = '1.1.1.3';

/**
 * Reject URLs whose host is a raw IP or `localhost`. The goal is to make
 * SSRF harder: even if the attacker supplies a name that resolves to an
 * internal IP we can still bail before making the request, and this stops
 * the trivial case of `http://169.254.169.254/…` style probes outright.
 * Note this is not sufficient on its own — a hostile DNS record can still
 * resolve to a private IP. Pair with `disable-redirects` + the custom
 * resolver below for defence-in-depth.
 */
export function validateUrlNoIP(url: string): void {
    const { hostname } = new URL(url);
    const bare =
        hostname.startsWith('[') && hostname.endsWith(']')
            ? hostname.slice(1, -1)
            : hostname;
    if (net.isIP(bare) !== 0) {
        throw new HttpError(400, 'IP-addressed URLs are not allowed');
    }
    if (bare === 'localhost') {
        throw new HttpError(400, 'localhost URLs are not allowed');
    }
}

const secureLookup: LookupFunction = (hostname, options, cb) => {
    // Normalise options (same shape as dns.lookup overloads).
    const optsObj =
        typeof options === 'number' ? { family: options } : (options ?? {});
    const family = optsObj.family ?? 0;

    const resolver = new Resolver();
    resolver.setServers([SECURE_DNS_SERVER]);

    const done4 = (err: Error | null, addrs?: string[]) => {
        if (!err && addrs?.length) return cb(null, addrs[0], 4);
        if (family === 4)
            return cb(err ?? new Error('no IPv4 addresses'), '', 4);
        resolver.resolve6(hostname, (e6, a6) => {
            if (!e6 && a6?.length) return cb(null, a6[0], 6);
            // Last-ditch: fall back to the system resolver so short-lived
            // DNS outages on 1.1.1.3 don't hard-fail every outbound fetch.
            defaultLookup(hostname, optsObj, cb);
        });
    };

    if (family === 6) {
        resolver.resolve6(hostname, (e, a) => {
            if (!e && a?.length) return cb(null, a[0], 6);
            defaultLookup(hostname, optsObj, cb);
        });
        return;
    }
    resolver.resolve4(hostname, done4);
};

// Shared dispatcher — built once so we're not re-creating the DNS resolver
// on every request. `keepAlive: false` matches v1's behaviour (short-lived
// connections; no risk of a stale DNS cache across requests).
const secureDispatcher = new UndiciAgent({
    connect: { lookup: secureLookup },
    keepAliveTimeout: 0,
    keepAliveMaxTimeout: 0,
});

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
 *   • Resolves DNS through Cloudflare's 1.1.1.3 (malware-filtered) resolver.
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
        // undici-specific; tsc's lib.dom.d.ts doesn't know about it but
        // Node's fetch forwards it through. Cast-through Record to avoid
        // the type error without opening an `any`.
        ...({ dispatcher: secureDispatcher } as Record<string, unknown>),
    });

    if (response.status >= 300 && response.status < 400) {
        throw new HttpError(
            400,
            `redirects are not allowed (target: ${response.headers.get('location') ?? 'unknown'})`,
        );
    }

    return response;
}
