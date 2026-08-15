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
import { getAppIconUrl } from '../../util/appIcon.js';
import { hostedIndexUrlBackingIsUnavailable } from '../../util/hostedAppBacking.js';
import { PuterService } from '../types.js';

// -- Extension → suggested app names mapping -------------------------
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

function suggestionsForExtension(ext: string): {
    names: string[];
    isFallback: boolean;
} {
    const lower = ext.toLowerCase();
    if (CODE_EXTS.has(lower)) {
        return { names: ['code', 'editor'], isFallback: false };
    }
    if (lower === 'txt' || lower === '') {
        return { names: ['editor', 'code'], isFallback: false };
    }
    if (lower === 'md') {
        return { names: ['markus', 'editor', 'code'], isFallback: false };
    }
    if (IMAGE_EXTS.has(lower)) {
        return { names: ['viewer', 'draw'], isFallback: false };
    }
    if (lower === 'pdf') return { names: ['pdf'], isFallback: false };
    if (MEDIA_EXTS.has(lower)) return { names: ['player'], isFallback: false };
    // Unknown extension — editor is a last-resort guess, not a mapping.
    // Callers rank it below apps that explicitly registered the extension.
    return { names: ['editor'], isFallback: true };
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
 * Given a file entry (path, name, or extension), returns an ordered list of
 * apps that can open it. Built-in apps come from the hardcoded map above;
 * third-party apps come from the `app_filetype_association` table.
 *
 * Lookups cache per-extension (plus a separate per-app-name cache for the small
 * set of built-in opener apps), so a `readdir` with N children of the same type
 * pays the DB cost once.
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
     * Resolve suggestions for many entries in one pass. Entries that share an
     * extension are deduped to a single underlying lookup; results are returned
     * positionally so callers can `entries[i].suggestedApps = out[i]`.
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
        const { names: builtinNames, isFallback } =
            suggestionsForExtension(ext);

        const apiBaseUrl = this.config.api_base_url as string | undefined;

        // Built-in apps, looked up by their stable app name. Parallel-safe
        // because order is imposed below via `builtinNames`.
        const builtinApps = await Promise.all(
            builtinNames.map((appName) => this.stores.app.getByName(appName)),
        );

        const thirdPartyApps = ext
            ? (await this.stores.app.getAppsByFiletype(ext)).filter(
                  (app) => app.approved_for_opening_items,
              )
            : [];

        // Order decides the default opener: `suggested[0]` feeds the GUI's
        // double-click path and `/open_item`. Intentionally mapped built-ins
        // keep the head slot, but the unknown-extension `editor` fallback is
        // only a guess — an app that explicitly registered the extension
        // outranks it (a .docx should open in a word processor that claimed
        // it, not in the plain-text editor).
        const ordered = isFallback
            ? [...thirdPartyApps, ...builtinApps]
            : [...builtinApps, ...thirdPartyApps];

        const seen = new Set<number>();
        const candidates: Array<Record<string, unknown>> = [];
        for (const app of ordered) {
            if (!app || seen.has(app.id)) continue;
            seen.add(app.id);
            candidates.push(app);
        }

        // Drop apps whose puter-hosted backing is gone or has been reclaimed
        // by another user. These summaries feed the GUI's default-open path,
        // which launches straight from `app_obj` without re-reading the app
        // through AppDriver — so its hosted-backing guard never runs and the
        // launcher would append `puter.auth.token` to a subdomain the app
        // owner no longer controls. `/open_item` also mints a user-app token
        // (and grants `fs:<uuid>:write`) for `suggested[0]`, so an
        // unlaunchable app must not reach the head of this list either.
        //
        // Built-ins never hit the DB here: their index_urls aren't on a
        // hosting domain, so the check short-circuits on the URL alone.
        const availability = await Promise.all(
            candidates.map((app) =>
                hostedIndexUrlBackingIsUnavailable({
                    app,
                    subdomainStore: this.stores.subdomain,
                    config: this.config,
                }).catch(() => {
                    // A subdomain lookup failure must not silently widen the
                    // guard into "suggest nothing" — but it must not open it
                    // either. Treat the backing as unavailable: the app is
                    // unlaunchable for this window, not deleted.
                    return true;
                }),
            ),
        );

        return candidates
            .filter((_app, index) => !availability[index])
            .map((app) => toAppSummary(app, apiBaseUrl));
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
        // The GUI launches straight from this summary as `app_obj` (no
        // re-read through AppDriver), so any launch-relevant flag omitted
        // here silently disappears on those paths — e.g. the dashboard
        // drawer's feedback control renders off this.
        feedback_enabled: Boolean(app.feedback_enabled),
    };
}
