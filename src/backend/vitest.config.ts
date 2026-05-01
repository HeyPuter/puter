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
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: isCi
                ? ['json', 'json-summary', 'lcov']
                : ['text', 'json', 'json-summary', 'html', 'lcov'],
            excludeAfterRemap: true,
            // Keep coverage focused on executed files to avoid high-memory
            // uncovered-file remapping in CI.
            exclude: [
                'src/**/types/**',
                'src/**/constants/**',
                'src/**/*.d.ts',
                'src/**/*.d.mts',
                'src/**/*.d.cts',
                'src/**/dist/**',
                'src/**/*.min.*',
                'src/**/*.bench.{js,mjs,ts,mts}',
                'src/**/*.{test,spec}.{js,mjs,ts,mts}',
                'src/public/**',
                'src/services/worker/template/**',
            ],
        },
        env: loadEnv(mode, '', 'PUTER_'),
        include: ['**/*.{test,spec}.{ts,js}'],
        root: __dirname, // Ensures paths are relative to backend/
    },
}));
