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
import { getAppIconUrl } from '../../util/appIcon.js';
import { PuterService } from '../types.js';

// ── Extension → suggested app names mapping ─────────────────────────
//
// Each extension maps to an ordered list of built-in app names that
// can open files of that type.

const CODE_EXTS = new Set([
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
    'json5',
    'jsonl',
    'css',
    'scss',
    'sass',
    'less',
    'html',
    'htm',
    'xhtml',
    'xml',
    'svg',
    'yaml',
    'yml',
    'toml',
    'ini',
    'conf',
    'cfg',
    'env',
    'sh',
    'bash',
    'zsh',
    'fish',
    'bat',
    'cmd',
    'ps1',
    'py',
    'pyw',
    'rb',
    'php',
    'pl',
    'pm',
    'lua',
    'java',
    'kt',
    'kts',
    'scala',
    'groovy',
    'go',
    'rs',
    'c',
    'h',
    'cpp',
    'hpp',
    'cc',
    'cxx',
    'cs',
    'swift',
    'r',
    'jl',
    'ex',
    'exs',
    'erl',
    'hrl',
    'clj',
    'cljs',
    'hs',
    'ml',
    'mli',
    'fs',
    'fsi',
    'fsx',
    'dart',
    'sql',
    'graphql',
    'gql',
    'proto',
    'makefile',
    'cmake',
    'dockerfile',
    'tf',
    'hcl',
    'nix',
    'vim',
    'el',
    'lisp',
    'rkt',
    'scm',
    'asm',
    's',
    'wasm',
    'wat',
    'v',
    'vhd',
    'vhdl',
    'tcl',
]);

const IMAGE_EXTS = new Set([
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'svg',
    'bmp',
    'ico',
    'tiff',
    'tif',
]);
const MEDIA_EXTS = new Set([
    'mp4',
    'webm',
    'mpg',
    'mpeg',
    'avi',
    'mov',
    'mkv',
    'mp3',
    'm4a',
    'ogg',
    'wav',
    'flac',
    'aac',
]);

function suggestionsForExtension(ext: string): string[] {
    const lower = ext.toLowerCase();
    if (CODE_EXTS.has(lower)) return ['code', 'editor'];
    if (lower === 'txt' || lower === '') return ['editor', 'code'];
    if (lower === 'md') return ['markus', 'editor', 'code'];
    if (IMAGE_EXTS.has(lower)) return ['viewer', 'draw'];
    if (lower === 'pdf') return ['pdf'];
    if (MEDIA_EXTS.has(lower)) return ['player'];
    // Unknown extension — fall back to editor
    return ['editor'];
}

// In-memory cache TTL. Apps rarely change, and the worst-case on staleness
// is a few minutes before a new filetype association surfaces — not worth a
// Redis round-trip per lookup on a hot path (readdir fans out per-child).
const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;

type SuggestionsEntry = {
    promise: Promise<Array<Record<string, unknown>>>;
    expiresAt: number;
};

function extractExtension(entry: { name?: string; path?: string }): string {
    const name =
        entry.name ?? (entry.path ? pathPosix.basename(entry.path) : '');
    return pathPosix.extname(name).replace(/^\./, '').toLowerCase();
}

/**
 * Given a file entry (path, name, or extension), returns an ordered list
 * of apps that can open it. Built-in apps come from the hardcoded map
 * above; third-party apps come from the `app_filetype_association` table.
 *
 * Lookups cache per-extension (plus a separate per-app-name cache for the
 * small set of built-in opener apps), so a `readdir` with N children of
 * the same type pays the DB cost once.
 */
export class SuggestedAppsService extends PuterService {
    // Keyed by the normalized extension (lowercase, no leading dot). The
    // cached value is the promise — in-flight lookups coalesce, and the
    // same promise is reused for every entry that shares an extension.
    #extensionCache = new Map<string, SuggestionsEntry>();

    async getSuggestedApps(entry: {
        name?: string;
        path?: string;
    }): Promise<Array<Record<string, unknown>>> {
        return this.#getByExtension(extractExtension(entry));
    }

    /**
     * Resolve suggestions for many entries in one pass. Entries that share
     * an extension are deduped to a single underlying lookup; results are
     * returned positionally so callers can `entries[i].suggestedApps = out[i]`.
     */
    async getSuggestedAppsForEntries(
        entries: Array<{ name?: string; path?: string }>,
    ): Promise<Array<Array<Record<string, unknown>>>> {
        if (entries.length === 0) return [];

        const extensions = entries.map(extractExtension);
        const uniqueExtensions = Array.from(new Set(extensions));
        const resultByExt = new Map<string, Array<Record<string, unknown>>>();

        await Promise.all(
            uniqueExtensions.map(async (ext) => {
                resultByExt.set(ext, await this.#getByExtension(ext));
            }),
        );

        return extensions.map((ext) => resultByExt.get(ext) ?? []);
    }

    #getByExtension(ext: string): Promise<Array<Record<string, unknown>>> {
        const now = Date.now();
        const cached = this.#extensionCache.get(ext);
        if (cached && cached.expiresAt > now) {
            return cached.promise;
        }

        const promise = this.#resolveForExtension(ext).catch((error) => {
            // Failure must not poison the cache — drop the entry so the
            // next caller retries.
            if (this.#extensionCache.get(ext)?.promise === promise) {
                this.#extensionCache.delete(ext);
            }
            throw error;
        });
        this.#extensionCache.set(ext, {
            promise,
            expiresAt: now + SUGGESTION_CACHE_TTL_MS,
        });
        return promise;
    }

    async #resolveForExtension(
        ext: string,
    ): Promise<Array<Record<string, unknown>>> {
        const builtinNames = suggestionsForExtension(ext);

        const seen = new Set<number>();
        const results: Array<Record<string, unknown>> = [];

        const apiBaseUrl = this.config.api_base_url as string | undefined;

        // Built-in apps, looked up by their stable app name. Parallel-safe
        // because order is imposed at the end via `builtinNames`.
        const builtinApps = await Promise.all(
            builtinNames.map((appName) => this.stores.app.getByName(appName)),
        );
        for (const app of builtinApps) {
            if (app && !seen.has(app.id)) {
                seen.add(app.id);
                results.push(toAppSummary(app, apiBaseUrl));
            }
        }

        if (ext) {
            const thirdParty = await this.stores.app.getAppsByFiletype(ext);
            for (const app of thirdParty) {
                if (seen.has(app.id)) continue;
                if (app.approved_for_opening_items) {
                    seen.add(app.id);
                    results.push(toAppSummary(app, apiBaseUrl));
                }
            }
        }

        return results;
    }
}

function toAppSummary(
    app: Record<string, unknown>,
    apiBaseUrl: string | undefined,
): Record<string, unknown> {
    return {
        uuid: app.uid,
        name: app.name,
        title: app.title,
        icon: getAppIconUrl(app, { apiBaseUrl }) ?? app.icon ?? null,
        godmode: Boolean(app.godmode),
        maximize_on_start: Boolean(app.maximize_on_start),
        index_url: app.index_url,
    };
}
