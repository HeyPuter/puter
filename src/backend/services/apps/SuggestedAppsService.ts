import { posix as pathPosix } from 'node:path';
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

/**
 * Given a file entry (path, name, or extension), returns an ordered list
 * of apps that can open it. Built-in apps come from the hardcoded map
 * above; third-party apps come from the `app_filetype_association` table.
 */
export class SuggestedAppsService extends PuterService {
    async getSuggestedApps(entry: {
        name?: string;
        path?: string;
    }): Promise<Array<Record<string, unknown>>> {
        const name =
            entry.name ?? (entry.path ? pathPosix.basename(entry.path) : '');
        const ext = pathPosix.extname(name).replace(/^\./, '');

        const builtinNames = suggestionsForExtension(ext);

        // Fetch built-in apps by name
        const seen = new Set<number>();
        const results: Array<Record<string, unknown>> = [];

        for (const appName of builtinNames) {
            const app = await this.stores.app.getByName(appName);
            if (app && !seen.has(app.id)) {
                seen.add(app.id);
                results.push(toAppSummary(app));
            }
        }

        // Third-party apps registered for this file extension
        if (ext) {
            const thirdParty = await this.stores.app.getAppsByFiletype(ext);
            for (const app of thirdParty) {
                if (seen.has(app.id)) continue;
                // Only include approved-for-opening or owned by caller
                if (app.approved_for_opening_items) {
                    seen.add(app.id);
                    results.push(toAppSummary(app));
                }
            }
        }

        return results;
    }
}

function toAppSummary(app: Record<string, unknown>): Record<string, unknown> {
    return {
        uuid: app.uid,
        name: app.name,
        title: app.title,
        icon: app.icon ?? null,
        godmode: Boolean(app.godmode),
        maximize_on_start: Boolean(app.maximize_on_start),
        index_url: app.index_url,
    };
}
