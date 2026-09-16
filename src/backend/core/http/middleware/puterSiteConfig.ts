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

import { posix as pathPosix } from 'node:path';
import type { FSEntry } from '../../../stores/fs/FSEntry';

/** The subset of ioredis the loader uses, so tests can pass a mock. */
export interface SiteConfigCache {
    get(key: string): Promise<string | null>;
    set(
        key: string,
        value: string,
        mode: 'EX',
        ttlSeconds: number,
    ): Promise<unknown>;
}

export interface SiteErrorRule {
    /** Absolute path under the site root (e.g. `/index.html`). */
    file: string;
    /** HTTP status to return when serving this error page (200–599). */
    status: number;
}

/**
 * Per-site config from `.puter_site_config` at the site root, e.g. `{ "errors":
 * { "404": { "file": "/index.html", "status": 200 } } }`. Every value comes
 * from a user-uploaded file; the parser validates it before it reaches this
 * shape. When serving an error page the consumer must not consult `errors`
 * again if that page is missing, or a misconfigured site loops.
 */
export interface SiteConfig {
    /** HTTP status code (4xx/5xx) → error rule. */
    errors: Record<number, SiteErrorRule>;
}

const MAX_CONFIG_BYTES = 64 * 1024;

const CACHE_KEY_PREFIX = 'puter-site-config:';
const CACHE_TTL_SECONDS = 60;
// Cached "site has no config" so config-less sites don't re-read storage.
const NEGATIVE_CACHE_MARKER = '__none__';

/** Filenames consulted at the site root, in priority order. */
const SITE_CONFIG_FILENAMES: ReadonlyArray<{
    name: string;
    parse: (text: string) => SiteConfig | null;
}> = [{ name: '.puter_site_config', parse: parsePuterSiteConfig }];

/** Whether `urlPath` names a config file, which is never served publicly. */
export function isSiteConfigPath(urlPath: string): boolean {
    const base = pathPosix.basename(urlPath);
    return SITE_CONFIG_FILENAMES.some((f) => f.name === base);
}

interface LoadSiteConfigArgs {
    /** Absolute site root path (e.g. `/<username>/Public`). */
    rootPath: string;
    /** Cache key; the directory rather than the subdomain, which can be renamed. */
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
    /** Best-effort; cache failures fall through to a live read. */
    cache?: SiteConfigCache;
}

/**
 * Locate and parse the site config. Null when there is none or it is
 * unreadable, oversized, or invalid; errors are logged, never surfaced to the
 * visitor.
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
 * Resolve a custom error rule for `statusCode` into an absolute FS path under
 * `rootPath`. Returns null if no rule applies or the rule's `file` would escape
 * the site root after normalization. Caller is responsible for loop prevention
 * (don't recurse into error handling when serving the error page itself).
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
