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

import { PuterService } from '../types.js';

export interface BlockMatch {
    blocked: boolean;
    reason?: string;
}

interface BlocklistEntry {
    domain: string;
    includeSubdomains: boolean;
    reason: string | null;
}

const NOT_BLOCKED: BlockMatch = { blocked: false };

/**
 * In-memory, TTL-cached view of the `blocked_app_origins` table.
 *
 * Admins manage the table (the admin extension writes it directly, mirroring
 * how it writes the `user` table for suspend). This service answers the hot
 * "is this app/origin blocked?" question from a cached snapshot so the
 * per-request app-token validation path never hits the DB.
 *
 * Consistency: the cache refreshes lazily after {@link CACHE_TTL_MS}. Because
 * each worker process holds its own cache, a freshly-added block can take up
 * to one TTL to take effect across the fleet — acceptable for an
 * admin-initiated block.
 */
export class AppOriginBlocklistService extends PuterService {
    private static readonly CACHE_TTL_MS = 30_000;

    #entries: BlocklistEntry[] = [];
    #loadedAt = 0;
    #inflight: Promise<void> | null = null;

    /**
     * Decide whether a bare host (already without scheme/path) is blocked.
     * Exact entries match the host verbatim; `include_subdomains` entries
     * also match any subdomain of `domain`.
     */
    async isHostBlocked(host: string): Promise<BlockMatch> {
        const normalized = normalizeHost(host);
        if (!normalized) return NOT_BLOCKED;

        await this.#ensureFresh();
        for (const entry of this.#entries) {
            const matches = entry.includeSubdomains
                ? normalized === entry.domain ||
                  normalized.endsWith(`.${entry.domain}`)
                : normalized === entry.domain;
            if (matches) {
                return {
                    blocked: true,
                    reason: entry.reason ?? undefined,
                };
            }
        }
        return NOT_BLOCKED;
    }

    /**
     * Decide whether an origin/URL is blocked by extracting its host. Accepts
     * full URLs (`https://app.example.com/path`) and bare hosts alike.
     */
    async isOriginBlocked(origin: string): Promise<BlockMatch> {
        return this.isHostBlocked(hostFromOrigin(origin));
    }

    /** Drop the cached snapshot so the next query reloads from the DB. */
    invalidate(): void {
        this.#loadedAt = 0;
    }

    async #ensureFresh(): Promise<void> {
        const age = Date.now() - this.#loadedAt;
        if (
            this.#loadedAt !== 0 &&
            age < AppOriginBlocklistService.CACHE_TTL_MS
        ) {
            return;
        }
        // Single-flight: concurrent callers share one reload.
        if (!this.#inflight) {
            this.#inflight = this.#reload().finally(() => {
                this.#inflight = null;
            });
        }
        await this.#inflight;
    }

    async #reload(): Promise<void> {
        try {
            const rows = (await this.clients.db.read(
                'SELECT `domain`, `include_subdomains`, `reason` FROM `blocked_app_origins`',
            )) as Array<Record<string, unknown>>;
            this.#entries = rows
                .map((row) => {
                    const domain = normalizeHost(String(row.domain ?? ''));
                    if (!domain) return null;
                    return {
                        domain,
                        includeSubdomains: Boolean(
                            Number(row.include_subdomains ?? 0),
                        ),
                        reason: row.reason == null ? null : String(row.reason),
                    } satisfies BlocklistEntry;
                })
                .filter((e): e is BlocklistEntry => e !== null);
            this.#loadedAt = Date.now();
        } catch (e) {
            // Never let a transient DB error turn into a request-blocking
            // throw on the auth hot path. Keep serving the previous snapshot;
            // a missing table (fresh dev DB pre-migration) yields an empty
            // blocklist, which is the safe-open default.
            console.warn(
                '[app-origin-blocklist] reload failed:',
                (e as Error)?.message ?? e,
            );
            if (this.#loadedAt === 0) {
                this.#entries = [];
                this.#loadedAt = Date.now();
            }
        }
    }
}

/** Lowercase, trim, drop a leading dot and any port. Returns '' when unusable. */
const normalizeHost = (host: string): string => {
    let h = (host ?? '').trim().toLowerCase();
    if (!h) return '';
    h = h.replace(/^\./, '');
    // Strip a trailing :port (IPv6 literals are not app origins, so the
    // simple split is safe here).
    const colon = h.indexOf(':');
    if (colon !== -1) h = h.slice(0, colon);
    return h;
};

/** Extract the host from a full URL, falling back to treating input as a host. */
const hostFromOrigin = (origin: string): string => {
    const raw = (origin ?? '').trim();
    if (!raw) return '';
    try {
        return new URL(raw).hostname;
    } catch {
        // Not a parseable URL — maybe a scheme-less origin or bare host.
        try {
            return new URL(`https://${raw}`).hostname;
        } catch {
            return raw;
        }
    }
};
