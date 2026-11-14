import path from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import {
    backendAliases,
    lowerDecoratorsPlugin,
} from '../../../backend/vitest.config.ts';

// Config for the client-agnostic puter.js API suites (tests/api). The
// runners boot the in-memory backend in-process, so this mirrors the
// backend vitest setup: same decorator lowering, same path aliases, and
// repo root as vitest root so backend + extensions sources get transformed.
const apiTestsDir = __dirname;
const repoRoot = path.resolve(apiTestsDir, '../../../..');
const sdkSourceDir = path.join(repoRoot, 'src/puter-js/src') + path.sep;
const coverage = Boolean(process.env.PUTER_COVERAGE);

// The unit tests import SDK source rather than the instrumented bundle, so in
// coverage mode the source gets the same istanbul counters the bundle has and
// both count into one report.
const instrumentSdkSource = {
    name: 'puter:instrument-sdk-source',
    enforce: 'pre' as const,
    async transform(code: string, id: string) {
        const file = id.split('?')[0]!;
        if (!file.startsWith(sdkSourceDir) || !file.endsWith('.js'))
            return null;
        if (file.endsWith('.test.js')) return null;
        const { transformAsync } = await import('@babel/core');
        const result = await transformAsync(code, {
            filename: file,
            babelrc: false,
            configFile: false,
            sourceMaps: true,
            plugins: [
                [
                    'babel-plugin-istanbul',
                    // Same global lookup as the bundle (webpack.config.js).
                    {
                        coverageGlobalScope:
                            "typeof self !== 'undefined' ? self : globalThis",
                        coverageGlobalScopeFunc: false,
                    },
                ],
            ],
        });
        return result?.code ? { code: result.code, map: result.map } : null;
    },
};

export default defineConfig(({ mode }) => ({
    plugins: [
        lowerDecoratorsPlugin,
        ...(coverage ? [instrumentSdkSource] : []),
    ],
    resolve: { alias: backendAliases },
    test: {
        globals: true,
        // Same PUTER_ env passthrough as the backend config, so
        // PUTER_TEST_* capability vars (harness/capabilities.ts) work
        // from `.env` files too.
        env: loadEnv(mode, '', 'PUTER_'),
        include: [
            'src/puter-js/tests/api/runners/*.test.{js,ts}',
            // Realtime conversations against a mock or live OpenAI upstream.
            'src/puter-js/tests/api/realtime/*.test.{js,ts}',
            // SDK unit tests (pure logic, no server) live next to the code.
            'src/puter-js/src/**/*.test.{js,ts}',
        ],
        // Server boot + SDK/worker bundling happen in hooks; browser and
        // workerd runners are slower than unit tests.
        testTimeout: 60_000,
        hookTimeout: 120_000,
        // Node's own localStorage global is undefined without a storage file
        // and keeps vitest from installing jsdom's in its place.
        execArgv: ['--no-experimental-webstorage'],
        setupFiles: coverage
            ? ['src/puter-js/tests/api/harness/unitCoverageSetup.ts']
            : [],
        root: repoRoot,
    },
}));
