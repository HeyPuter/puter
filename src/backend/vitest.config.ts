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

// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import path from 'node:path';
import { transform } from 'esbuild';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';
const backendDir = __dirname;
const repoRoot = path.resolve(backendDir, '../..');

// Vite 8's oxc transform leaves TC39 stage-3 decorators in place
// (used by `@Controller`/`@Post`), so they reach Node verbatim and
// crash with "SyntaxError: Invalid or unexpected token". Pre-transform
// `.ts`/`.mts` source through esbuild — which DOES lower stage-3
// decorators — locked to `es2024` to match `tsconfig.json`'s target.
const lowerDecoratorsPlugin = {
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
        include: [
            'src/backend/**/*.test.{js,ts}',
            'extensions/**/*.test.{js,ts}',
        ],
        // Root is the repo root so that the file transformer (which
        // applies `lowerDecoratorsPlugin`) sees both src/backend and
        // extensions/ — vitest skips transform for files outside root.
        root: repoRoot,
    },
}));
