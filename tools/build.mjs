// Build entry point for packages/puter — covers `src/backend` (the v2 backend
// package) and `extensions` (built-in OSS extensions). Replaces the old
// `tsc -p tsconfig.build.json`. tsconfig is now IDE-only.
//
// Pipeline:
//   1. Collect every .ts / .js source under src/backend + extensions, honoring
//      the same excludes as packages/puter/tsconfig.json.
//   2. esbuild transpile-only emit to ./dist (ESM, with __dirname/__filename/
//      require shimmed via banner).
//   3. Rewrite relative imports in the output to add `.js` / `/index.js`.
//   4. Hand off to write-dist-package-json.mjs (existing) for the dist
//      package.json + non-source asset copies.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    collectEntryPoints,
    rewriteRelativeImports,
    transpile,
} from '../../../tools/lib/esmBuild.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(PACKAGE_ROOT, 'dist');

const EXCLUDED_FILES = new Set([
    'src/backend/services/worker/template/puter-portable.js',
    'src/backend/services/DynamoKVStore/DynamoKVStore.ts',
    'src/backend/clients/s3/S3Client.js',
    'src/backend/clients/s3/s3ClientProvider.js',
    'src/backend/clients/redis/RedisClient.js',
    'src/backend/clients/dynamodb/DDBClient.js',
]);

const EXCLUDED_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'volatile',
    'tests',
]);

const EXCLUDED_DIR_PREFIXES = ['src/backend/test', 'src/backend/tools'];

const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|mts|js)$/;

const VITEST_FILES = new Set([
    'src/backend/vitest.config.ts',
    'src/backend/vitest.bench.config.ts',
    'src/backend/vitest.bench.config.js',
]);

const isExcluded = (relPath, entry) => {
    if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) return true;
        const norm = relPath.split(path.sep).join('/');
        return EXCLUDED_DIR_PREFIXES.some(
            (p) => norm === p || norm.startsWith(`${p}/`),
        );
    }
    const norm = relPath.split(path.sep).join('/');
    if (TEST_FILE_RE.test(entry.name)) return true;
    if (VITEST_FILES.has(norm)) return true;
    if (EXCLUDED_FILES.has(norm)) return true;
    return false;
};

async function run() {
    const roots = ['src/backend', 'extensions'].map((r) =>
        path.join(PACKAGE_ROOT, r),
    );
    const entryPoints = [];
    for (const root of roots) {
        const found = await collectEntryPoints({
            root,
            extensions: ['.ts', '.js'],
            isExcluded: (rel, entry) =>
                isExcluded(path.relative(PACKAGE_ROOT, path.join(root, rel)), entry),
        });
        entryPoints.push(...found);
    }

    if (entryPoints.length === 0) {
        console.warn('[build] no source files matched');
        return;
    }

    console.log(`[build] esbuild transpiling ${entryPoints.length} files`);
    await transpile({
        entryPoints,
        outdir: DIST,
        outbase: PACKAGE_ROOT,
        tsconfig: path.join(PACKAGE_ROOT, 'tsconfig.json'),
    });

    console.log('[build] rewriting relative imports');
    await rewriteRelativeImports(DIST);

    console.log('[build] writing dist package.json + asset copies');
    const r = spawnSync(
        process.execPath,
        [path.join(PACKAGE_ROOT, 'tools', 'write-dist-package-json.mjs')],
        { stdio: 'inherit', cwd: PACKAGE_ROOT },
    );
    if (r.status !== 0) process.exit(r.status ?? 1);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
