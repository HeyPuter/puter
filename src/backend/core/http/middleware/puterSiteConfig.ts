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

import { posix as pathPosix } from 'node:path';
import type { FSEntry } from '../../../stores/fs/FSEntry';

/**
 * Minimal Redis surface we need — `get` / `set` with EX TTL. Typed as a
 * subset of ioredis so callers can pass either the real cluster client
 * or a mock without needing the full Cluster type here.
 */
export interface SiteConfigCache {
    get(key: string): Promise<string | null>;
    set(
        key: string,
        value: string,
        mode: 'EX',
        ttlSeconds: number,
    ): Promise<unknown>;
}

/**
 * Site-level configuration loaded from `.puter_site_config` at the site
 * root. Lets a hosted site customize how the server responds for it —
 * currently limited to error-page mapping (e.g. SPA fallback that serves
 * `/index.html` for any 404 with a 200 status).
 *
 * The on-disk JSON shape:
 *
 *   {
 *     "errors": {
 *       "404": { "file": "/index.html", "status": 200 }
 *     }
 *   }
 *
 * Other static-hosting platforms (Vercel `vercel.json`, Netlify/Amplify
 * `_redirects`, nginx `error_page`) express the same idea with different
 * syntax. The internal `SiteConfig` is intentionally narrow so additional
 * parsers can normalize to it without churning the consumer in
 * `puterSite.ts` — see `SITE_CONFIG_FILENAMES` for the lookup list.
 *
 * Security posture (every input here originates from a user-uploaded file
 * served on the open internet):
 *   - the on-disk file is size-capped before parse (`MAX_CONFIG_BYTES`),
 *   - JSON parsing is wrapped in try/catch — a malformed file silently
 *     falls back to default behavior, never 5xx,
 *   - every `file` value is normalized as if it were a URL path: it must
 *     start with `/`, gets `pathPosix.normalize`d so `..` is collapsed,
 *     and is re-anchored under the site root before any FS lookup,
 *   - status codes are clamped to a strict allow-list (the request side
 *     only honours 4xx/5xx error keys; the response side validates the
 *     `status` is a legitimate HTTP integer),
 *   - the config file itself is hidden from public serving by the caller
 *     (`isSiteConfigPath`) — same status/body as any other missing path,
 *     no separate 403 that would leak its existence.
 *
 * Loop safety is the consumer's responsibility: when serving an error
 * page, do NOT re-consult `errors` if the error page itself is missing,
 * otherwise a misconfigured site could spin a 404→404→404 cycle.
 */
export interface SiteErrorRule {
    /** Absolute path under the site root (e.g. `/index.html`). */
    file: string;
    /** HTTP status to return when serving this error page (200–599). */
    status: number;
}

export interface SiteConfig {
    /** Map of HTTP status code → custom error rule. Keys are 4xx/5xx. */
    errors: Record<number, SiteErrorRule>;
}

const MAX_CONFIG_BYTES = 64 * 1024;

// Cache key prefix is distinct from `subdomains:` (SubdomainStore) and
// other Redis users — keep this in sync if you rename, otherwise stale
// entries from prior deploys could be read back as configs.
const CACHE_KEY_PREFIX = 'puter-site-config:';
const CACHE_TTL_SECONDS = 60;
// Sentinel for "we looked, the site has no config" so repeated visits
// to a config-less site don't keep round-tripping S3 to confirm.
const NEGATIVE_CACHE_MARKER = '__none__';

/**
 * Filenames consulted at the site root, in priority order. First file
 * that parses to a non-empty config wins. Extending this list to add
 * Vercel / Netlify / nginx adapters is the entrypoint for multi-format
 * support — each parser receives the raw text and returns a normalized
 * `SiteConfig` (or null if the file isn't valid in that format).
 */
const SITE_CONFIG_FILENAMES: ReadonlyArray<{
    name: string;
    parse: (text: string) => SiteConfig | null;
}> = [{ name: '.puter_site_config', parse: parsePuterSiteConfig }];

/**
 * Returns true if `urlPath` (already normalized to start with `/`) names
 * the site config file. Used by `puterSite.ts` to suppress direct
 * serving so the deployment shape isn't leaked to visitors.
 */
export function isSiteConfigPath(urlPath: string): boolean {
    const base = pathPosix.basename(urlPath);
    return SITE_CONFIG_FILENAMES.some((f) => f.name === base);
}

