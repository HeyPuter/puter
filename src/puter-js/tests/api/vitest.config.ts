import path from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { lowerDecoratorsPlugin } from '../../../backend/vitest.config.ts';

// Config for the client-agnostic puter.js API suites (tests/api). The
// runners boot the in-memory backend in-process, so this mirrors the
// backend vitest setup: same decorator lowering, same path aliases, and
// repo root as vitest root so backend + extensions sources get transformed.
const apiTestsDir = __dirname;
const repoRoot = path.resolve(apiTestsDir, '../../../..');
const backendDir = path.join(repoRoot, 'src/backend');

export default defineConfig(({ mode }) => ({
    plugins: [lowerDecoratorsPlugin],
    resolve: {
        alias: [
            {
                find: /^@heyputer\/backend\/src\/(.*)$/,
                replacement: path.join(backendDir, '$1'),
            },
            {
                find: /^@heyputer\/backend\/(.*)$/,
                replacement: path.join(backendDir, '$1'),
            },
            {
                find: /^@heyputer\/backend$/,
                replacement: path.join(backendDir, 'exports.ts'),
            },
        ],
    },
    test: {
        globals: true,
        // Same PUTER_ env passthrough as the backend config, so
        // PUTER_TEST_* capability vars (harness/capabilities.ts) work
        // from `.env` files too.
        env: loadEnv(mode, '', 'PUTER_'),
        include: [
            'src/puter-js/tests/api/runners/*.test.{js,ts}',
            // SDK unit tests (pure logic, no server) live next to the code.
            'src/puter-js/src/**/*.test.{js,ts}',
        ],
        // Server boot + SDK/worker bundling happen in hooks; browser and
        // workerd runners are slower than unit tests.
        testTimeout: 60_000,
        hookTimeout: 120_000,
        root: repoRoot,
    },
}));
