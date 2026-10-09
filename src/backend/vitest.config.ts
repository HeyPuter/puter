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

// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';
const backendDir = __dirname;
const repoRoot = path.resolve(backendDir, '../..');

// pgmock boots a WASM-emulated Postgres on every `setupTestServer()` call —
// migrations alone take ~60s, and the WASM VM serializes badly across
// concurrent emulator instances. So in pgmock mode we (a) bump hook/test
// timeouts well beyond the 10s default and (b) disable file parallelism so
// only one pgmock VM runs at a time. Tests still race their own logic
// internally; we only serialize the *files*.
const isPgmockMode =
    (process.env.PUTER_TEST_DB_ENGINE ?? '').toLowerCase() === 'postgres';
const pgmockTimeoutMs = 600_000;

// Tests that always boot pgmock regardless of PUTER_TEST_DB_ENGINE. Too slow
// for CI; run locally or via `npm run test:backend:postgres`.
const postgresOnlyTests = [
    'src/backend/clients/database/PostgresDatabaseClient.integration.test.ts',
    'src/backend/services/appIcon/AppIconService.test.ts',
];

const testInclude = [
    'src/backend/**/*.test.{js,ts}',
    'extensions/**/*.test.{js,ts}',
    // The MCP connector's signed-upload tools call the `/fs` HTTP API
    // directly, so their tests need a booted backend (`setupPuterTestEnv`).
    'src/mcp-connector/**/*.test.{js,ts}',
    // Root-level tools/ scripts are exercised through this suite.
    'tools/**/*.test.mjs',
    // The worker runtimes ship as a preamble rather than as their own
    // package, so their unit tests run with the backend's.
    'src/worker/**/*.test.{js,ts}',
];

const testExclude = [
    ...configDefaults.exclude,
    ...(isCi && !isPgmockMode ? postgresOnlyTests : []),
];

// Test files that boot a server pay most of their runtime importing the
// backend. Sharing a module graph per worker (`isolate: false`) pays that once
// per worker instead; testSharedWorkerSetup.ts resets process-wide state
// between files. Stays isolated: module mocks (can't be undone in a shared
// graph), anything loading extensions (they register into the process-wide
// extension store and read config only on first import), and pgmock.
const sharedWorkerTests = isPgmockMode
    ? []
    : globSync(testInclude, {
          cwd: repoRoot,
          exclude: (p) => path.basename(String(p)) === 'node_modules',
      }).filter((file) => {
          if (file.startsWith('extensions/')) return false;
          if (postgresOnlyTests.includes(file)) return false;
          const source = readFileSync(path.join(repoRoot, file), 'utf8');
          return (
              /\bsetupTestServer\(/.test(source) &&
              !/\bsetupPuterTestEnv\(/.test(source) &&
              !/\bvi\.(mock|doMock)\(/.test(source)
          );
      });

// Vite 8's oxc transform leaves TC39 stage-3 decorators in place
// (used by `@Controller`/`@Post`), so they reach Node verbatim and
// crash with "SyntaxError: Invalid or unexpected token". Pre-transform
// `.ts`/`.mts` source through esbuild — which DOES lower stage-3
// decorators — locked to `es2024` to match `tsconfig.json`'s target.
// Exported for other vitest configs that boot backend code (e.g. the
// puter.js API test runners).
export const lowerDecoratorsPlugin = {
    name: 'puter:lower-decorators',
    enforce: 'pre' as const,
    async transform(code: string, id: string) {
        if (id.includes('/node_modules/')) return null;
        if (!/\.(m?ts)$/.test(id)) return null;
        if (!code.includes('@')) return null;
        const result = await transform(code, {
            loader: 'ts',
            target: 'es2024',
            sourcefile: id,
            sourcemap: 'inline',
        });
        return { code: result.code, map: null };
    },
};

export default defineConfig(({ mode }) => ({
    plugins: [lowerDecoratorsPlugin],
    resolve: {
        // Mirror the `@heyputer/backend` path aliases declared in
        // tsconfig.json so backend code under test can use the same
        // imports it does in production.
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
        ...(isPgmockMode
            ? {
                  testTimeout: pgmockTimeoutMs,
                  hookTimeout: pgmockTimeoutMs,
                  fileParallelism: false,
              }
            : {}),
        coverage: {
            provider: 'v8',
            reporter: isCi
                ? ['json', 'json-summary', 'lcov']
                : ['text', 'json', 'json-summary', 'html', 'lcov'],
            excludeAfterRemap: true,
            // Listing both trees explicitly ensures untested files show
            // as 0% instead of being silently dropped from the report.
            include: [
                'src/backend/**/*.{js,ts}',
                'extensions/**/*.{js,ts}',
            ],
            reportsDirectory: path.join(backendDir, 'coverage'),
        },
        env: loadEnv(mode, '', 'PUTER_'),
        // Root is the repo root so that the file transformer (which
        // applies `lowerDecoratorsPlugin`) sees both src/backend and
        // extensions/ — vitest skips transform for files outside root.
        root: repoRoot,
        // `extends: true` concatenates arrays, so include/exclude live only
        // on the projects.
        projects: [
            {
                extends: true,
                test: {
                    name: 'isolated',
                    include: testInclude,
                    exclude: [...testExclude, ...sharedWorkerTests],
                },
            },
            ...(sharedWorkerTests.length > 0
                ? [
                      {
                          extends: true as const,
                          test: {
                              name: 'shared-worker',
                              include: sharedWorkerTests,
                              exclude: testExclude,
                              isolate: false,
                              setupFiles: [
                                  'src/backend/testSharedWorkerSetup.ts',
                              ],
                          },
                      },
                  ]
                : []),
        ],
    },
}));