interface LoadSiteConfigArgs {
    /** Absolute site root path (e.g. `/<username>/Public`). */
    rootPath: string;
    /**
     * Stable identifier for the site root, used as the cache key. We
     * key on `rootDirId` (not the subdomain) so that renaming a
     * subdomain — or pointing multiple subdomains at the same
     * directory — neither orphans nor duplicates the cached entry.
     */
    rootDirId: number;
    fsEntryStore: {
        getEntryByPath: (path: string) => Promise<FSEntry | null>;
    };
    fsService: {
        readContent: (
            entry: FSEntry,
            options?: { range?: string },
        ) => Promise<{
            body: NodeJS.ReadableStream;
            contentLength: number | null;
        }>;
    };
    /**
     * Optional Redis cache. When omitted, every request re-reads the
     * config from S3 — fine for tests, slow for prod. Cache failures
     * are swallowed (best-effort): a transient Redis blip just falls
     * through to the live read, never errors the request.
     */
    cache?: SiteConfigCache;
}

/**
 * Locate and parse the site config. Returns null when no config file
 * exists, the file is unreadable, oversized, or fails validation —
 * callers must treat null as "behave like there is no config" and never
 * raise the error to the visitor. Errors are logged for the operator
 * but never surfaced to the request.
 */
export async function loadSiteConfig(
    args: LoadSiteConfigArgs,
): Promise<SiteConfig | null> {
    const { rootPath, rootDirId, fsEntryStore, fsService, cache } = args;
    if (!rootPath || rootPath === '/') return null;
    // Reject non-positive-integer ids defensively — they'd produce a
    // weird cache key and we'd cache something nonsensical against it.
    // The store contract is positive integers, but this is a hot path
    // for untrusted-origin traffic so we belt-and-brace it.
    const cacheable =
        Number.isInteger(rootDirId) && rootDirId > 0 && cache !== undefined;
    const cacheKey = cacheable ? `${CACHE_KEY_PREFIX}${rootDirId}` : null;

    if (cacheable && cacheKey) {
        try {
            const raw = await cache!.get(cacheKey);
            if (raw === NEGATIVE_CACHE_MARKER) return null;
            if (typeof raw === 'string' && raw.length > 0) {
                // Trust the cached shape — it was produced by this
                // same parser, validated, and the TTL is short. Still
                // wrap in try/catch in case a different deploy wrote a
                // legacy/unparseable value to the same key.
                try {
                    const parsed = JSON.parse(raw) as SiteConfig;
                    if (parsed && parsed.errors) return parsed;
                } catch {
                    /* fall through to a fresh load */
                }
            }
        } catch {
            // Cache transport failure — fall through to live load.
            // Don't poison the next request with a half-applied state.
        }
    }

    for (const { name, parse } of SITE_CONFIG_FILENAMES) {
        const filePath = pathPosix.join(rootPath, name);
        let entry: FSEntry | null;
        try {
            entry = await fsEntryStore.getEntryByPath(filePath);
        } catch (e) {
            console.warn('[puter-site] config lookup failed', {
                path: filePath,
                error: (e as Error)?.message,
            });
            continue;
        }
        if (!entry || entry.isDir) continue;
        // Reject oversized configs before paying the S3 read. `size` can
        // be null for legacy entries — accept and rely on the streaming
        // byte counter below.
        if (entry.size !== null && entry.size > MAX_CONFIG_BYTES) {
            console.warn('[puter-site] config too large, ignoring', {
                path: filePath,
                size: entry.size,
            });
            continue;
        }

        let text: string | null;
        try {
            text = await readBoundedText(entry, fsService, MAX_CONFIG_BYTES);
        } catch (e) {
            console.warn('[puter-site] config read failed', {
                path: filePath,
                error: (e as Error)?.message,
            });
            continue;
        }
        // Null means the stream exceeded the byte cap mid-read.
        if (text === null) continue;

        let parsed: SiteConfig | null;
        try {
            parsed = parse(text);
        } catch (e) {
            console.warn('[puter-site] config parse threw', {
                path: filePath,
                error: (e as Error)?.message,
            });
            parsed = null;
        }
        if (parsed && Object.keys(parsed.errors).length > 0) {
            if (cacheable && cacheKey) {
                writeCache(
                    cache!,
                    cacheKey,
                    JSON.stringify(parsed),
                    CACHE_TTL_SECONDS,
                );
            }
            return parsed;
        }
    }

    // No file matched (or all matched files parsed to empty). Cache
    // the negative result so config-less sites — which are the common
    // case — don't keep paying the FS lookup on every visit.
    if (cacheable && cacheKey) {
        writeCache(cache!, cacheKey, NEGATIVE_CACHE_MARKER, CACHE_TTL_SECONDS);
    }
    return null;
}

// Fire-and-forget cache write. We never await it on the request path
// because failure is non-fatal and we don't want a slow Redis to add
// latency to the response — the next request just re-loads from FS.
function writeCache(
    cache: SiteConfigCache,
    key: string,
    value: string,
    ttlSeconds: number,
): void {
    cache.set(key, value, 'EX', ttlSeconds).catch(() => {
        /* swallow — cache writes are best-effort */
    });
}

/**
 * Resolve a custom error rule for `statusCode` into an absolute FS path
 * under `rootPath`. Returns null if no rule applies or the rule's `file`
 * would escape the site root after normalization. Caller is responsible
 * for loop prevention (don't recurse into error handling when serving
 * the error page itself).
 */
export function resolveErrorTarget(
    config: SiteConfig | null,
    statusCode: number,
    rootPath: string,
): { absPath: string; status: number } | null {
    if (!config) return null;
    const rule = config.errors[statusCode];
    if (!rule) return null;
    // Defence-in-depth: re-normalize at use time. `parsePuterSiteConfig`
    // already does this, but keeping the contract here means future
    // parsers (Vercel, Netlify) only need to return raw paths and can
    // rely on this final guard.
    const normalized = pathPosix.normalize(pathPosix.join('/', rule.file));
    if (!normalized.startsWith('/') || normalized === '/') return null;
    const absPath = rootPath.replace(/\/+$/, '') + normalized;
    return { absPath, status: rule.status };
}

// -- Parsers ---------------------------------------------------------

function parsePuterSiteConfig(text: string): SiteConfig | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const errorsField = (raw as { errors?: unknown }).errors;
    const errors: Record<number, SiteErrorRule> = {};
    if (errorsField && typeof errorsField === 'object') {
        for (const [k, v] of Object.entries(
            errorsField as Record<string, unknown>,
        )) {
            const code = Number(k);
            // Only 4xx/5xx are meaningful as "error pages" — accepting
            // 2xx/3xx keys would let a config silently override the
            // happy path, which is out of scope and a footgun.
            if (!Number.isInteger(code) || code < 400 || code > 599) continue;
            if (!v || typeof v !== 'object') continue;
            const rule = v as { file?: unknown; status?: unknown };
            if (typeof rule.file !== 'string' || !rule.file.startsWith('/')) {
                continue;
            }
            // Default the response status to the matched error code so a
            // bare `{ file: '/404.html' }` Just Works. Allow overriding
            // for the SPA-fallback case where 404 should turn into 200.
            let status: number;
            if (rule.status === undefined) {
                status = code;
            } else if (
                typeof rule.status === 'number' &&
                Number.isInteger(rule.status) &&
                rule.status >= 200 &&
                rule.status <= 599
            ) {
                status = rule.status;
            } else {
                continue;
            }
            const normalized = pathPosix.normalize(
                pathPosix.join('/', rule.file),
            );
            // Empty/root after normalize is meaningless as an error page
            // (it would resolve to the site root itself).
            if (normalized === '/') continue;
            errors[code] = { file: normalized, status };
        }
    }
    return { errors };
}

// Returns null when the stream exceeds `maxBytes` (caller treats as
// "config too large, ignore"). The stream is always destroyed before
// return so the S3 connection doesn't leak on early break.
async function readBoundedText(
    entry: FSEntry,
    fsService: LoadSiteConfigArgs['fsService'],
    maxBytes: number,
): Promise<string | null> {
    const download = await fsService.readContent(entry);
    const stream = download.body as NodeJS.ReadableStream & {
        destroy?: () => void;
    };
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    try {
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            total += chunk.length;
            if (total > maxBytes) {
                exceeded = true;
                break;
            }
            chunks.push(chunk);
        }
    } finally {
        stream.destroy?.();
    }
    if (exceeded) return null;
    return Buffer.concat(chunks).toString('utf8');
}
